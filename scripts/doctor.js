/**
 * 构建前环境自查（只读，不写任何文件）。
 *
 * 为什么需要它：这台机器上「构建失败」的真实原因通常不在 gradle 里，而是几个静默前置状态 ——
 * node_modules 是空壳、h5/ 还没同步子应用产物、api.js 副本漂移、gradle 缓存/aapt2 指向被换掉的
 * 二进制。这些都不会在 gradlew 的输出里说明自己，最坏的情况是「构建成功但打出一个空包/旧协议包」。
 * 所以把判断条件收在一条命令里，先跑它再跑 build:android。
 * 末尾还有一节「平台链路」：报清安卓/鸿蒙/iOS 各自现在能不能用、差什么（未就绪只 WARN，
 * 鸿蒙的硬闸在 scripts/harmony-ready.js，由 dev:harmony / build:harmony 把住）。
 *
 * 用法：npm run doctor
 * 退出码：0 = 无阻塞项；1 = 有 FAIL 级问题（WARN 不影响退出码，交给人判断）。
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveActiveApp } = require('./active-app');
const { check: checkHermesc } = require('./check-hermesc');
const { readProperty } = require('./gradle-home');
const { checkHarmonyReady } = require('./harmony-ready');
const { KNOWN_GAPS, findWorkspace, nativeSources, iosDir } = require('./ios');

const ROOT = path.resolve(__dirname, '..');

let fails = 0;
let warns = 0;

function ok(msg) {
  console.log(`  [OK]   ${msg}`);
}

function warn(msg, how) {
  warns++;
  console.log(`  [WARN] ${msg}`);
  if (how) console.log(`         → ${how}`);
}

/** 只陈述状态，不计入 FAIL/WARN（用于「还没装但本来就不需要」的链路）。 */
function info(msg) {
  console.log(`  [INFO] ${msg}`);
}

