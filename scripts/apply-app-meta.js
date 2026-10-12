#!/usr/bin/env node
/**
 * 将 H5 子工程的 App 品牌参数下发到 RN 通用基座（app_base）。
 *
 * 基座是通用壳，不内置任何具体 App 参数；具体应用的下列信息完全由 H5 子工程持有，
 * 在执行各自的 `npm run build:base` 时由本脚本写入/覆盖基座：
 *   - appName          桌面应用显示名（strings.xml 的 app_name）
 *   - applicationId    包名（不同子应用包名不同即可并排安装、互不覆盖）
 *   - apkName          英文 APK 文件名前缀
 *   - versionName/Code 版本号
 *   - 图标             app-brand/android/mipmap-<density>/ic_launcher.png 与 ic_launcher_round.png（可选）
 *   - 闪屏             app-brand/android/drawable-<density>/splash_logo.png + 底色（可选）
 *
 * harmony/ 工程存在时（见 README「鸿蒙（RNOH）」）额外同步：桌面名（AppScope 与 entry 的
 * string.json）+ app.json5 的 versionName/versionCode。bundleName 与鸿蒙图标不动，
 * 理由见 applyHarmonyMeta 的注释。
 *
 * 配置源：<app>/app.config.json；品牌图：<app>/app-brand/android/。
 * 目标子应用解析顺序：--app <注册表键名|目录路径> > app-registry.json 的 activeApp。
 *
 * version.json 是**构建期派生产物**（每次由本脚本从 app.config.json 整体重写），
 * 不要手改，也不要用 bump-version 单独维护——版本递增的唯一真源是 app.config.json。
 *
 * 用法：
 *   node scripts/apply-app-meta.js                 # 活动子应用
 *   node scripts/apply-app-meta.js --app app_h5    # 指定注册表中的子应用
 *   node scripts/apply-app-meta.js --reset         # 复原成中性基座（提交基座前跑）
 *   BASE_DIR=D:/x/app_base node scripts/apply-app-meta.js
 *
 * --reset 存在的理由：下发会把 App 数据写进基座的**仓库可见**路径（strings.xml 的 app_name、
 * colors.xml 的 splash_bg、图标位图、harmony 的两个 string.json）。位图与 version.json /
 * app-registry.json 已进 .gitignore，文本那几处只能靠复原清掉——提交基座前先跑一次，
 * 基座仓库就不会带上任何一个具体 App 的配置。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveActiveApp } = require('./active-app');

const ROOT = path.resolve(__dirname, '..');
const baseDir = path.resolve(process.env.BASE_DIR || ROOT);
const ANDROID_MAIN = path.join(baseDir, 'platforms', 'android', 'app', 'src', 'main');
const RES_DIR = path.join(ANDROID_MAIN, 'res');
const BRAND_DEFAULT = path.join(ANDROID_MAIN, 'brand-default');
const BASE_VERSION = path.join(baseDir, 'version.json');
const STRINGS_XML = path.join(RES_DIR, 'values', 'strings.xml');
const COLORS_XML = path.join(RES_DIR, 'values', 'colors.xml');
const SPLASH_DRAWABLE = path.join(RES_DIR, 'drawable', 'splash_screen.xml');

/**
 * 中性基座状态（--reset 写回这套值）。这些是基座自身的占位身份，不属于任何具体 App，
 * 所以可以留在仓库可见路径里；具体 App 的值一律由子应用 app.config.json 持有。
 */
const NEUTRAL = {
  appName: 'RN 基座',
  apkName: 'RNBase',
  applicationId: 'com.qux.base',
  versionName: '1.0.0',
  versionCode: 1,
  splashBackgroundColor: '#08080D',
  remoteUrl: '',
};

// 鸿蒙工程（可选）：仓库里没有 harmony/ 时下面的下发整段跳过。
const HARMONY_APP_JSON5 = path.join(baseDir, 'harmony', 'AppScope', 'app.json5');
const HARMONY_APP_STRINGS = path.join(
  baseDir,
  'harmony',
  'AppScope',
  'resources',
  'base',
  'element',
  'string.json',
);
const HARMONY_ENTRY_STRINGS = path.join(
  baseDir,
  'harmony',
  'entry',
  'src',
  'main',
  'resources',
  'base',
  'element',
  'string.json',
);

