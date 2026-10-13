/**
 * 鸿蒙（RNOH）构建前置体检：`hvigor.js` 与 `doctor.js` 共用同一份判据。
 *
 * 为什么需要这一层：harmony/ 工程是**源码层**搬进基座的，而 RNOH 0.84.4 的
 * peerDependencies 把 react-native 精确锁在 0.84.1。基座若仍停在 RN 0.87.1，
 * 根本装不上 RNOH，此时直接跑 hvigorw 报的会是「找不到 oh_modules / 未知插件」
 * 这类看不出根因的错。所以这里把「缺什么、为什么缺、要装什么版本」一次讲清，
 * 并且**只在真正要出鸿蒙包时**拦（build 脚本），安卓/iOS 链路完全不受影响。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RNOH_PKG = '@react-native-oh/react-native-harmony';
const RNOH_CLI_PKG = '@react-native-oh/react-native-harmony-cli';

/**
 * RNOH 的版本事实（本机没有 node_modules 时的兜底口径，来自 jingyi 基座实测）：
 * 0.84.4 的 CLI 与 HAR 配套，peer 精确锁 react-native 0.84.1。
 * 装了 RNOH 之后一律以包内 peerDependencies 为准，不再用这里的数字。
 */
const RNOH_FALLBACK = { rnoh: '0.84.4', reactNative: '0.84.1' };

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'), null);
  } catch {
    return null;
  }
}

/** harmony/oh-package.json5 与 hvigor/hvigor-config.json5 都用 `file:../node_modules/...`
 *  指到 RN 侧依赖；这三条 + 插件 tgz 是「hvigor 能解析依赖」的最小必需集。 */
const REQUIRED_ARTIFACTS = [
  `node_modules/${RNOH_PKG}/react_native_openharmony.har`,
  'node_modules/@react-native-ohos/react-native-safe-area-context/harmony/safe_area.har',
  'node_modules/@react-native-ohos/react-native-webview/harmony/rn_webview.har',
];

const isWin = process.platform === 'win32';

/**
 * 鸿蒙命令行三件套定位：环境变量优先，其次 DevEco Studio 默认安装位置。
 * 仓库不提交 hvigorw 包装脚本（harmony/.gitignore 忽略），所以必须能找到 IDE 自带的 CLI。
 */
function findTool(envName, relativePaths, extraNames) {
  const env = process.env[envName];
  if (env) return env;
  const homes = [
    process.env.DEVECO_HOME,
    'D:\\devHm\\DevEco Studio',
    'C:\\Program Files\\Huawei\\DevEco Studio',
  ].filter(Boolean);
  const candidates = [];
  for (const home of homes) {
    for (const rel of relativePaths) candidates.push(path.join(home, rel));
  }
  for (const name of extraNames || []) candidates.push(name);
  return candidates.find(p => fs.existsSync(p)) || null;
}

/** 一次性把工具链位置算出来，供 hvigor.js 与 doctor.js 复用（避免两处判据漂移）。 */
function discoverTools(rootDir) {
  const harmonyDir = path.join(rootDir, 'harmony');
  const hvigorw = findTool(
    'HVIGORW',
    [path.join('tools', 'hvigor', 'bin', isWin ? 'hvigorw.bat' : 'hvigorw')],
    [path.join(harmonyDir, isWin ? 'hvigorw.bat' : 'hvigorw')],
  );
  const ohpm = findTool(
    'OHPM',
    [path.join('tools', 'ohpm', 'bin', isWin ? 'ohpm.bat' : 'ohpm')],
    ['ohpm'],
  );
  const hdc = findTool(
    'HDC',
    [path.join('sdk', 'default', 'openharmony', 'toolchains', isWin ? 'hdc.exe' : 'hdc')],
    ['hdc'],
  );
  // DevEco 自带的模拟器可执行文件：不打开 IDE 也能 -start/-list/-stop
  const emulator = findTool('HOS_EMULATOR', [
    path.join('tools', 'emulator', isWin ? 'Emulator.exe' : 'Emulator'),
  ]);
  const sdkHome = process.env.DEVECO_SDK_HOME || (hdc && path.resolve(hdc, '..', '..', '..', '..'));
  // hvigorw 是文件路径：bin -> hvigor -> tools，故三级上跳才是 DevEco 自带的 tools/node
  const nodeHomeDefault = hvigorw && path.resolve(hvigorw, '..', '..', '..', 'node');
  const nodeHome =
    process.env.NODE_HOME ||
    (nodeHomeDefault && fs.existsSync(path.join(nodeHomeDefault, isWin ? 'node.exe' : 'node'))
      ? nodeHomeDefault
      : null);
  return { hvigorw, ohpm, hdc, emulator, sdkHome, nodeHome, harmonyDir };
}

