#!/usr/bin/env node
/**
 * 新建 H5 子应用脚手架。
 *
 * 一个「子应用」在物理上是基座的**同级目录**（约定见 README 两仓配合一节），在逻辑上
 * 需要三样东西同时成立才算完整：
 *   1. 工程本体（模板：Vite + Vue/React，已含 hash 路由 / 相对路径 / IIFE / public/js/api.js）
 *   2. 对接脚本（scripts/ 三个薄壳：sync-to-base / inject-api / apply-app-meta）
 *   3. 在基座 app-registry.json 里登记，才会被 app:use / gradle / hvigor 认出来
 *
 * 模板目录里只有 (1)，(2)(3) 此前靠手工复制，是本脚本存在的唯一理由。
 * 打包工作台（RNBuild Studio）的「新建子应用」向导直接 spawn 本脚本，不自己复制文件。
 *
 * 用法：
 *   node scripts/create-subapp.js --name demo_h5 --framework vue --app-name "演示应用"
 *   node scripts/create-subapp.js --name demo_h5 --framework react --app-name "演示" \
 *        --application-id com.qux.demo --apk-name Demo --version-name 1.0.0 --version-code 1
 *
 *   # 仅配置应用（远程站点打包用，无源码、无需 npm install）：
 *   node scripts/create-subapp.js --name remote_site_demo --no-source \
 *        --app-name "示例站点" --application-id com.qux.demo --remote-url https://xxx.host/
 *
 * 参数：
 *   --name            必填。子应用目录名（建在基座同级），建议 xxx_h5
 *   --framework       必填（仅配置应用不用）。vue | react
 *   --no-source       只建「配置应用」：app.config.json + app-brand/，不含源码。
 *                     远程站点打包用，必须同时给 --remote-url。
 *   --remote-url      远程站点地址（配置应用必填，须 http(s)）
 *   --app-name        应用名（中文），缺省取 name
 *   --application-id  应用包名，缺省 com.qux.<name 去掉 _h5 后缀>
 *   --apk-name        安装包文件名，缺省首字母大写的 app-name 去空格
 *   --app-id          H5 子应用标识（window.__H5_APP_ID__），缺省取 name
 *   --version-name    缺省 1.0.0
 *   --version-code    缺省 1
 *   --splash          闪屏底色，缺省 #08080D
 *   --dist            产物目录名，缺省 dist
 *   --no-register     只建工程，不写入 app-registry.json
 *   --force           目标目录已存在时仍覆盖（会先清空该目录）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_ROOT = path.join(ROOT, 'h5-subapp-setup', 'assets');
const REGISTRY_FILE = path.join(ROOT, 'app-registry.json');

// ── 参数解析 ────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true; // 开关型：--force / --no-register
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const fail = msg => {
  console.error(`[create-subapp] ${msg}`);
  process.exit(1);
};

const name = args.name;
if (!name || name === true) {
  fail('缺少 --name（子应用目录名，例如 demo_h5）');
}
// 目录名会被写进注册表、拼进路径、也可能被 Gradle 用作产物名，收紧到安全字符集
if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
  fail(`--name 只允许字母/数字/下划线/连字符且以字母开头：${name}`);
}

/**
 * --no-source：只建「配置应用」——远程站点打包用，不复制任何源码。
 * 这类应用只需要 app.config.json（品牌 + 远程地址）+ app-brand/（图标），
 * 没有 package.json / dist / 对接脚本，也不需要 npm install。
 */
const noSource = args['no-source'] === true;

const framework = args.framework;
if (!noSource && framework !== 'vue' && framework !== 'react') {
  fail(`--framework 必须是 vue 或 react（当前：${framework ?? '未填'}）`);
}

const templateDir = path.join(TEMPLATE_ROOT, `${framework}-template`);
if (!noSource && !fs.existsSync(templateDir)) {
  fail(`模板目录不存在：${templateDir}`);
}
const sharedScripts = path.join(TEMPLATE_ROOT, 'shared-scripts');
if (!noSource && !fs.existsSync(sharedScripts)) {
  fail(`共享脚本目录不存在：${sharedScripts}（子应用对接脚本的模板）`);
}

// 子应用建在基座「同级目录」——这是两仓配合的硬约定，不做可配置
const siblingRoot = path.resolve(ROOT, '..');
const targetDir = path.resolve(siblingRoot, name);
if (path.dirname(targetDir) !== siblingRoot) {
  // 兜底自检：确保解析出来确实是同级的直接子目录，而不是被 name 里的 ../ 带偏
  fail(`--name 不允许包含路径分隔符或 ..：${name}`);
}