function fail(msg) {
  console.error(`[app-meta] ${msg}`);
  process.exit(1);
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const xmlEscape = s =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function validate(cfg) {
  const appName = String(cfg.appName || '').trim();
  const applicationId = String(cfg.applicationId || '').trim();
  const apkName = String(cfg.apkName || '').trim();
  const versionName = String(cfg.versionName || '').trim();
  const versionCode = Number(cfg.versionCode);
  const splashBackgroundColor = String(cfg.splashBackgroundColor || '#08080D').trim();

  if (!appName) fail('app.config.json 缺少 appName');
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(applicationId)) {
    fail(`applicationId 非法：${applicationId}（应为如 com.company.app 的反域名包名）`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(apkName)) {
    fail(`apkName 非法：${apkName}（只能含字母/数字/下划线/连字符，建议英文，用作 APK 文件名）`);
  }
  if (!/^\d{1,3}(\.\d{1,3}){0,2}$/.test(versionName)) {
    fail(`versionName 非法：${versionName}（应为 1 / 1.0 / 1.0.0）`);
  }
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    fail(`versionCode 非法：${cfg.versionCode}（必须为 ≥1 的整数）`);
  }
  if (!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(splashBackgroundColor)) {
    fail(`splashBackgroundColor 非法：${splashBackgroundColor}（应为 #RRGGBB 或 #AARRGGBB）`);
  }
  return { appName, applicationId, apkName, versionName, versionCode, splashBackgroundColor };
}

/** 仅维护 strings.xml 中的 app_name 项，保留其它字符串资源（连带吞掉旧行缩进，避免逐次叠加）。 */
function applyAppName(appName) {
  const line = `    <string name="app_name">${xmlEscape(appName)}</string>`;
  let xml = fs.existsSync(STRINGS_XML)
    ? fs.readFileSync(STRINGS_XML, 'utf8')
    : '<resources>\n</resources>\n';
  if (/[ \t]*<string\s+name="app_name"[^>]*>[\s\S]*?<\/string>/.test(xml)) {
    xml = xml.replace(/[ \t]*<string\s+name="app_name"[^>]*>[\s\S]*?<\/string>/, line);
  } else {
    xml = xml.replace(/<\/resources>/, `${line}\n</resources>`);
  }
  fs.mkdirSync(path.dirname(STRINGS_XML), { recursive: true });
  fs.writeFileSync(STRINGS_XML, xml, 'utf8');
}

/** 仅维护 colors.xml 中的指定 color 项，保留其它颜色资源。 */
function applyColor(name, hex) {
  let xml = fs.existsSync(COLORS_XML)
    ? fs.readFileSync(COLORS_XML, 'utf8')
    : '<resources>\n</resources>\n';
  const line = `    <color name="${name}">${hex}</color>`;
  const re = new RegExp(`[ \\t]*<color\\s+name="${name}"[^>]*>[\\s\\S]*?</color>`);
  if (re.test(xml)) {
    xml = xml.replace(re, line);
  } else {
    xml = xml.replace(/<\/resources>/, `${line}\n</resources>`);
  }
  fs.mkdirSync(path.dirname(COLORS_XML), { recursive: true });
  fs.writeFileSync(COLORS_XML, xml, 'utf8');
}

const splashDrawableXml = withLogo =>
  `<?xml version="1.0" encoding="utf-8"?>\n` +
  `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n` +
  `    <item android:drawable="@color/splash_bg" />\n` +
  (withLogo
    ? `    <item>\n        <bitmap android:gravity="center" android:src="@drawable/splash_logo" />\n    </item>\n`
    : '') +
  `</layer-list>\n`;

/** 删除 res 中可变的位图品牌文件（图标 / 闪屏 logo），保证切换 App 后无残留。 */
function cleanResBrand() {
  if (!fs.existsSync(RES_DIR)) return;
  for (const e of fs.readdirSync(RES_DIR, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('mipmap-')) {
      for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) {
        fs.rmSync(path.join(RES_DIR, e.name, f), { force: true });
      }
    }
    if (e.name.startsWith('drawable-')) {
      fs.rmSync(path.join(RES_DIR, e.name, 'splash_logo.png'), { force: true });
    }
  }
}

/** 恢复基座中性默认图标（仅在子应用未提供品牌图时使用）。 */
function restoreDefaultIcons() {
  if (!fs.existsSync(BRAND_DEFAULT)) return;
  for (const e of fs.readdirSync(BRAND_DEFAULT, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith('mipmap-')) continue;
    const dst = path.join(RES_DIR, e.name);
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(path.join(BRAND_DEFAULT, e.name), dst, { recursive: true });
  }
}

/**
 * 写入闪屏：底色始终取子应用配置（无品牌图时仅回退为「无 logo 纯色」，
 * 不能把用户配的底色丢掉），logo 位图仅在存在品牌图时引用。
 */
function applySplash(hasBrand, bg) {
  fs.mkdirSync(path.dirname(SPLASH_DRAWABLE), { recursive: true });
  fs.writeFileSync(SPLASH_DRAWABLE, splashDrawableXml(hasBrand), 'utf8');
  applyColor('splash_bg', bg);
}

/** 用子应用品牌资源覆盖图标。 */
function applyH5Icons(brandDir) {
  fs.cpSync(brandDir, RES_DIR, { recursive: true });
}

