#!/usr/bin/env node
/**
 * 基座品牌中性守卫（提交/CI 用），两层判断：
 *
 * 第一层「资源文件品牌中性」：`apply-app-meta.js` 下发子应用品牌时会把具体 App 的值写进
 * **仓库可见**路径（Android strings.xml 的 app_name、colors.xml 的 splash_bg、闪屏 drawable、
 * 图标位图、鸿蒙两个 string.json）。打完一个租户的包就去提交基座，那个租户的名字/底色/图标
 * 就跟着进基座历史了。这里把「该不该复位」变成一条机器判断，不靠人记得跑 --reset。
 * 判据的唯一真源是 apply-app-meta.js 的 NEUTRAL 常量——两边各写一份迟早会漂。
 *
 * 第二层「tracked 源码违禁词清单」：第一层只看资源落点，源码/注释/测试里写死的租户包名、
 * App 名（例如某个租户的 `com.xxx.app`、桌面名）当时完全不在扫描面内，已经漏掉过残留。
 * 现在把 `git ls-files` 出来的 tracked 文本文件逐行按词表匹配一遍。词表来自仓库根的
 * brand-denylist.txt（已 gitignore，只存在于本机）：**租户名本身也是不能进仓库的内容**，
 * 所以本脚本一个具体租户词都不写，硬编码进去就等于用另一种方式泄漏租户身份。
 * 没有本地词表时（CI 就是这样）跳过这一层、只提示，不算失败。
 *
 * 用法：
 *   node scripts/check-brand-neutral.js            # 当前仓库
 *   node scripts/check-brand-neutral.js --base D:/x/app_base
 *
 * 第一层不过的修法：`npm run brand:reset`；第二层不过：把命中的租户标识改成中性命名。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { NEUTRAL } = require('./apply-app-meta');

/** 与 apply-app-meta.js 一致的双布局定位：新基座 platforms/android，旧基座顶层 android。 */
function resolveAndroidMain(baseDir) {
  for (const rel of [['platforms', 'android'], ['android']]) {
    const p = path.join(baseDir, ...rel, 'app', 'src', 'main');
    if (fs.existsSync(p)) return p;
  }
  return path.join(baseDir, 'platforms', 'android', 'app', 'src', 'main');
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 取 <string name="X">value</string> 的 value；文件缺失或键缺失返回 null。 */
function xmlValue(source, tag, name) {
  if (source === null) return null;
  const m = source.match(new RegExp(`<${tag}\\s+name="${name}"[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

/** 取 harmony string.json 里指定 name 的 value。 */
function harmonyValue(source, name) {
  if (source === null) return null;
  let items;
  try {
    items = JSON.parse(source).string;
  } catch {
    return undefined; // 解析不了另报
  }
  if (!Array.isArray(items)) return undefined;
  const hit = items.find(i => i && i.name === name);
  return hit ? hit.value : undefined;
}

/**
 * 返回漂移清单（空数组即中性基座）。
 * 每一项都是「人一眼能懂、且知道怎么修」的一句话。
 */
function collectBrandDrift(baseDir) {
  const problems = [];
  const androidMain = resolveAndroidMain(baseDir);
  const rel = p => path.relative(baseDir, p).replace(/\\/g, '/');

  const stringsXml = readIfExists(path.join(androidMain, 'res', 'values', 'strings.xml'));
  if (stringsXml !== null) {
    const v = xmlValue(stringsXml, 'string', 'app_name');
    if (v !== NEUTRAL.appName) {
      problems.push(
        `${rel(path.join(androidMain, 'res', 'values', 'strings.xml'))} app_name="${v}"（应为 "${
          NEUTRAL.appName
        }"）`,
      );
    }
  }

  const colorsXml = readIfExists(path.join(androidMain, 'res', 'values', 'colors.xml'));
  if (colorsXml !== null) {
    const v = xmlValue(colorsXml, 'color', 'splash_bg');
    if (v !== null && v !== NEUTRAL.splashBackgroundColor) {
      problems.push(
        `${rel(path.join(androidMain, 'res', 'values', 'colors.xml'))} splash_bg=${v}（应为 ${
          NEUTRAL.splashBackgroundColor
        }）`,
      );
    }
  }

  const splash = readIfExists(path.join(androidMain, 'res', 'drawable', 'splash_screen.xml'));
  if (splash !== null && /splash_logo/.test(splash)) {
    // 中性基座的闪屏层不引用任何子应用 logo，引用了就是某个 App 的品牌残留
    problems.push(
      `${rel(
        path.join(androidMain, 'res', 'drawable', 'splash_screen.xml'),
      )} 仍引用 splash_logo 品牌图`,
    );
  }

  // 图标位图：与 brand-default 逐字节比，不一致说明装过某个子应用的图标
  const resDir = path.join(androidMain, 'res');
  const defaultDir = path.join(androidMain, 'brand-default');
  if (fs.existsSync(resDir) && fs.existsSync(defaultDir)) {
    for (const e of fs.readdirSync(defaultDir, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.startsWith('mipmap-')) continue;
      const srcDir = path.join(defaultDir, e.name);
      for (const f of fs.readdirSync(srcDir)) {
        const want = fs.readFileSync(path.join(srcDir, f));
        const gotPath = path.join(resDir, e.name, f);
        if (!fs.existsSync(gotPath)) {
          problems.push(`${rel(gotPath)} 缺失（基座默认图标被清掉未复原）`);
          continue;
        }
        // 位图只能按字节比：utf8 读二进制会把非法字节替换成 U+FFFD，同样的文件也会被判成不一致
        if (Buffer.compare(want, fs.readFileSync(gotPath)) !== 0) {
          problems.push(`${rel(gotPath)} 与 brand-default 不一致（子应用图标残留）`);
        }
      }
    }
  }

  // 鸿蒙：桌面名两处
  for (const [file, name] of [
    [
      path.join(baseDir, 'harmony', 'AppScope', 'resources', 'base', 'element', 'string.json'),
      'app_name',
    ],
    [
      path.join(
        baseDir,
        'harmony',
        'entry',
        'src',
        'main',
        'resources',
        'base',
        'element',
        'string.json',
      ),
      'EntryAbility_label',
    ],
  ]) {
    if (!fs.existsSync(file)) continue;
    const src = readIfExists(file);
    const v = harmonyValue(src, name);
    if (v === undefined) {
      problems.push(`${rel(file)} 解析失败或没有 ${name} 项`);
    } else if (v !== NEUTRAL.appName) {
      problems.push(`${rel(file)} ${name}="${v}"（应为 "${NEUTRAL.appName}"）`);
    }
  }

  return problems;
}

