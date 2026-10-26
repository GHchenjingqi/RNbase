/**
 * 鸿蒙开发态入口：确保模拟器在跑 + 拉起 Metro dev server，不碰安卓链路。
 *
 * 与 scripts/dev.js 的分工（两条线互不干涉）：
 *  - dev.js    = Metro + adb reverse + H5 离线包注入 + gradlew installDebug（安卓专属）
 *  - 本脚本     = 鸿蒙就绪检查 + 模拟器 + Metro（鸿蒙 debug HAP 从 Metro 拉 bundle）
 *
 * 设备侧两条转发（8081 → 宿主机 Metro、5173 → 宿主机 vite）由 `npm run install:harmony`
 * （hvigor.js 的 ensureDevForwards）装机时一并配好，这里不重复实现，免得两处 hdc 探测逻辑走偏。
 * 5173 那条是 debug 包 H5 入口连本机 vite 的前提：resolve-h5-entry.ts 在 __DEV__ 下
 * 走 http://127.0.0.1:5173/，所以子应用的 vite 也得起着，H5 才不是白屏。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { killPort } = require('./free-port');
const { assertHarmonyReady } = require('./harmony-ready');
const { METRO_HOST_PORT, H5_DEV_PORT } = require('./ports');
const { createTee } = require('./log-tee');

const root = path.join(__dirname, '..');
const logDir = path.join(root, 'log');
fs.mkdirSync(logDir, { recursive: true });
const isWin = process.platform === 'win32';
// 与 scripts/dev.js、scripts/hvigor.js 同源的 Metro 端口（真源 ports.json）。
const PORT = METRO_HOST_PORT;

// 创建 tee 流用共享实现：终端管道断开（工作台关窗 / 停止任务 / `| head`）时
// 不能让 EPIPE 把 dev server 打死，详见 scripts/log-tee.js。

/**
 * 模拟器没起来时 Metro 起来了也没用（debug HAP 起来要拉 bundle），所以先把它拉起来。
 * 交给 harmony-emulator.js 自己做：设备已连时它直接返回，不会重复启动。
 */
function ensureEmulator() {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'harmony-emulator.js')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(
      '[harmony-dev] 模拟器未就绪，先不起 Metro。单独跑 npm run emulator:harmony 看具体报错。',
    );
    process.exit(r.status ?? 1);
  }
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
  // 版本闸必须在这里也过一遍：metro.config.js 对鸿蒙的接入是「装了 RNOH 才生效」的，
  // 缺依赖时直接起 Metro 只会 serve 出一份不含鸿蒙平台解析规则的 bundle，
  // 表现为设备端白屏 + Metro 日志里的模块找不到，排查成本远高于这条报错。
  assertHarmonyReady(root, 'harmony-dev');
  ensureEmulator();

  // 上一趟没退干净的 Metro 会让这一趟直接起不来，和 dev.js 一样先释放端口。
  console.log(`[harmony-dev] 检查端口 ${PORT} ...`);
  killPort(PORT);
  await new Promise(r => setTimeout(r, 800));

  console.log(`[harmony-dev] 启动 Metro dev server (port ${PORT}) ...`);
  const metroLog = createTee('metro-harmony.log');
  const metro = spawn(
    isWin ? 'npx.cmd' : 'npx',
    ['react-native', 'start', '--port', String(PORT)],
    { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], shell: isWin },
  );
  metro.stdout.on('data', c => metroLog.write(c));
  metro.stderr.on('data', c => metroLog.write(c));

  const ready = await waitForMetro(120000);
  if (!ready) {
    console.error('[harmony-dev] Metro 未在预期时间内就绪，请检查端口占用或依赖安装。');
    metroLog.end();
    metro.kill();
    process.exit(1);
  }
  console.log('[harmony-dev] Metro 就绪。另开终端执行：');
  console.log('  npm run install:harmony   # 出 debug HAP + 配 hdc 端口转发 + 装机启动');
  console.log(
    `  子应用里 npm run dev        # 起本机 vite(${H5_DEV_PORT})，debug 包的 H5 入口就是它；` +
      '没起则停在基座诊断页',
  );
  console.log('[harmony-dev] Metro 保持前台运行，Ctrl+C 停止。');
}

main();
