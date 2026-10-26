/**
 * 一键启动编译环境：后台拉起 Metro(8082) + 构建安装 Android App。
 *
 * 用法：npm run dev
 *  - 启动前自动释放 8082 端口（连同 Metro 的 worker 子进程，口径见 scripts/free-port.js）；
 *  - 自动等待 Metro 就绪后再执行 gradlew installDebug；
 *  - Metro 保持前台运行，可按 Ctrl+C 一并停止。
 */
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { resolveActiveApp, readApplicationId } = require('./active-app');
const { killPort } = require('./free-port');
const { setupAdbReverse, H5_DEV_PORT } = require('./adb-forward');
const { METRO_HOST_PORT } = require('./ports');
const { gradleHomeArgs, aapt2OverrideArgs } = require('./gradle-home');
const { createTee } = require('./log-tee');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'platforms', 'android');
const logDir = path.join(root, 'log');
fs.mkdirSync(logDir, { recursive: true });
const isWin = process.platform === 'win32';
const PORT = METRO_HOST_PORT;

// 创建 tee 流用共享实现：终端管道断开（工作台关窗 / 停止任务 / `| head`）时
// 不能让 EPIPE 把 dev server 打死，详见 scripts/log-tee.js。

/** 检测是否有已连接的 Android 设备（adb devices 状态为 device） */
function hasConnectedDevice() {
  const out = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  const lines = (out.stdout || '').split(/\r?\n/);
  return lines.some(l => /^\S+\s+device$/.test(l.trim()));
}

function metroReady() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/status`, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve(body.includes('running')));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForMetro(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await metroReady()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  console.log(`[dev] 检查端口 ${PORT} ...`);
  killPort(PORT);
  await new Promise(r => setTimeout(r, 800)); // 等待端口完全释放
  console.log(`[dev] 启动 Metro dev server (port ${PORT}) ...`);
  const metroLog = createTee('metro.log');
  const metro = spawn(
    isWin ? 'npx.cmd' : 'npx',
    ['react-native', 'start', '--port', String(PORT)],
    { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], shell: isWin },
  );
  metro.stdout.on('data', c => metroLog.write(c));
  metro.stderr.on('data', c => metroLog.write(c));

  console.log('[dev] 等待 Metro 就绪 ...');
  const ready = await waitForMetro(90000);
  if (!ready) {
    console.error('[dev] Metro 未在预期时间内就绪，请检查端口占用或依赖安装。');
    metro.kill();
    process.exit(1);
  }
  console.log('[dev] Metro 就绪，检查设备 ...');
  if (!hasConnectedDevice()) {
    console.error(
      '[dev] 未检测到 Android 设备！请先启动模拟器（Pixel_10）或连接真机，再重新运行 npm run dev。',
    );
    console.error('[dev] Metro 仍在运行，可在启动设备后直接重试。');
    process.exit(1);
  }
  console.log('[dev] 设备就绪，配置 adb reverse 端口转发 ...');
  setupAdbReverse(PORT, 'dev');
  // debug 包的 H5 入口是宿主机 dev server（README 4.4），不是包内 assets：
  // 子应用的 vite 没起着的话 H5 会停在加载失败页，这里提前说一声免得当成白屏 bug 排查。
  console.log(
    `[dev] H5 入口直连宿主机 dev server http://127.0.0.1:${H5_DEV_PORT}/ —— 请在子应用里跑 npm run dev；` +
      `只想调 RN 代码就把 version.json 的 h5DevUrl 设为 off`,
  );

  // 打包前自动注入唯一源 api.js（scripts/api.js → 基座 h5/js/api.js 与活动子应用产物 js/api.js），
  // 保证打进 APK 的 Bridge 协议始终与基座一致（等价于先执行 node scripts/inject-h5-api.js）。
  // 同时补回安全区修复（sync 覆盖 index.html 后幂等重注入）。
  console.log('[dev] 注入唯一源 api.js + 安全区修复 ...');
  require(path.join(__dirname, 'fix-h5-safearea.js'));
  const injectH5Api = path.join(__dirname, 'inject-h5-api.js');
  const app = resolveActiveApp();
  console.log(`[dev] 活动子应用: ${app.name}（产物 ${app.distDir}）`);
  ['h5', app.distDir].forEach(target => {
    const r = spawnSync(process.execPath, [injectH5Api, target], {
      stdio: 'inherit',
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  });

  console.log('[dev] 开始构建安装 Android App ...');

  const gradlew = isWin ? 'gradlew.bat' : './gradlew';
  const devLog = createTee('dev.log');
  // 本仓的 gradle home / aapt2 钉法与 scripts/gradle.js 同口径，否则两条打包入口用的不是同一套缓存
  const extraArgs = [...gradleHomeArgs(androidDir), ...aapt2OverrideArgs(androidDir)];
  const build = spawn(gradlew, ['installDebug', ...extraArgs], {
    cwd: androidDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
  });
  build.stdout.on('data', c => devLog.write(c));
  build.stderr.on('data', c => devLog.write(c));
  build.on('exit', code => {
    devLog.end();
    if (code === 0) {
      console.log('[dev] 安装完成，启动 App ...');
      // 包名（applicationId）由子应用下发，与源码 namespace（com.qux，MainActivity 实际所在包）
      // 不同，必须写成 <applicationId>/<全限定类名>，否则切包名后 am start 找不到 Activity。
      const appId = readApplicationId();
      const launch = spawn('adb', ['shell', 'am', 'start', '-n', `${appId}/com.qux.MainActivity`], {
        stdio: 'inherit',
        shell: isWin,
      });
      launch.on('exit', () => {
        console.log('[dev] App 已启动。Metro 仍在运行，可按 Ctrl+C 停止。');
        // 不调用 process.exit：保持 Metro 子进程运行，父进程随 Metro 生命周期存活
      });
    } else {
      console.log(`[dev] 构建/安装失败 (exit ${code})。`);
      process.exit(code ?? 1);
    }
  });
}

main();