function fail(msg, how) {
  fails++;
  console.log(`  [FAIL] ${msg}`);
  if (how) console.log(`         → ${how}`);
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

function exists(p) {
  return fs.existsSync(p);
}

/** 目录里的条目数（node_modules 空壳＝有目录没内容，这时 require 报的错完全看不出原因）。 */
function entryCount(dir) {
  try {
    return fs.readdirSync(dir).length;
  } catch (e) {
    return -1;
  }
}

/**
 * 内容哈希（先统一行尾再算）。
 *
 * 为什么必须统一：仓库没配 .gitattributes，core.autocrlf=true 会把入库的 LF 落地成 CRLF，
 * 而 scripts/api.js 这类由脚本/编辑器改过的文件仍是 LF。按原始字节比，两边永远差
 * 「每行一个 \r」——实测 react/vue 模板副本与唯一源逐个字节差 874B，去掉 \r 后哈希完全相同。
 * 这项守卫查的是「副本内容漂没漂」，不是「git  checkout 用了哪种行尾」，
 * 所以差异必须归一到内容本身，否则 Windows 上的 fresh checkout 会一直报假漂移。
 */
function sha256Of(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function checkDeps() {
  section('依赖');
  const nm = path.join(ROOT, 'node_modules');
  const count = exists(nm) ? entryCount(nm) : -1;
  if (count < 0) {
    fail('没有 node_modules', 'npm ci（或 npm install）');
    return;
  }
  if (count < 5) {
    fail(
      `node_modules 只有 ${count} 个条目（空壳），tsc/eslint/jest/react-native 都不可用`,
      'npm ci',
    );
    return;
  }
  ok(`node_modules：${count} 个顶层条目`);
  const missing = ['typescript', 'eslint', 'jest', 'prettier', 'hermes-compiler'].filter(
    pkg => !exists(path.join(nm, pkg)),
  );
  if (missing.length) {
    warn(`缺依赖包：${missing.join(' / ')}（对应命令会直接报错）`, 'npm ci');
  }
}

function checkActiveApp() {
  section('活动子应用（app-registry.json）');
  let app;
  try {
    app = resolveActiveApp();
  } catch (e) {
    fail(`无法解析活动子应用：${e.message}`, 'npm run app:use <子应用名> -- --sync');
    return null;
  }
  ok(`${app.name}（来源 ${app.source}）→ ${path.relative(ROOT, app.dir)}`);
  if (!exists(app.dir)) {
    fail(
      `子应用目录不在盘上：${app.dir}`,
      '把该工程放到注册表登记的相对路径，或 app:use 切到在盘的子应用',
    );
    return app;
  }
  if (!exists(path.join(app.dir, 'app.config.json'))) {
    warn(`缺 app.config.json（品牌/包名/版本的下发源）`, 'npm run brand:apply 前需要它');
  }
  if (!exists(path.join(app.distDir, 'index.html'))) {
    warn(
      `子应用产物不存在：${path.relative(ROOT, app.distDir)}/index.html`,
      '先在子工程 npm run build，再 npm run app:use -- --sync',
    );
  }
  return app;
}

function checkVersion(app) {
  section('版本与包名（version.json）');
  const versionInfo = readJsonSafe(path.join(ROOT, 'version.json'));
  if (!versionInfo) {
    fail('缺 version.json', 'npm run brand:apply（由子应用 app.config.json 下发）');
    return;
  }
  ok(
    `${versionInfo.applicationId} v${versionInfo.versionName}(${
      versionInfo.versionCode
    })，产物命名 ${versionInfo.apkName || '?'}`,
  );
  if (!app || !exists(path.join(app.dir, 'app.config.json'))) return;
  const cfg = readJsonSafe(path.join(app.dir, 'app.config.json'));
  if (!cfg) return;
  const drift = [];
  for (const key of ['applicationId', 'versionName', 'versionCode']) {
    if (cfg[key] !== undefined && String(cfg[key]) !== String(versionInfo[key])) {
      drift.push(`${key}: app.config=${cfg[key]} / version.json=${versionInfo[key]}`);
    }
  }
  if (drift.length) {
    // gradle.js 投递 APK 时会用 output-metadata.json 硬核对这三项，不一致直接拒绝复制。
    fail(
      `version.json 与 ${app.name}/app.config.json 不一致：\n         ${drift.join('\n         ')}`,
      'npm run brand:apply',
    );
  } else {
    ok('version.json 与子应用 app.config.json 一致');
  }
}

function checkH5() {
  section('H5 资源（打进 APK 的 assets）');
  const h5 = path.join(ROOT, 'h5');
  if (!exists(h5)) {
    fail(
      '没有 h5/ 目录 —— 打出的 APK 里没有 H5 页面，装机后白屏',
      'npm run app:use <子应用> -- --sync',
    );
    return;
  }
  const index = path.join(h5, 'index.html');
  if (!exists(index)) {
    fail('h5/ 存在但没有 index.html', 'npm run app:use <子应用> -- --sync');
    return;
  }
  ok(`h5/index.html（${fs.statSync(index).size} bytes）`);
  const html = fs.readFileSync(index, 'utf8');
  if (!html.includes('data-saferea-fix')) {
    // 打包链路会自动补注入，这里只提示当前副本的状态，不改文件。
    warn(
      'h5/index.html 尚未注入安全区修复（edge-to-edge 下导航栏会顶进状态栏）',
      '下次 assemble 自动注入，或 node scripts/fix-h5-safearea.js',
    );
  } else {
    ok('安全区修复已注入');
  }
  if (!html.includes('viewport-fit=cover')) {
    warn('h5/index.html 的 viewport 缺 viewport-fit=cover（iOS 侧 env(safe-area-inset-*) 恒为 0）');
  }
}

/** api.js 副本漂移是「H5 报 UNKNOWN_ACTION / 少一个方法」最常见的原因，直接按哈希比对。 */
function checkApiDrift(app) {
  section('Bridge API 一致性（scripts/api.js 为唯一真源）');
  const source = path.join(ROOT, 'scripts', 'api.js');
  if (!exists(source)) {
    fail('缺唯一源 scripts/api.js');
    return;
  }
  const sourceHash = sha256Of(source);
  const targets = [
    'h5-subapp-setup/assets/react-template/public/js/api.js',
    'h5-subapp-setup/assets/vue-template/public/js/api.js',
    'h5/js/api.js',
  ].map(rel => path.join(ROOT, rel));
  if (app) {
    targets.push(path.join(app.dir, 'public', 'js', 'api.js'));
    targets.push(path.join(app.distDir, 'js', 'api.js'));
  }

  let drifted = 0;
  let absent = 0;
  for (const target of targets) {
    const rel = path.relative(ROOT, target);
    if (!exists(target)) {
      absent++;
      continue;
    }
    if (sha256Of(target) === sourceHash) {
      ok(`${rel} 与源一致`);
    } else {
      drifted++;
      fail(
        `${rel} 与 scripts/api.js 不一致`,
        'npm run sync:api（产物副本用 node scripts/inject-h5-api.js <dist>）',
      );
    }
  }
  if (drifted === 0 && absent > 0) {
    warn(
      `${absent} 个目标副本不在盘上（模板/子应用/h5 未就位时属正常）`,
      '就位后 npm run sync:api 会一并覆盖',
    );
  }
}

/** local.properties 的 qux.* 是隔离构建环境的开关，指错等于回到被换掉的缓存/aapt2。 */
function checkGradleHome() {
  section('Gradle / Android SDK 环境');
  const file = path.join(ROOT, 'platforms', 'android', 'local.properties');
  // SDK 位置二选一：local.properties 的 sdk.dir，或环境变量 ANDROID_HOME / ANDROID_SDK_ROOT。
  // 两者都没有时 gradlew 只会甩一句 "SDK location not found"，看不出该配哪。
  const sdkDir = exists(file) ? readProperty(file, 'sdk.dir') : null;
  const envSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
  if (sdkDir) {
    exists(sdkDir) ? ok(`sdk.dir=${sdkDir}`) : fail(`sdk.dir 指向的目录不存在：${sdkDir}`);
  } else if (envSdk && exists(envSdk)) {
    ok(`SDK 来自环境变量 ANDROID_HOME=${envSdk}（local.properties 无 sdk.dir，正常）`);
  } else {
    fail(
      '找不到 Android SDK（既无 sdk.dir，也无 ANDROID_HOME）',
      '在 platforms/android/local.properties 写 sdk.dir',
    );
  }

  if (!exists(file)) {
    warn(
      '没有 local.properties（gradle 缓存走默认 ~/.gradle，aapt2 走 AGP 自带）',
      '需要隔离时见 README「构建环境例外配置」',
    );
    return;
  }
  // 用 gradle-home.js 自己的解析，别在这里重写一遍 properties 规则：
  // java properties 会把 \ 转义成 \\、: 转义成 \:，两种读法可能拿到不同的值。
  const home = readProperty(file, 'qux.gradleUserHome');
  if (!home) {
    warn(
      '未设置 qux.gradleUserHome（会用共享 ~/.gradle，不同 AGP 版本撞 immutable workspace 就构建失败）',
      'README「构建环境例外配置」',
    );
  } else if (!exists(home)) {
    fail(
      `qux.gradleUserHome 指向的目录不存在：${home}`,
      '新建该目录，或用 junction 指向已有 home 的缓存',
    );
  } else {
    ok(`qux.gradleUserHome=${home}`);
  }
  // qux.aapt2FromMaven 的值是 aapt2 可执行文件本身（不是所在目录），与 gradle-home.js 一致。
  const aapt2 = readProperty(file, 'qux.aapt2FromMaven');
  if (!aapt2) return;
  if (!exists(aapt2)) {
    fail(
      `qux.aapt2FromMaven 指向的文件不存在：${aapt2}`,
      '重新放一份可用 aapt2，或删掉这行改用 maven 版本',
    );
    return;
  }
  const size = fs.statSync(aapt2).size;
  if (size === 534016) {
    // 本机 exe 包装器的落地件就是这个固定体积的 GUI 启动器；构建到一半才报 daemon 超时，不如这里说破。
    fail(
      `qux.aapt2FromMaven 指向的 ${aapt2} 体积 ${size} B，是本机包装器的启动器而非 aapt2`,
      '改用同目录 g 前缀真身',
    );
  } else {
    ok(`qux.aapt2FromMaven=${aapt2}（${size} B）`);
  }
}

/**
 * 三平台链路可用性（安卓 / 鸿蒙 / iOS）。
 *
 * 为什么未就绪只记 WARN 不记 FAIL：本基座的默认链路是安卓，鸿蒙与 iOS 是「按需点亮」。
 * 记 FAIL 会造出「doctor 报红但 build:android 完全正常」的误导。
 * 真正的硬闸在 scripts/harmony-ready.js —— dev:harmony / build:harmony 撞上 blockers 直接退出。
 */
function checkPlatforms() {
  section('平台链路（安卓 / 鸿蒙 / iOS）');
  ok('安卓：npm run dev / build:android（默认链路，SDK 与 gradle 见上一节）');

  const harmony = checkHarmonyReady(ROOT);
  if (harmony.blockers.length) {
    warn(
      `鸿蒙链路未就绪（${harmony.blockers.length} 项），` +
        'npm run dev:harmony / build:harmony 会在闸上退出，不影响安卓：' +
        `\n${harmony.blockers.map(b => `         · ${b}`).join('\n')}`,
      '版本要求与装法见 README「鸿蒙（RNOH）」',
    );
  } else {
    ok(`鸿蒙：前置检查通过（react-native ${harmony.rnVersion || '?'}）`);
  }
  for (const w of harmony.warnings) console.log(`         · 鸿蒙提醒：${w}`);
  for (const n of harmony.notes) console.log(`         · 鸿蒙说明：${n}`);

  const ws = findWorkspace();
  const podsDone = exists(path.join(iosDir, 'Podfile.lock'));
  info(
    `iOS：${exists(iosDir) ? '工程 platforms/ios 在' : '缺 platforms/ios'} / ` +
      `${podsDone ? 'pod install 已跑' : '未 pod install（npm run ios:pods）'} / ` +
      `${ws ? `workspace ${path.basename(ws)}` : '无 .xcworkspace'} / ` +
      `自研原生模块 ${nativeSources().length} 个文件；出包只能在 macOS`,
  );
  if (KNOWN_GAPS.length) {
    warn(
      `iOS 链路已知缺口：\n${KNOWN_GAPS.map(g => `         · ${g}`).join('\n')}`,
      '逐条核对：npm run ios:doctor',
    );
  }
}

function main() {
  console.log('[doctor] RNbase 构建环境自查（只读）');
  checkDeps();
  const app = checkActiveApp();
  checkVersion(app);
  checkH5();
  checkApiDrift(app);
  checkGradleHome();
  checkPlatforms();

  // hermesc 放最后：它自身的失败会直接 process.exit(1)，前面的检查先全部报完再让它接管。
  section('hermesc 字节码编译器');
  checkHermesc(ROOT);

  console.log(
    `\n[doctor] 完成：${fails} 个 FAIL，${warns} 个 WARN。` +
      (fails ? ' 先处理 FAIL 再打包。' : ' 可以打包。'),
  );
  process.exitCode = fails ? 1 : 0;
}

main();