/**
 * app.json5 里只改版本两个键的值：该文件带注释、还含签名相关字段，
 * 整体 JSON.parse 再 stringify 会把注释与尾逗号格式弄丢，故用定向替换。
 */
function applyHarmonyVersion(cfg) {
  const src = fs.readFileSync(HARMONY_APP_JSON5, 'utf8');
  // 判「字段在不在」而不是「替换有没有改动文本」：版本与上次相同时替换本来就是空操作。
  if (!/"versionName"\s*:\s*"[^"]*"/.test(src) || !/"versionCode"\s*:\s*\d+/.test(src)) {
    const rel = path.relative(baseDir, HARMONY_APP_JSON5);
    fail(`未在 ${rel} 找到 versionName/versionCode，鸿蒙版本未下发`);
  }
  const out = src
    .replace(/("versionName"\s*:\s*)"[^"]*"/, `$1"${cfg.versionName}"`)
    .replace(/("versionCode"\s*:\s*)\d+/, `$1${cfg.versionCode}`);
  fs.writeFileSync(HARMONY_APP_JSON5, out, 'utf8');
}

/** string.json（标准 JSON，无注释）里按键名替换 value；键不存在则不动，不臆造条目。 */
function applyHarmonyStringLabel(file, name, value) {
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(data.string) ? data.string : [];
  const hit = items.find(i => i && i.name === name);
  if (!hit) return;
  hit.value = value;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * 把品牌名与版本同步进 harmony/ 工程（桌面显示名 + versionCode/versionName）。
 *
 * bundleName 故意不下发：鸿蒙包名是与安卓 applicationId 独立的上架身份（还要跟
 * DevEco 的签名/Profile 一致），自动改写会让已有签名配置失效；需要换名时手工改
 * harmony/AppScope/app.json5，README「鸿蒙（RNOH）」一节有说明。
 * 图标同理：harmony 的 app_icon 是 DevEco 图形化配置产物，脚本不覆盖。
 */
function applyHarmonyMeta(cfg) {
  if (!fs.existsSync(HARMONY_APP_JSON5)) return false;
  applyHarmonyVersion(cfg);
  applyHarmonyStringLabel(HARMONY_APP_STRINGS, 'app_name', cfg.appName);
  applyHarmonyStringLabel(HARMONY_ENTRY_STRINGS, 'EntryAbility_label', cfg.appName);
  return true;
}

/** 下发后回读校验：任一项不符即失败退出，避免打出「以为换了其实没换」的包。 */
function verifyApplied(cfg, hasBrand, brandDir, harmonyApplied) {
  const problems = [];

  const strings = fs.existsSync(STRINGS_XML) ? fs.readFileSync(STRINGS_XML, 'utf8') : '';
  if (!strings.includes(`>${xmlEscape(cfg.appName)}<`)) {
    problems.push(`app_name 未写入 ${path.relative(baseDir, STRINGS_XML)}`);
  }
  const colors = fs.existsSync(COLORS_XML) ? fs.readFileSync(COLORS_XML, 'utf8') : '';
  if (!colors.includes(`<color name="splash_bg">${cfg.splashBackgroundColor}</color>`)) {
    problems.push(`splash_bg 未写入 ${path.relative(baseDir, COLORS_XML)}`);
  }
  const splash = fs.existsSync(SPLASH_DRAWABLE) ? fs.readFileSync(SPLASH_DRAWABLE, 'utf8') : '';
  const expectLogo = hasBrand ? splash.includes('splash_logo') : !splash.includes('splash_logo');
  if (!expectLogo) {
    problems.push(`splash_screen.xml 的 logo 引用与预期不符（hasBrand=${hasBrand}）`);
  }

  if (hasBrand) {
    for (const e of fs.readdirSync(brandDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(brandDir, e.name))) {
        const applied = path.join(RES_DIR, e.name, f);
        const src = path.join(brandDir, e.name, f);
        if (!fs.existsSync(applied)) {
          problems.push(`品牌资源缺失：res/${e.name}/${f}`);
        } else if (
          fs.statSync(applied).size !== fs.statSync(src).size ||
          !fs.readFileSync(applied).equals(fs.readFileSync(src))
        ) {
          problems.push(`品牌资源内容不一致：res/${e.name}/${f}`);
        }
      }
    }
  } else if (!fs.existsSync(path.join(RES_DIR, 'mipmap-xxhdpi', 'ic_launcher.png'))) {
    problems.push('基座默认图标缺失（brand-default 未恢复成功）');
  }

  const version = readJson(BASE_VERSION);
  for (const key of ['appName', 'apkName', 'applicationId', 'versionName', 'versionCode']) {
    if (String(version[key]) !== String(cfg[key])) {
      problems.push(`version.json.${key}=${version[key]} 与配置 ${cfg[key]} 不一致`);
    }
  }

  if (harmonyApplied) {
    const app = fs.readFileSync(HARMONY_APP_JSON5, 'utf8');
    if (!app.includes(`"versionName": "${cfg.versionName}"`)) {
      problems.push('harmony/AppScope/app.json5 的 versionName 未同步');
    }
    if (!app.includes(`"versionCode": ${cfg.versionCode}`)) {
      problems.push('harmony/AppScope/app.json5 的 versionCode 未同步');
    }
    for (const [file, name] of [
      [HARMONY_APP_STRINGS, 'app_name'],
      [HARMONY_ENTRY_STRINGS, 'EntryAbility_label'],
    ]) {
      if (!fs.existsSync(file)) continue;
      const items = JSON.parse(fs.readFileSync(file, 'utf8')).string;
      const hit = Array.isArray(items) ? items.find(i => i && i.name === name) : undefined;
      if (!hit || hit.value !== cfg.appName) {
        problems.push(`${path.relative(baseDir, file)} 的 ${name} 未同步为 ${cfg.appName}`);
      }
    }
  }
  return problems;
}

