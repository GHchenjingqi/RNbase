/**
 * 一键启动 Android 模拟器（Pixel_10）并等待系统就绪。
 *
 * 用法：npm run emulator
 *  - 若已有设备连接则直接提示可用；
 *  - 否则启动 Pixel_10 AVD，等待设备连接 + 系统启动完成。
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const AVD = 'Pixel_10';
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) {
  console.error('[emulator] 未设置 ANDROID_HOME / ANDROID_SDK_ROOT，请先安装 Android SDK。');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const emulatorBin = path.join(sdk, 'emulator', isWin ? 'emulator.exe' : 'emulator');
const adbBin = path.join(sdk, 'platform-tools', isWin ? 'adb.exe' : 'adb');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 返回已连接（状态为 device）的设备列表，如 ["emulator-5554"] */
function connectedDevices() {
  const out = spawnSync(adbBin, ['devices'], { encoding: 'utf8' });
  return (out.stdout || '')
    .split(/\r?\n/)
    .filter(l => /^\S+\s+device$/.test(l.trim()))
    .map(l => l.trim().split(/\s+/)[0]);
}

/** 设备系统是否启动完成（sys.boot_completed=1） */
function isBootCompleted(device) {
  const out = spawnSync(adbBin, ['-s', device, 'shell', 'getprop', 'sys.boot_completed'], {
    encoding: 'utf8',
  });
  return (out.stdout || '').trim() === '1';
}

function waitForDevice(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const devs = connectedDevices();
    if (devs.length > 0) return devs[0];
    sleep(3000);
  }
  return null;
}

function main() {
  const existing = connectedDevices();
  if (existing.length > 0) {
    console.log(`[emulator] 已有设备连接: ${existing.join(', ')}，无需启动。`);
    return;
  }

  console.log(`[emulator] 启动模拟器 ${AVD} ...`);
  // -gpu swiftshader_indirect: 强制软件渲染，规避独显(GPU)驱动与模拟器渲染兼容导致的系统卡死；
  // -memory 2048: 与 config.ini hw.ramSize 对齐，降低内存占用，避免整机资源紧张。
  const proc = spawn(
    emulatorBin,
    ['-avd', AVD, '-no-snapshot-load', '-gpu', 'swiftshader_indirect', '-memory', '2048'],
    {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    },
  );
  proc.unref();

  console.log('[emulator] 等待设备连接 ...');
  const device = waitForDevice(120000);
  if (!device) {
    console.error('[emulator] 120 秒内未检测到设备，请确认 AVD 存在或模拟器是否报错。');
    process.exit(1);
  }
  console.log(`[emulator] 设备 ${device} 已连接，等待系统启动完成 ...`);

  const bootStart = Date.now();
  while (Date.now() - bootStart < 180000) {
    if (isBootCompleted(device)) {
      console.log('[emulator] 系统启动完成，可以开始开发。');
      return;
    }
    sleep(3000);
  }
  console.warn('[emulator] 系统仍在启动中，可稍候直接使用（不影响连接）。');
}

main();
