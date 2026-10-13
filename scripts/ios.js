/**
 * iOS 侧命令入口（与安卓/鸿蒙同名不同缀：dev:ios / build:ios / clean:ios）。
 *
 * 为什么要有这个脚本而不是直接把 `react-native run-ios` 写进 package.json：
 *  1. Xcode、xcodebuild、CocoaPods 只存在于 macOS。Windows/Linux 上执行会抛
 *     `Command failed: xcodebuild`，看不出是「环境不对」还是「工程坏了」；
 *  2. 基座的 iOS 工程已到「模板 + 自研 Base* 模块 + H5 入口」这一层，仍有少量需人工的项：
 *     - CLIENT_ID.ios 在 src/config/index.ts 仍是占位值，上架前必须替换；
 *     - 本地 H5 需把 h5/ 作为 folder reference 加进 Xcode App target（ios:sync-h5 同步资源）。
 *     这些必须让人在跑命令时就看到，而不是等装机后白屏再回源码找。
 * 本脚本在非 macOS 一律拒绝并给出下一步；在 macOS 才真正调 xcodebuild / react-native CLI。
 *
 * 用法：node scripts/ios.js <doctor|pods|run|build|sync-h5> [--release]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const iosDir = path.join(root, 'platforms', 'ios');
const isMac = process.platform === 'darwin';
const task = process.argv[2];
const isRelease = process.argv.includes('--release');

/**
 * iOS 链路的已知缺口，跑到任何命令都先复述一遍，免得「装上了但白屏」再回源码找原因。
 * 这些是需要人工介入的配置项，不是脚本能自动补的。
 */
const KNOWN_GAPS = [
  'CLIENT_ID.ios 仍是占位值 PLEASE_SET_IOS_CLIENT_ID（src/config/index.ts），上架前必须换成 iOS 端分配的 clientId，否则登录被后端拒绝',
  'iOS 本地 H5 需把 h5/ 作为 folder reference 加进 Xcode App target（见 ios:sync-h5 与 Xcode 步骤），否则仅远程站点模式（version.json remoteUrl）可用',
  'release 出 .ipa 需要 Xcode 配置 signing 后手动 Archive，或把 -archive/-exportArchive（ExportOptions.plist）参数补进 scripts/ios.js',
];

function fail(msg) {
  console.error(`[ios] ${msg}`);
  process.exit(1);
}

/** CocoaPods 生成的 workspace（RN 模板里与 xcodeproj 同名）。 */
function findWorkspace() {
  if (!fs.existsSync(iosDir)) return null;
  const ws = fs
    .readdirSync(iosDir)
    .filter((f) => f.endsWith('.xcworkspace'))
    .sort();
  return ws.length ? path.join(iosDir, ws[0]) : null;
}

function printGuard(reason) {
  console.error(`[ios] ${reason}`);
  console.error(
    '[ios] iOS 构建只能在 macOS 上执行（需要 Xcode / xcodebuild / CocoaPods）。\n' +
      '[ios] 下一步：在 Mac 上 clone 同一份仓库，装好 Xcode 与 CocoaPods 后执行\n' +
      '         npm ci\n' +
      '         npm run ios:sync-h5   # 把 h5/ 同步进 iOS 工程\n' +
      '         npm run ios:pods      # pod install\n' +
      '         npm run dev:ios       # Metro + run-ios（模拟器）\n' +
      '         npm run build:ios     # xcodebuild（模拟器 Debug 构建，不出 .ipa）\n' +
      '[ios] 基座在 Windows/Linux 上的可用链路：安卓（npm run dev / build:android）' +
      '与鸿蒙（npm run dev:harmony，见 README「鸿蒙（RNOH）」）。'
  );
  for (const gap of KNOWN_GAPS) console.error(`[ios] 注意缺口：${gap}`);
}

/**
 * 自研原生模块清单（platforms/ios/<工程目录>/Base*.{swift,m}）。
 * doctor 用它回答「iOS 侧到底有没有对应实现」，而不是靠人回忆。
 */
