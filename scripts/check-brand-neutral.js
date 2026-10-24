#!/usr/bin/env node
/**
 * 基座品牌中性守卫（提交/CI 用）。
 *
 * 存在的理由：`apply-app-meta.js` 下发子应用品牌时会把具体 App 的值写进**仓库可见**路径
 * （Android strings.xml 的 app_name、colors.xml 的 splash_bg、闪屏 drawable、图标位图、
 * 鸿蒙两个 string.json）。打完一个租户的包就去提交基座，那个租户的名字/底色/图标就跟着
 * 进基座历史了。这里把「该不该复位」变成一条机器判断，不靠人记得跑 --reset。
 *
 * 判据的唯一真源是 apply-app-meta.js 的 NEUTRAL 常量——两边各写一份迟早会漂。
 *
 * 用法：
 *   node scripts/check-brand-neutral.js            # 当前仓库
 *   node scripts/check-brand-neutral.js --base D:/x/app_base
 *
 * 不复位就过不去时的修法：`npm run brand:reset`。
 */
'use strict';

const fs = require('fs');
const path = require('path');
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
  const hit = items.find((i) => i && i.name === name);
  return hit ? hit.value : undefined;
}

/**
 * 返回漂移清单（空数组即中性基座）。
 * 每一项都是「人一眼能懂、且知道怎么修」的一句话。
 */
function collectBrandDrift(baseDir) {
  const problems = [];
  const main = resolveAndroidMain(baseDir);
  const rel = (p) => path.relative(baseDir, p).replace(/\\/g, '/');

  const stringsXml = readIfExists(path.join(main, 'res', 'values', 'strings.xml'));
  if (stringsXml !== null) {
    const v = xmlValue(stringsXml, 'string', 'app_name');
    if (v !== NEUTRAL.appName) {
      problems.push(
        `${rel(path.join(main, 'res', 'values', 'strings.xml'))} app_name="${v}"（应为 "${
          NEUTRAL.appName
        }"）`
      );
    }
  }

  const colorsXml = readIfExists(path.join(main, 'res', 'values', 'colors.xml'));
  if (colorsXml !== null) {
    const v = xmlValue(colorsXml, 'color', 'splash_bg');
    if (v !== null && v !== NEUTRAL.splashBackgroundColor) {
      problems.push(
        `${rel(path.join(main, 'res', 'values', 'colors.xml'))} splash_bg=${v}（应为 ${
          NEUTRAL.splashBackgroundColor
        }）`
      );
    }
  }

  const splash = readIfExists(path.join(main, 'res', 'drawable', 'splash_screen.xml'));
  if (splash !== null && /splash_logo/.test(splash)) {
    // 中性基座的闪屏层不引用任何子应用 logo，引用了就是某个 App 的品牌残留
    problems.push(
      `${rel(path.join(main, 'res', 'drawable', 'splash_screen.xml'))} 仍引用 splash_logo 品牌图`
    );
  }

  // 图标位图：与 brand-default 逐字节比，不一致说明装过某个子应用的图标
  const resDir = path.join(main, 'res');
  const defaultDir = path.join(main, 'brand-default');
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
        'string.json'
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

function main() {
  const i = process.argv.indexOf('--base');
  const baseDir = path.resolve(i === -1 ? path.resolve(__dirname, '..') : process.argv[i + 1]);
  const problems = collectBrandDrift(baseDir);
  if (problems.length === 0) {
    console.log(`[brand] 中性基座校验通过：${baseDir}`);
    return;
  }
  console.error('[brand] 基座带着具体 App 的品牌信息，提交前请复位（npm run brand:reset）：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { collectBrandDrift, resolveAndroidMain };

if (require.main === module) {
  main();
}
