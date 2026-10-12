/**
 * 一键启动鸿蒙模拟器（直接调 DevEco 的 Emulator.exe，不用开 IDE）。
 *
 * 用法：npm run emulator:harmony
 *  - 已有 hdc 设备连接则直接提示可用；
 *  - 否则拉起模拟器实例，等 hdc 认到设备 + 系统启动完成。
 *
 * 覆盖默认值的环境变量：
 *  - HOS_EMULATOR_NAME 实例名。默认不写死：`Emulator.exe -list` 只有一个实例时直接用它，
 *    多个才要求指定 —— 实例名是各人 DevEco 里建的东西，硬编码进基座等于把上一台机器的状态当标准。
 *  - HOS_HDC_PORT      hdc 端口（默认 10000，范围 10000~16555；设备号就是 127.0.0.1:<该端口>）
 *  - HOS_EMULATOR / HDC / DEVECO_HOME 直接指定可执行文件位置
 *
 * 手动关这台模拟器：`Emulator.exe -stop <实例名>`。
 * 注意 `-start` 加载的是上次关窗时存的快照，界面上可能盖着上个会话残留的面板。
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { discoverTools } = require('./harmony-ready');

const isWin = process.platform === 'win32';
const HDC_PORT = process.env.HOS_HDC_PORT || '10000';
const tools = discoverTools(path.join(__dirname, '..'));
const { emulator: EMULATOR, hdc: HDC } = tools;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * hdc 无论成败退出码都是 0，结论只能看输出（`[Empty]` 即无设备）。
 * 另外它的行尾是双 \r，必须 trim 后再比。
 */
function hdc(args) {
  const out = spawnSync(HDC, args, { encoding: 'utf8', timeout: 20000 });
  return (out.stdout || '').trim();
}

function connectedDevices() {
  const text = hdc(['list', 'targets']);
  if (!text || text === '[Empty]') return [];
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && l !== '[Empty]');
}

function isBootCompleted() {
  return hdc(['shell', 'param', 'get', 'bootevent.boot.completed']) === 'true';
}

/** `-list` 的每行是一个实例名（可能带列标题/空行，按非空行取）。 */
function listInstances() {
  const out = spawnSync(EMULATOR, ['-list'], { encoding: 'utf8', timeout: 30000 }).stdout || '';
  return out
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
}

/**
 * 解析要启动的实例名：显式指定 > 唯一实例 > 报错列出候选。
 * @returns {string|null}
 */
function resolveInstanceName() {
  const explicit = process.env.HOS_EMULATOR_NAME;
  const instances = listInstances();
  if (explicit) {
    if (!instances.includes(explicit)) {
      console.error(
        `[emulator:harmony] 没有名为 ${explicit} 的模拟器实例。已有：${
          instances.join(' / ') || '(无)'
        }` +
          '\n                在 DevEco Studio 的 Device Manager 里建一个，或用 HOS_EMULATOR_NAME 指定。',
      );
      process.exit(1);
    }
    return explicit;
  }
  if (instances.length === 1) {
    console.log(`[emulator:harmony] 未指定 HOS_EMULATOR_NAME，使用唯一实例 ${instances[0]}`);
    return instances[0];
  }
  console.error(
    `[emulator:harmony] 本机有 ${instances.length} 个模拟器实例，无法自动选择：` +
      `${instances.join(' / ') || '(无)'}` +
      '\n                请用 HOS_EMULATOR_NAME=<实例名> npm run emulator:harmony 指定。',
  );
  return null;
}

function waitForDevices(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const devs = connectedDevices();
    if (devs.length > 0) return devs;
    sleep(3000);
  }
  return null;
}

function main() {
  if (!EMULATOR) {
    console.error(
      '[emulator:harmony] 未找到 DevEco 的 Emulator.exe，请设置 HOS_EMULATOR 或 DEVECO_HOME。',
    );
    process.exit(1);
  }
  if (!HDC) {
    console.error('[emulator:harmony] 未找到 hdc，无法判断模拟器是否就绪，请设置 HDC 环境变量。');
    process.exit(1);
  }

  const existing = connectedDevices();
  if (existing.length > 0) {
    console.log(`[emulator:harmony] 已有鸿蒙设备连接: ${existing.join(', ')}，无需启动。`);
    return;
  }

  const name = resolveInstanceName();
  if (!name) process.exit(1);

  console.log(`[emulator:harmony] 启动模拟器 ${name} (hdc 端口 ${HDC_PORT}) ...`);
  // 路径含空格也必须原样传：Node 不带 shell 时给路径套引号会被当成文件名，直接 ENOENT。
  // detached + unref 让模拟器脱离本进程存活；error 事件必须接住，否则子进程起不来会把 Node 打崩。
  const proc = spawn(EMULATOR, ['-start', name, '-hdcPort', HDC_PORT], {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  proc.on('error', err => {
    console.error(`[emulator:harmony] 启动失败: ${err.message}`);
    process.exit(1);
  });
  proc.unref();

  console.log('[emulator:harmony] 等待 hdc 认到设备 ...');
  const devs = waitForDevices(180000);
  if (!devs) {
    console.error('[emulator:harmony] 180 秒内 hdc 仍看不到设备，请检查模拟器窗口是否报错。');
    process.exit(1);
  }
  console.log(`[emulator:harmony] 设备 ${devs.join(', ')} 已连接，等待系统启动完成 ...`);

  const bootStart = Date.now();
  while (Date.now() - bootStart < 180000) {
    if (isBootCompleted()) {
      console.log('[emulator:harmony] 系统启动完成，可以 npm run dev:harmony / install:harmony。');
      return;
    }
    sleep(3000);
  }
  console.warn('[emulator:harmony] 系统仍在启动中，可稍候直接使用（不影响连接）。');
}

main();