function nativeSources() {
  if (!fs.existsSync(iosDir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(iosDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of fs.readdirSync(path.join(iosDir, entry.name))) {
      if (/^Base.*\.(swift|m)$/.test(file)) {
        found.push(`${entry.name}/${file}`);
      }
    }
  }
  return found.sort();
}

/** 列出工程与依赖状态，给「iOS 还差什么」一个可核对的清单。 */
function doctor() {
  const lines = [];
  lines.push(`平台：${process.platform}（iOS 构建要求 darwin）`);
  lines.push(`iOS 工程：${fs.existsSync(iosDir) ? '存在 platforms/ios' : '缺失 platforms/ios'}`);
  const podfile = path.join(iosDir, 'Podfile');
  lines.push(`Podfile：${fs.existsSync(podfile) ? '存在' : '缺失'}`);
  const lock = path.join(iosDir, 'Podfile.lock');
  lines.push(
    `Podfile.lock：${
      fs.existsSync(lock) ? '存在（pod install 已跑过）' : '缺失，先 npm run ios:pods'
    }`
  );
  const ws = findWorkspace();
  lines.push(`workspace：${ws || '缺失（pod install 之后才有）'}`);
  lines.push(`自研原生模块：${nativeSources().join(', ') || '未发现 Base*.{swift,m}'}`);

  // clientId 占位校验：直接扫 config 源文件，避免引入 TS 解析依赖。
  const configPath = path.join(root, 'src', 'config', 'index.ts');
  const cfg = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const iosPlaceholder = /ios:\s*['"]PLEASE_SET_IOS_CLIENT_ID['"]/.test(cfg);
  lines.push(`CLIENT_ID.ios：${iosPlaceholder ? '仍是占位值，必须替换！' : '已配置'}`);

  // 本地 H5 资源是否同步进 iOS 工程。
  const h5InBundle = fs.existsSync(path.join(iosDir, 'qux', 'h5', 'index.html'));
  lines.push(
    `iOS bundle H5：platforms/ios/qux/h5/index.html ${
      h5InBundle
        ? '存在（已 sync-h5）'
        : '缺失，运行 npm run ios:sync-h5 并在 Xcode 加 folder reference'
    }`
  );

  console.log('[ios] 当前状态:');
  for (const l of lines) console.log(`  ${l}`);
  console.log('[ios] 已知缺口:');
  for (const gap of KNOWN_GAPS) console.log(`  ${gap}`);
}

function run(cmd, args, opts = {}) {
  console.log(`[ios] ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: opts.cwd || root, stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} 失败 (exit ${r.status})`);
}

function pods() {
  if (!fs.existsSync(path.join(iosDir, 'Podfile'))) fail(`未找到 ${path.join(iosDir, 'Podfile')}`);
  run('pod', ['install'], { cwd: iosDir });
}

/** 把仓库 h5/ 同步进 iOS 工程（供 Xcode 以 folder reference 引用）。跨平台可用。 */
function syncH5() {
  run('node', [path.join(__dirname, 'ios-sync-h5.mjs')]);
}

function runIos() {
  if (!findWorkspace()) {
    console.warn('[ios] 还没有 .xcworkspace，先执行 npm run ios:pods。');
  }
  run('npx', ['react-native', 'run-ios'], { cwd: root });
}

function build() {
  const ws = findWorkspace();
  if (!ws) fail('缺少 .xcworkspace：先 npm run ios:pods（pod install 会生成）');
  if (isRelease) {
    fail(
      'release 需要签名与 App Store Connect 配置' +
        '（xcodebuild -archive + -exportArchive + ExportOptions.plist），\n' +
        '        基座尚未固化这套参数；请在 Xcode 里配置 signing 后手动 archive，' +
        '或按需把命令补进 scripts/ios.js（并同步 README）。'
    );
  }
  // 本地模式前确保 H5 资源到位（远程模式忽略亦可，但 sync 无害）。
  syncH5();
  if (!fs.existsSync(path.join(iosDir, 'qux', 'h5', 'index.html'))) {
    console.warn(
      '[ios] platforms/ios/qux/h5 缺失：请先 npm run ios:sync-h5，并在 Xcode 把 h5 ' +
        '作为 folder reference 加进 App target，否则本地模式 WebView 白屏。'
    );
  }
  // 模拟器 Debug 构建：不需要签名，能验证 Swift/OC 侧与 pod 依赖是否真的编得过。
  run(
    'xcodebuild',
    [
      '-workspace',
      ws,
      '-scheme',
      path.basename(ws).replace(/\.xcworkspace$/, ''),
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      'build',
    ],
    { cwd: iosDir }
  );
  console.log('[ios] 模拟器 Debug 构建完成（产物在 Xcode DerivedData，本脚本不投递 ipa）。');
}

const TASKS = ['doctor', 'pods', 'run', 'build', 'sync-h5'];

function main() {
  if (!task) fail(`用法: node scripts/ios.js <${TASKS.join('|')}> [--release]`);
  // 先验 task：否则在 Windows 上打错命令名也只会看到「只能在 macOS 执行」，根因被盖住。
  if (!TASKS.includes(task)) fail(`未知 task=${task}，可用：${TASKS.join(' / ')}`);
  // doctor / sync-h5 只读或纯文件操作，任何平台都能跑；其余命令才真的需要 macOS。
  if (task === 'doctor') {
    doctor();
    return;
  }
  if (task === 'sync-h5') {
    syncH5();
    return;
  }
  // 其余命令执行前也先把缺口说一遍，避免有人以为 iOS 已经可用。
  for (const gap of KNOWN_GAPS) console.warn(`[ios] 注意缺口：${gap}`);
  if (!isMac) {
    printGuard(`当前系统 ${process.platform} 无法执行 iOS 链路（task=${task}）。`);
    process.exit(1);
  }
  if (task === 'pods') return pods();
  if (task === 'run') return runIos();
  return build();
}

module.exports = { KNOWN_GAPS, findWorkspace, nativeSources, iosDir, isMac };

// doctor.js 会 require 本文件拿缺口清单，所以只有直接执行时才走命令入口。
if (require.main === module) main();