const appName = typeof args['app-name'] === 'string' ? args['app-name'] : name;
const shortName = name.replace(/_h5$/, '');
// 默认安装包名转驼峰：demo_h5 -> Demo、probe_app -> ProbeApp（下划线在产物文件名里不好看）
const camelName = shortName
  .split(/[_-]/)
  .filter(Boolean)
  .map(s => s.charAt(0).toUpperCase() + s.slice(1))
  .join('');
const applicationId =
  typeof args['application-id'] === 'string'
    ? args['application-id']
    : `com.qux.${shortName.toLowerCase()}`;
const apkName = typeof args['apk-name'] === 'string' ? args['apk-name'] : camelName || name;
const appId = typeof args['app-id'] === 'string' ? args['app-id'] : name;
const versionName = typeof args['version-name'] === 'string' ? args['version-name'] : '1.0.0';
const versionCode = Number(args['version-code'] ?? 1);
const splash = typeof args.splash === 'string' ? args.splash : '#08080D';
const distDirName = typeof args.dist === 'string' ? args.dist : 'dist';

if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(applicationId) || applicationId.split('.').length < 2) {
  fail(`--application-id 必须是反写域名格式（如 com.qux.demo）：${applicationId}`);
}
if (!Number.isInteger(versionCode) || versionCode < 1) {
  fail(`--version-code 必须是正整数：${args['version-code']}`);
}
if (!/^#[0-9a-fA-F]{6}$/.test(splash)) {
  fail(`--splash 必须是 #RRGGBB 格式：${splash}`);
}

// 远程站点地址：配置应用的必填项（它没有本地 H5 产物，没有网址就只能白屏）
const remoteUrl = typeof args['remote-url'] === 'string' ? args['remote-url'] : '';
if (noSource) {
  if (!remoteUrl) {
    fail('仅配置应用必须同时给 --remote-url <网址>：这类应用没有本地 H5 产物');
  }
  if (!/^https?:\/\/\S+$/.test(remoteUrl)) {
    fail(`--remote-url 必须是 http(s) 地址：${remoteUrl}`);
  }
}