/** rnoh-hvigor-plugin 的 tgz 版本号是通配的（0.84.4.tgz 之类），按前缀匹配即可。 */
function findRnohHvigorPlugin() {
  const dir = path.join('node_modules', RNOH_CLI_PKG, 'harmony');
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return null;
  const tgz = fs.readdirSync(abs).find(f => /^rnoh-hvigor-plugin-.*\.tgz$/.test(f));
  return tgz ? path.join(dir, tgz) : null;
}

/**
 * @returns {{blockers: string[], warnings: string[], notes: string[], rnVersion: string|null}}
 *   blockers 非空即「现在跑不通鸿蒙出包」；warnings 只影响能否跑在真机/模拟器上。
 */
function checkHarmonyReady(rootDir) {
  const blockers = [];
  const warnings = [];
  const notes = [];

  const pkg = readJsonSafe(path.join(rootDir, 'package.json')) || {};
  const installedRn = readJsonSafe(
    path.join(rootDir, 'node_modules', 'react-native', 'package.json'),
  );
  const rnVersion =
    (installedRn && installedRn.version) ||
    (pkg.dependencies && pkg.dependencies['react-native']) ||
    null;

  const harmonyDir = path.join(rootDir, 'harmony');
  if (!fs.existsSync(path.join(harmonyDir, 'AppScope', 'app.json5'))) {
    blockers.push(
      `缺少鸿蒙工程：${path.join('harmony', 'AppScope', 'app.json5')}` +
        '（基座未搬入 RNOH 工程，无法出 HAP）',
    );
  }

  const rnohPkgDirRel = `node_modules/${RNOH_PKG}`;
  const rnohMeta = readJsonSafe(path.join(rootDir, rnohPkgDirRel, 'package.json'));
  if (!rnohMeta) {
    blockers.push(
      `未安装 ${RNOH_PKG}（RNOH 运行时与 HAR 都在这里）。` +
        ` 期望版本：与 react-native 配套的 ${RNOH_FALLBACK.rnoh}，` +
        `其 peer 精确锁 RN ${RNOH_FALLBACK.reactNative}` +
        (rnVersion ? `；当前基座 RN = ${rnVersion}` : '') +
        (rnVersion && !rnVersion.startsWith(RNOH_FALLBACK.reactNative)
          ? ` —— 主干 RN 与 peer 不一致，装包必冲突：要么整仓降到 ${RNOH_FALLBACK.reactNative}，` +
            '要么等 RNOH 出适配该版本的发布线'
          : ''),
    );
  } else {
    const peer = (rnohMeta.peerDependencies || {})['react-native'];
    if (peer && rnVersion && !peerAllows(peer, rnVersion)) {
      blockers.push(
        `${RNOH_PKG}@${rnohMeta.version} 要求 react-native ${peer}，当前是 ${rnVersion}：` +
          'hvigor 的 bundle-harmony 与 metro 配置都会按 RN 内部路径解析，版本错配不会只停在警告',
      );
    }
    notes.push(`${RNOH_PKG}@${rnohMeta.version}（peer react-native: ${peer || '未声明'}）`);
  }

  const plugin = findRnohHvigorPlugin();
  if (!plugin) {
    blockers.push(
      `未安装 ${RNOH_CLI_PKG}（harmony/hvigor/hvigor-config.json5 直接引用它里面的 rnoh-hvigor-plugin tgz）`,
    );
  }

  for (const rel of REQUIRED_ARTIFACTS) {
    if (!fs.existsSync(path.join(rootDir, rel))) {
      // RNOH 本体缺失时上面已经说清了原因，这里不重复刷同一条。
      if (rel.startsWith(rnohPkgDirRel) && !rnohMeta) continue;
      blockers.push(`缺少鸿蒙依赖产物：${rel}`);
    }
  }

  const tools = discoverTools(rootDir);
  if (!tools.hvigorw) {
    warnings.push(
      '未找到 hvigorw（可执行 DEVECO_HOME / HVIGORW 环境变量指向 DevEco Studio 安装目录）。' +
        ' 注意 Windows 上必须走 .bat，且 spawn 时要补 OS=Windows_NT，否则批处理无限递归',
    );
  }
  if (!tools.ohpm) {
    warnings.push('未找到 ohpm：harmony/oh_modules 无法安装，hvigor 解析不到 @rnoh 等 HAR 依赖');
  }
  if (!tools.hdc) {
    warnings.push('未找到 hdc：无法做端口反向转发、装包与启动（npm run install:harmony 需要）');
  }
  if (!tools.emulator) {
    warnings.push(
      '未找到 DevEco 的 Emulator.exe：npm run emulator:harmony 起不了模拟器（可设 HOS_EMULATOR 或 DEVECO_HOME）',
    );
  }

  if (fs.existsSync(harmonyDir)) {
    const profile = path.join(harmonyDir, 'build-profile.json5');
    if (!fs.existsSync(profile)) {
      notes.push(
        'harmony/build-profile.json5 尚未生成（首次构建会自动从 build-profile.template.json5 复制，' +
          '默认无签名 → 产物是 unsigned HAP，只有模拟器接受）',
      );
    } else if (!/"signingConfigs"\s*:\s*\[\s*\]/.test(fs.readFileSync(profile, 'utf8'))) {
      notes.push('harmony/build-profile.json5 已含签名配置（该文件不入库，真机装包需要）');
    }
  }

  return { blockers, warnings, notes, rnVersion, tools };
}