function cliAppArg() {
  const i = process.argv.indexOf('--app');
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) fail('--app 需要跟子应用名或目录路径');
  return v;
}

function main() {
  const reset = process.argv.includes('--reset');
  const app = reset ? null : resolveActiveApp(cliAppArg());
  if (app && !fs.existsSync(app.configPath)) fail(`未找到子应用配置：${app.configPath}`);
  // validate() 只回品牌六项，remoteUrl 不在其中（它是容器模式开关，不是品牌字段），
  // 所以下面读开关必须用原文对象——用 cfg.remoteUrl 会永远是 undefined。
  const rawCfg = app ? readJson(app.configPath) : NEUTRAL;
  const cfg = validate(rawCfg);

  // --reset 一定走「无品牌图」分支：cleanResBrand + restoreDefaultIcons 会把图标换回 brand-default。
  const brandDir = app ? path.resolve(app.brandDir) : '';
  const hasBrand = Boolean(app) && fs.existsSync(brandDir);

  // 1. 品牌字段与版本写入基座 version.json（build.gradle 配置期读取）——整体重写，
  //    保证不会残留上一个子应用的字段，也不会因外部脚本改写而丢字段。
  //    remoteUrl 例外：它是「基座 + URL」容器模式的开关，不属于品牌下发范围。
  //    子应用 app.config.json 里声明了就用它，没声明就原样保留现值，
  //    否则手改一次开关、下次 brand:apply 就把它清了（表现是 APK 悄悄变回本地 H5 模式）。
  const prevRemoteUrl = fs.existsSync(BASE_VERSION) ? readJson(BASE_VERSION).remoteUrl : undefined;
  // --reset 连这个开关一起清掉：中性基座就是本地模式。
  const remoteUrl = reset ? '' : rawCfg.remoteUrl !== undefined ? rawCfg.remoteUrl : prevRemoteUrl;
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(
    BASE_VERSION,
    JSON.stringify(
      {
        appName: cfg.appName,
        apkName: cfg.apkName,
        applicationId: cfg.applicationId,
        versionName: cfg.versionName,
        versionCode: cfg.versionCode,
        remoteUrl: remoteUrl === undefined ? '' : remoteUrl,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // 2. 应用显示名
  applyAppName(cfg.appName);

  // 3. 品牌图标 / 闪屏：先清空并恢复基座默认图标，再按需覆盖，
  //    使「从带图标的 A 切到不带图标的 B」也不会残留 A 的图标。
  cleanResBrand();
  restoreDefaultIcons();
  if (hasBrand) {
    applyH5Icons(brandDir);
  }
  applySplash(hasBrand, cfg.splashBackgroundColor);

  // 4. harmony/ 工程存在时一并同步品牌名与版本（没有鸿蒙工程就是纯安卓/iOS 基座，跳过）
  const harmonyApplied = applyHarmonyMeta(cfg);

  const problems = verifyApplied(cfg, hasBrand, brandDir, harmonyApplied);
  if (problems.length) {
    for (const p of problems) console.error(`[app-meta] 校验失败：${p}`);
    process.exit(1);
  }

  const origin = reset ? '中性基座（--reset）' : `${app.name}（来源=${app.source}）`;
  console.log(
    `[app-meta] ${origin} -> 基座：` +
      `"${cfg.appName}" pkg=${cfg.applicationId} v${cfg.versionName}(${cfg.versionCode}) ` +
      `品牌资源=${hasBrand ? '自定义图标/闪屏' : '基座默认'} ` +
      `鸿蒙=${harmonyApplied ? '已同步名称/版本' : '无 harmony/ 工程，跳过'}`,
  );
  console.log(`[app-meta] APK 文件名将为：${cfg.apkName}-${cfg.versionName}-<变体>.apk`);
}

try {
  main();
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
