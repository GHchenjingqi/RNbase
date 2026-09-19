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
 * 配置源：<app>/app.config.json；品牌图：<app>/app-brand/android/。
 * 目标子应用解析顺序：--app <注册表键名|目录路径> > app-registry.json 的 activeApp。
 *
 * version.json 是**构建期派生产物**（每次由本脚本从 app.config.json 整体重写），
 * 不要手改，也不要用 bump-version 单独维护——版本递增的唯一真源是 app.config.json。
 *
 * 用法：
 *   node scripts/apply-app-meta.js                 # 活动子应用
 *   node scripts/apply-app-meta.js --app app_h5    # 指定注册表中的子应用
 *   BASE_DIR=D:/x/app_base node scripts/apply-app-meta.js
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

/** 下发后回读校验：任一项不符即失败退出，避免打出「以为换了其实没换」的包。 */
function verifyApplied(cfg, hasBrand, brandDir) {
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
  const app = resolveActiveApp(cliAppArg());
  if (!fs.existsSync(app.configPath)) fail(`未找到子应用配置：${app.configPath}`);
  const cfg = validate(readJson(app.configPath));

  const brandDir = path.resolve(app.brandDir);
  const hasBrand = fs.existsSync(brandDir);

  // 1. 品牌字段与版本写入基座 version.json（build.gradle 配置期读取）——整体重写，
  //    保证不会残留上一个子应用的字段，也不会因外部脚本改写而丢字段。
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

  const problems = verifyApplied(cfg, hasBrand, brandDir);
  if (problems.length) {
    for (const p of problems) console.error(`[app-meta] 校验失败：${p}`);
    process.exit(1);
  }

  console.log(
    `[app-meta] ${app.name}（来源=${app.source}）-> 基座：` +
      `"${cfg.appName}" pkg=${cfg.applicationId} v${cfg.versionName}(${cfg.versionCode}) ` +
      `品牌资源=${hasBrand ? '自定义图标/闪屏' : '基座默认'}`,
  );
  console.log(`[app-meta] APK 文件名将为：${cfg.apkName}-${cfg.versionName}-<变体>.apk`);
}

try {
  main();
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
