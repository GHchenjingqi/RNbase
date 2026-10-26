/**
 * H5 Bridge API 同步脚本。
 *
 * 唯一源文件：scripts/api.js（子应用模板的 Bridge API 源，由 h5-subapp-setup/scripts/api.js 迁移而来）
 * 同步目标：React 模板、Vue 模板、当前 H5 子项目、基座 h5/js/api.js。
 *
 * - 模板 public/js/api.js：仅子应用开发期（vite dev server）使用；
 * - 基座 h5/js/api.js：内置 H5 打进 APK assets，生产环境 WebView 实际加载的 api.js；
 * - 子应用打包产物（dist/js/api.js）：打 zip 前用 node scripts/inject-h5-api.js <dist> 覆盖。
 * 三者都必须与源文件保持一致。
 *
 * 用法：node scripts/sync-h5-api.js
 * 效果：将 scripts/api.js 覆盖拷贝到所有目标，
 *       保证只有一份需要维护的 api.js。
 *
 * 修改流程：改 scripts/api.js → 运行本脚本同步。
 */
const fs = require('fs');
const path = require('path');
const { resolveActiveApp } = require('./active-app');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'scripts', 'api.js');

// 同步目标列表（相对于项目根目录；支持 ../ 引用兄弟项目）
const STATIC_TARGETS = [
  'h5-subapp-setup/assets/react-template/public/js/api.js',
  'h5-subapp-setup/assets/vue-template/public/js/api.js',
  'h5/js/api.js',
];

/**
 * 活动子应用的 public/js/api.js 从 app-registry.json 解析，和 gradle.js / dev.js 用同一真源：
 * 硬编码 ../app_h5 会把 api.js 写进早已不是当前 App 的工程，真正在用的子应用反而漏同步。
 */
function resolveTargets() {
  const targets = [...STATIC_TARGETS];
  try {
    targets.push(path.join(resolveActiveApp().dir, 'public', 'js', 'api.js'));
  } catch (e) {
    console.warn(`[sync-h5-api] 未解析活动子应用，跳过其 public/js/api.js：${e.message}`);
  }
  return targets;
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`[sync-h5-api] 源文件不存在: ${SOURCE}`);
    process.exit(1);
  }

  const targets = resolveTargets();
  const content = fs.readFileSync(SOURCE, 'utf8');
  const sourceHash = hash(content);
  let updated = 0;
  let skipped = 0;

  console.log(`[sync-h5-api] 源文件: ${path.relative(ROOT, SOURCE)}`);
  console.log(
    `[sync-h5-api] 源文件大小: ${Buffer.byteLength(content, 'utf8')} bytes, 目标数: ${
      targets.length
    }\n`,
  );

  for (const rel of targets) {
    const target = path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
    const display = path.relative(ROOT, target);
    const dir = path.dirname(target);

    // 目录不存在 = 该工程/内置 H5 在当前机器上根本没就位（例如子应用还没 clone）。
    // 这里只跳过、不 mkdir：凭空造出 ../xxx_h5/public/js/ 或 h5/ 只会留下半截空目录，
    // 让人误以为该目标已同步过。
    if (!fs.existsSync(dir)) {
      console.log(`  [跳过] ${display}（目录不存在，工程未就位）`);
      skipped++;
      continue;
    }

    // 对比内容，相同则跳过
    if (fs.existsSync(target)) {
      const existing = fs.readFileSync(target, 'utf8');
      if (hash(existing) === sourceHash) {
        console.log(`  [跳过] ${display}（内容一致）`);
        skipped++;
        continue;
      }
    }

    fs.writeFileSync(target, content, 'utf8');
    console.log(`  [同步] ${display}`);
    updated++;
  }

  console.log(
    `\n[sync-h5-api] 完成：更新 ${updated} 个，跳过 ${skipped} 个，共 ${targets.length} 个目标。`,
  );
}

/**
 * 简单内容哈希（用于对比，非加密）。
 * 先统一行尾：core.autocrlf=true 会把入库的 LF 落地成 CRLF，按原始字节比会把
 * 「checkout 的行尾」误判成「副本漂移」，进而每趟构建都无谓重写一遍模板文件。
 */
function hash(str) {
  const normalized = str.replace(/\r\n/g, '\n');
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) - h + normalized.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

main();