/** 本地违禁词清单的文件名（仓库根，已 gitignore）。 */
const DENYLIST_FILE = 'brand-denylist.txt';

/** 文本扫描没有意义的二进制/产物扩展名。 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.mp3',
  '.mp4',
  '.wav',
  '.jar',
  '.aar',
  '.so',
  '.dylib',
  '.zip',
  '.gz',
  '.keystore',
  '.jks',
  '.apk',
  '.aab',
  '.hap',
  '.har',
  '.ipa',
  '.exe',
  '.dll',
  '.pdb',
  '.class',
  '.pyc',
]);

/** 单文件超过这个字节数就不读：tracked 里混进的大文本基本只有派生产物，命中概率极低、代价极高。 */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * 读本地违禁词清单：一行一个词，`#` 开头算注释，空行忽略，匹配时大小写不敏感。
 * 文件不存在返回 null（调用方据此跳过第二层，CI 上就是这个分支，不能让它变红）。
 */
function loadBrandDenylist(baseDir) {
  const raw = readIfExists(path.join(baseDir, DENYLIST_FILE));
  if (raw === null) return null;
  const words = [];
  for (const line of raw.split(/\r?\n/)) {
    const word = line.trim();
    if (word === '' || word.startsWith('#')) continue;
    if (!words.includes(word)) words.push(word);
  }
  return words;
}

