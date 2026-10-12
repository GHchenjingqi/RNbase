/**
 * 一键停止开发环境：关闭 App + 释放 Metro 端口 + 停止 Gradle 守护进程 + 清鸿蒙侧残留。
 *
 * 用法：npm run stop
 *  - adb force-stop 关闭 App（包名取活动子应用下发的 applicationId）
 *  - 结束占用 8082 的进程**及其子进程**（口径见 scripts/free-port.js，Metro 的 transform worker
 *    挂在监听进程下面，只杀父进程会把 worker 全变成孤儿）
 *  - gradlew --stop 停守护进程，并带上本仓的 gradle home（scripts/gradle-home.js）：
 *    不钉 home 停的是默认 home 里注册的 daemon，本仓真正在用的那个会留在后台继续往
 *    transform 缓存里写；随后打印 --status，home 之外还活着的 java 不一定是孤儿，
 *    可能是另一个项目的 daemon，得人来判断，脚本不代杀。
 *  - 鸿蒙侧（harmony/ 工程 + 有 hdc 设备时才动，见 scripts/harmony-ready.js）：
 *    aa force-stop 关 App、删掉设备上指向 Metro 的 8081 反向转发。RNOH 固定向设备侧 8081
 *    拉 bundle，宿主机靠 `hdc rport tcp:8081 tcp:8082` 转过来；Metro 一停，残留的旧规则会让
 *    下一趟 rport 报 "TCP Port listen failed at 8081" 并静默保留错映射，设备拿不到 bundle
 *    就是整屏纯黑。vite 的 5173 那条**不清**：H5 可能还在开发中，清了反而打断另一条链路。
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { readApplicationId } = require('./active-app');
const { killPort } = require('./free-port');
const { gradleHomeArgs } = require('./gradle-home');
const { discoverTools, readBundleName } = require('./harmony-ready');

const isWin = process.platform === 'win32';
const PORT = 8082;
const APP_ID = readApplicationId();
const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'platforms', 'android');
/** Metro 在设备侧的端口，hdc fport ls 输出里就是这个字面量 */
const METRO_REMOTE = 'tcp:8081';

/**
 * 停止 Gradle 守护进程。
 * 只停本仓 home 注册的那些（`--stop` 按 home 生效）；`--status` 一并打出来，
 * 让「还有谁活着」这件事由人来判断而不是脚本猜。
 */
function stopGradleDaemons() {
  if (!fs.existsSync(androidDir)) {
    console.log('[stop] 未找到 Android 工程目录，跳过 Gradle 停止。');
    return;
  }
  const gradlew = path.join(androidDir, isWin ? 'gradlew.bat' : 'gradlew');
  if (!fs.existsSync(gradlew)) {
    console.log('[stop] 未找到 gradlew，跳过 Gradle 停止。');
    return;
  }
  // 放在最后：home 被删掉时 gradleHomeArgs 会直接退出，不能让它挡住前面的端口清理。
  const homeArgs = gradleHomeArgs(androidDir);
  console.log('[stop] 停止 Gradle 守护进程 ...');
  const r = spawnSync(gradlew, ['--stop', ...homeArgs], {
    cwd: androidDir,
    encoding: 'utf8',
    shell: isWin,
  });
  const output = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status === 0) {
    const lines = output.split(/\r?\n/).filter(l => l.trim());
    console.log(
      lines.length > 0 ? `[stop] ${lines[lines.length - 1]}` : '[stop] Gradle 守护进程已停止。',
    );
  } else {
    console.log('[stop] Gradle --stop 执行失败（可能无守护进程在运行）。');
  }
  const s = spawnSync(gradlew, ['--status', ...homeArgs], {
    cwd: androidDir,
    encoding: 'utf8',
    shell: isWin,
  });
  const status = ((s.stdout || '') + (s.stderr || ''))
    .trim()
    .split(/\r?\n/)
    .filter(l => l.trim());
  if (status.length > 0) console.log(`[stop] 本仓 home 的 daemon 状态:\n  ${status.join('\n  ')}`);
}

/** hdc 无论成败退出码都是 0，结论只能看输出；行尾还是双 \r，交给调用方 trim。 */
function hdc(hdcPath, args) {
  const out = spawnSync(hdcPath, args, { encoding: 'utf8', timeout: 20000 });
  return `${out.stdout || ''}${out.stderr || ''}`.trim();
}

/**
 * 停鸿蒙 App + 删设备上指向 Metro 的反向转发。
 * 没有 harmony/ 工程（纯安卓基座）或没连设备时整段跳过，绝不因为鸿蒙缺位而让 npm run stop 失败。
 */
function stopHarmony() {
  const bundle = readBundleName(root);
  if (!bundle) {
    return;
  }
  const { hdc: hdcPath } = discoverTools(root);
  if (!hdcPath) {
    console.log('[stop] 未找到 hdc（可用 HDC 环境变量指定），跳过鸿蒙清理。');
    return;
  }
  const targets = hdc(hdcPath, ['list', 'targets']);
  if (!targets || targets.includes('[Empty]')) {
    console.log('[stop] 无 hdc 设备，跳过鸿蒙清理。');
    return;
  }

  console.log(`[stop] 关闭鸿蒙 App ${bundle} ...`);
  const stop = hdc(hdcPath, ['shell', 'aa', 'force-stop', bundle]);
  console.log(`[stop] aa force-stop: ${stop || 'ok'}`);

  // 行格式：127.0.0.1:10000    tcp:8081 tcp:8082    [Reverse]
  const listing = hdc(hdcPath, ['fport', 'ls']);
  const mine = [
    ...listing.matchAll(/(\S+)\s+(tcp:\S+)\s+(tcp:\S+)\s+\[(?:Forward|Reverse)\]/g),
  ].filter(m => m[2] === METRO_REMOTE);
  if (mine.length === 0) {
    console.log(`[stop] 设备上无 ${METRO_REMOTE} 转发规则，无需清理。`);
    return;
  }
  for (const m of mine) {
    // 删除一律走 fport rm：`hdc rport rm …` 会回 "Incorrect forward command"。
    const out = hdc(hdcPath, ['fport', 'rm', m[2], m[3]]);
    console.log(`[stop] 删除转发 ${m[2]} -> ${m[3]}: ${out || 'ok'}`);
  }
}

function main() {
  console.log('[stop] 关闭 App ...');
  const app = spawnSync('adb', ['shell', 'am', 'force-stop', APP_ID], {
    stdio: 'ignore',
    shell: isWin,
  });
  console.log(
    app.status === 0 ? '[stop] App 已关闭。' : '[stop] 未检测到设备或 App 未运行（跳过）。',
  );

  console.log(`[stop] 释放端口 ${PORT}（连同 Metro 的 worker 子进程）...`);
  const killedPort = killPort(PORT);
  console.log(
    killedPort.length > 0
      ? `[stop] 已结束 Metro 进程树: ${killedPort.join(', ')}`
      : `[stop] 端口 ${PORT} 无占用。`,
  );

  // 停止 Gradle 守护进程
  stopGradleDaemons();

  // 鸿蒙侧收尾（无 harmony/ 工程或无设备时自动跳过）
  stopHarmony();

  console.log('[stop] 全部完成。下次可直接 npm run dev（安卓）或 npm run dev:harmony（鸿蒙）。');
}

main();