// ── 1. 建目录并铺内容 ───────────────────────────────────────
if (fs.existsSync(targetDir)) {
  if (args.force !== true) {
    fail(`目标目录已存在：${targetDir}\n  （确认要覆盖请加 --force，该目录会被清空）`);
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log(`[create-subapp] 已清空既有目录：${targetDir}`);
}

if (noSource) {
  // 仅配置应用：远程站点打包用。只要 app.config.json + app-brand/，不掺任何源码，
  // 因此不需要 npm install / build，天然不会与「本地子应用」的构建链混淆。
  fs.mkdirSync(path.join(targetDir, 'app-brand'), { recursive: true });
  console.log(`[create-subapp] 已创建配置应用目录 → ${targetDir}（无源码）`);
} else {
  fs.cpSync(templateDir, targetDir, { recursive: true });
  console.log(`[create-subapp] 已复制 ${framework} 模板 → ${targetDir}`);

  // 2. 补齐对接脚本（模板里没有，靠它们同步产物 / 注入 api.js / 下发品牌）
  const targetScripts = path.join(targetDir, 'scripts');
  fs.mkdirSync(targetScripts, { recursive: true });
  for (const f of fs.readdirSync(sharedScripts)) {
    fs.copyFileSync(path.join(sharedScripts, f), path.join(targetScripts, f));
  }
  console.log(
    '[create-subapp] 已补齐对接脚本 scripts/（sync-to-base / inject-api / apply-app-meta）',
  );
}

if (!noSource) {
  // ── 3. 改写 package.json：工程名 + 与既有子应用对齐的 scripts 集合 ──
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = name;
  pkg.version = versionName;
  pkg.scripts = {
    ...pkg.scripts,
    // build 必须走 inject-api：把基座 scripts/api.js 注入产物，保证 Bridge 协议同版本
    build: 'vite build && node scripts/inject-api.js dist',
    // build:base 是给基座用的完整链路：构建 → 注入 → 同步进基座 h5/ → 下发品牌
    'build:base':
      'vite build && node scripts/inject-api.js dist && node scripts/sync-to-base.js && node scripts/apply-app-meta.js',
    'sync:base': 'node scripts/sync-to-base.js',
    'sync:api': 'node scripts/inject-api.js public',
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('[create-subapp] 已写入 package.json（build / build:base / sync:base / sync:api）');
}

if (!noSource) {
  // ── 4. 改写 index.html：标题 + appId 声明 ─────────────────
  // appId 必须在 api.js 之前赋值（api.js 加载时即读取），未声明时回落默认 base_h5。
  const htmlPath = path.join(targetDir, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const before = html;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${appName}</title>`);
  if (/window\.__H5_APP_ID__/.test(html)) {
    html = html.replace(
      /window\.__H5_APP_ID__\s*=\s*['"][^'"]*['"]/,
      `window.__H5_APP_ID__ = '${appId}'`,
    );
  } else {
    // 只捕获行首缩进（不含换行），避免 $1 自带换行导致注入块出现空行；
    // 把 appId 块插在 api.js 与其前导注释**之前**，与既有子应用（RN_h5）的顺序一致。
    html = html.replace(
      /([ \t]*)((?:<!--[\s\S]*?-->[ \t]*\n)?[ \t]*<script src="\.\/js\/api\.js"><\/script>)/,
      (_m, indent, bridge) =>
        `${indent}<!-- 子应用标识：必须在 api.js 之前注入（api.js 加载时读取） -->\n` +
        `${indent}<script>\n` +
        `${indent}  window.__H5_APP_ID__ = '${appId}';\n` +
        `${indent}</script>\n` +
        `${indent}${bridge}`,
    );
  }
  if (html === before) {
    console.warn('[create-subapp] 警告：index.html 未发生改动，请检查模板格式是否变化');
  }
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`[create-subapp] 已写入 index.html（标题「${appName}」、appId「${appId}」）`);
}

// ── 5. 写 app.config.json（品牌与版本的唯一真源）────────────
const appConfig = {
  appName,
  apkName,
  applicationId,
  versionName,
  versionCode,
  splashBackgroundColor: splash,
};
// remoteUrl 只对配置应用有意义（本地子应用留空 = 加载自己的 h5 产物）
if (remoteUrl) {
  appConfig.remoteUrl = remoteUrl;
}
fs.writeFileSync(
  path.join(targetDir, 'app.config.json'),
  JSON.stringify(appConfig, null, 2) + '\n',
  'utf8',
);
console.log('[create-subapp] 已写入 app.config.json');

// ── 6. 登记进 app-registry.json（否则 app:use 不认这个子应用）──
// app-registry.json 不入库，用 example 兜底，避免新克隆环境下首次建站没有可写的底稿
function readRegistry() {
  if (fs.existsSync(REGISTRY_FILE)) return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  const example = path.join(ROOT, 'app-registry.example.json');
  if (fs.existsSync(example)) return JSON.parse(fs.readFileSync(example, 'utf8'));
  return { activeApp: '', apps: {} };
}

if (args['no-register'] === true) {
  console.log('[create-subapp] --no-register：跳过注册表登记');
} else {
  const registry = readRegistry();
  if (!registry.apps || typeof registry.apps !== 'object') registry.apps = {};
  registry.apps[name] = { dir: `../${name}`, dist: distDirName };
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  console.log(
    `[create-subapp] 已登记到 app-registry.json：${name} → ../${name}（产物 ${distDirName}）`,
  );
}

// ── 7. 输出下一步（命令行与打包工作台都直接展示这段）────────
console.log('');
if (noSource) {
  console.log(`[create-subapp] 配置应用已创建（远程站点：${remoteUrl}）。接下来：`);
  console.log(
    `  1) cd ${ROOT} && npm run app:use -- ${name}   # 设为当前应用并下发品牌（注意：不要加 --sync）`,
  );
  console.log('  2) 回打包向导，选「远程站点」模式直接构建');
  console.log('');
  console.log('  说明：这类应用没有源码与 dist，所以不需要 npm install / build，也不能带 --sync。');
  console.log('        要换网址或图标，改 app.config.json / app-brand/ 后重新 app:use 即可。');
} else {
  console.log('[create-subapp] 子应用已创建。接下来：');
  console.log(`  1) cd ${targetDir} && npm install`);
  console.log('  2) npm run build:base   # 构建 + 注入 api.js + 同步进基座 h5/ + 下发品牌');
  console.log(`  3) cd ${ROOT} && npm run app:use -- ${name} --sync`);
  console.log('');
  console.log('  （打包工作台里可直接点「安装依赖」「构建并同步」「设为当前子应用」）');
}
