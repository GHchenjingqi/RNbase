#!/usr/bin/env node
/**
 * 算 APK 的 sha256 并落成文件（<apk 文件名>.sha256.txt，与 APK 同目录）。
 *
 * 用法：
 *   node scripts/apk-hash.js                     # 取 dist/ 各子目录（按 applicationId 分）下 mtime 最新的 .apk
 *   node scripts/apk-hash.js <apk 路径> [更多路径]
 *
 * 只写哈希文件，不改清单、不改版本号、不改地址；末尾额外打印一段可粘贴的清单字段
 * （仅提示，不落盘）。这份哈希是远程升级的校验源：清单里的 sha256 抄错一次，装机就是
 * 一次 SHA256_MISMATCH，所以 version/size 也一并给出，省掉手抄。
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** 基座产物根目录：dist/<applicationId>/<apk>（见 gradle.js 的 collectApk）。 */
const DIST_DIR = path.join(__dirname, '..', 'dist');

function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 组装 update.startDownload 需要的四个字段（见 src/bridge/modules/update.ts）。
 * version 取 version.json 的 versionName —— 读不到就留空，让使用者自己补，
 * 不去猜 APK 文件名里的版本段（命名规则属于 build.gradle，改名字不该连带改这里）。
 */
function manifestHint(apkPath, sha256) {
  let version = '';
  try {
    const vf = path.join(__dirname, '..', 'version.json');
    version = String(JSON.parse(fs.readFileSync(vf, 'utf8')).versionName ?? '');
  } catch {
    // version.json 缺失/损坏：只给 sha256 + size，不影响哈希写入
  }
  return JSON.stringify({
    version,
    url: '<APK 下载地址（必须 https）>',
    sha256,
    size: fs.statSync(apkPath).size,
  });
}

/** 写 <apk>.sha256.txt，返回 { dest, sha256 }。 */
function writeApkHash(apkPath) {
  const sha256 = sha256Of(apkPath);
  const dest = `${apkPath}.sha256.txt`;
  fs.writeFileSync(dest, `${sha256}\n`, 'utf8');
  return { dest, sha256 };
}

/** 目录（含一层 applicationId 子目录）里 mtime 最新的 .apk，没有则返回 null。 */
function newestApk(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = [];
  const collect = sub => {
    if (!fs.existsSync(sub)) return;
    for (const name of fs.readdirSync(sub)) {
      const full = path.join(sub, name);
      if (fs.statSync(full).isDirectory()) continue;
      if (name.toLowerCase().endsWith('.apk')) {
        files.push({ full, mtime: fs.statSync(full).mtimeMs });
      }
    }
  };
  collect(dir);
  for (const name of fs.readdirSync(dir)) {
    const sub = path.join(dir, name);
    if (fs.statSync(sub).isDirectory()) collect(sub);
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].full : null;
}

module.exports = { writeApkHash, sha256Of, newestApk, DIST_DIR };

if (require.main === module) {
  const args = process.argv.slice(2);
  const targets = args.length
    ? args.map(a => path.resolve(a))
    : [newestApk(DIST_DIR)].filter(Boolean);
  if (!targets.length) {
    console.error(`[sha256] ${DIST_DIR} 下没有 .apk，先执行 npm run build:android:release`);
    process.exit(1);
  }
  for (const apk of targets) {
    if (!fs.existsSync(apk)) {
      console.error(`[sha256] 找不到 APK: ${apk}`);
      process.exit(1);
    }
    const { dest, sha256 } = writeApkHash(apk);
    console.log(`[sha256] ${path.basename(apk)}\n[sha256] ${sha256}\n[sha256] 已写入: ${dest}`);
    console.log(`[sha256] 升级清单字段（粘贴后补 url）: ${manifestHint(apk, sha256)}`);
  }
}