/**
 * tracked 文本文件清单（相对 baseDir、正斜杠）。
 * `git ls-files` 默认只列索引里的文件（未跟踪/被 ignore 的不算），路径恒用正斜杠，
 * 所以调用方按 '/' 拆开交给 path.join 拼绝对路径——在 Windows 上手拼字符串会拼出混合分隔符。
 * 拿不到清单（非 git 环境 / 没装 git）返回 files: null + 原因，由上层降级成提示。
 */
function listTrackedTextFiles(baseDir) {
  let stdout;
  try {
    stdout = execFileSync('git', ['-C', baseDir, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const firstLine = String(err && err.message ? err.message : err).split('\n')[0];
    return { files: null, reason: `git ls-files 取不到 tracked 文件（${firstLine}）` };
  }
  const files = [];
  for (const rel of stdout.split('\0')) {
    if (rel === '') continue;
    // 词表自己每行都写着一个违禁词，扫它必然全命中
    if (rel === DENYLIST_FILE) continue;
    if (BINARY_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    files.push(rel);
  }
  return { files, reason: null };
}

/**
 * 第二层守卫：tracked 文本文件里是否出现本地违禁词。
 * 返回 { problems, skipped }——skipped 非空表示这一层这次没扫（没配词表 / 非 git 环境），
 * 只提示不失败；problems 每一项是「文件:行号 + 命中词」。
 */
function collectDenylistDrift(baseDir) {
  const words = loadBrandDenylist(baseDir);
  if (words === null) {
    return { problems: [], skipped: `未配置本地违禁词清单（${DENYLIST_FILE}），跳过源码扫描` };
  }
  if (words.length === 0) {
    return {
      problems: [],
      skipped: `本地违禁词清单（${DENYLIST_FILE}）没有有效词条，跳过源码扫描`,
    };
  }
  const tracked = listTrackedTextFiles(baseDir);
  if (tracked.files === null) {
    return { problems: [], skipped: `${tracked.reason}，跳过源码扫描` };
  }

  const problems = [];
  const lowered = words.map(w => w.toLowerCase());
  for (const rel of tracked.files) {
    const abs = path.join(baseDir, ...rel.split('/'));
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue; // tracked 但工作区里没有：改名/删除还没暂存，不是品牌问题
    }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue;
    const text = readIfExists(abs);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].toLowerCase();
      for (let w = 0; w < lowered.length; w += 1) {
        if (line.includes(lowered[w])) {
          problems.push(`${rel}:${i + 1} 命中违禁词 "${words[w]}"（来自 ${DENYLIST_FILE}）`);
        }
      }
    }
  }
  return { problems, skipped: null };
}

function main() {
  const i = process.argv.indexOf('--base');
  const baseDir = path.resolve(i === -1 ? path.resolve(__dirname, '..') : process.argv[i + 1]);
  const problems = collectBrandDrift(baseDir);
  const deny = collectDenylistDrift(baseDir);
  if (deny.skipped) console.log(`[brand] ${deny.skipped}`);
  if (problems.length === 0 && deny.problems.length === 0) {
    console.log(`[brand] 中性基座校验通过：${baseDir}`);
    return;
  }
  if (problems.length > 0) {
    console.error('[brand] 基座带着具体 App 的品牌信息，提交前请复位（npm run brand:reset）：');
    for (const p of problems) console.error(`  - ${p}`);
  }
  if (deny.problems.length > 0) {
    console.error(
      `[brand] tracked 文本文件里残留具体 App 的身份标识，请改成中性命名后再提交（词表见本地 ${DENYLIST_FILE}，不入库）：`,
    );
    for (const p of deny.problems) console.error(`  - ${p}`);
  }
  process.exit(1);
}

module.exports = {
  collectBrandDrift,
  resolveAndroidMain,
  collectDenylistDrift,
  loadBrandDenylist,
  listTrackedTextFiles,
  DENYLIST_FILE,
};

if (require.main === module) {
  main();
}