/** peer 可能是 '0.84.1' / '^0.84.1' / '>=0.84.1' 之类的表达式，只做「是否指向同一具体版本」的保守判断。 */
function peerAllows(peer, rnVersion) {
  const exact = peer.match(/\d+\.\d+\.\d+/);
  if (!exact) return true;
  return rnVersion === exact[0] || rnVersion.startsWith(`${exact[0]}-`);
}

/**
 * harmony/AppScope/app.json5 里的 bundleName：装包启动（hvigor.js）与停止 App（stop.js）
 * 都要它，所以放在公共模块里读一次，别让两处各自正则一遍。
 * @returns {string|null} 工程未搬入或字段缺失时返回 null，由调用方决定是报错还是跳过
 */
function readBundleName(rootDir) {
  const file = path.join(rootDir, 'harmony', 'AppScope', 'app.json5');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/"bundleName"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function formatReport(result) {
  const lines = [];
  for (const b of result.blockers) lines.push(`  [阻塞] ${b}`);
  for (const w of result.warnings) lines.push(`  [警告] ${w}`);
  for (const n of result.notes) lines.push(`  [说明] ${n}`);
  return lines.join('\n');
}

/**
 * 出包脚本里的硬闸：blockers 存在就打印判据并退出，别让 hvigorw 抛一句看不懂的错。
 * @param {string} tag 日志前缀，如 'hvigor'
 */
function assertHarmonyReady(rootDir, tag) {
  const result = checkHarmonyReady(rootDir);
  if (!result.blockers.length) {
    if (result.warnings.length) console.warn(`[${tag}] 鸿蒙工具链提醒:\n${formatReport(result)}`);
    return result;
  }
  console.error(
    `[${tag}] 鸿蒙构建前置检查未通过：\n${formatReport(result)}\n` +
      `  完整判据可单看：npm run doctor`,
  );
  process.exit(1);
}

module.exports = {
  RNOH_PKG,
  RNOH_CLI_PKG,
  RNOH_FALLBACK,
  REQUIRED_ARTIFACTS,
  checkHarmonyReady,
  assertHarmonyReady,
  formatReport,
  discoverTools,
  findTool,
  readBundleName,
};
