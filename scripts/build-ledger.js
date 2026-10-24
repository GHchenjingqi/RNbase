#!/usr/bin/env node
/**
 * 出包台账（dist/<applicationId>/.builds.json）与 release 版本码闸门。
 *
 * 存在的理由：versionCode 只从 version.json 读，而 version.json 由子应用 app.config.json 下发，
 * 没人记得 bump 时就会出现「同一个 applicationId 连着出两个 versionCode=7 的 release 包」。
 * 装机端把它判成同版本（升级无效），应用市场直接驳回，而基座这边全程静默——
 * 因为产物文件名里只有 versionName，看不出 versionCode 有没有倒退。
 * 这里把每次出包的版本码记在产物旁边（dist/ 已 gitignore，不进仓库），release 出包前先比对。
 *
 * 用法：
 *   node scripts/build-ledger.js show            # 打印各 applicationId 的最近记录
 * 被 gradle.js / hvigor.js 以模块方式调用：checkReleaseVersionCode() + appendBuild()。
 * debug 包只记录不拦——重装同一个 debug 包是日常操作。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function ledgerFile(rootDir, applicationId) {
  return path.join(rootDir, 'dist', applicationId, '.builds.json');
}

function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    // 台账坏了不能反过来挡住出包：当成空表，让本次构建重新写一条
    return [];
  }
}

/** 取台账里最近一次 release 的版本码；没有 release 记录返回 null。 */
function lastReleaseCode(entries) {
  const releases = entries.filter(
    (e) => e && e.mode === 'release' && Number.isFinite(Number(e.versionCode))
  );
  if (releases.length === 0) return null;
  return Math.max(...releases.map((e) => Number(e.versionCode)));
}

/**
 * release 出包前的版本码校验。
 * @returns {{allow: boolean, last: number|null, problem: string}}
 */
function checkReleaseVersionCode(rootDir, { applicationId, versionCode }) {
  const code = Number(versionCode);
  if (!Number.isInteger(code) || code < 1) {
    return {
      allow: false,
      last: null,
      problem: `versionCode=${versionCode} 非法（必须为 ≥1 的整数）`,
    };
  }
  const last = lastReleaseCode(readLedger(ledgerFile(rootDir, applicationId)));
  if (last === null) {
    return { allow: true, last, problem: '' };
  }
  if (code <= last) {
    return {
      allow: false,
      last,
      problem:
        `versionCode=${code} 不大于上一次 release 的 ${last}（applicationId=${applicationId}）：` +
        '装机端会判成同版本、市场会驳回。先 npm run version:bump，' +
        '确认是重装同一包才加 --allow-same-version',
    };
  }
  return { allow: true, last, problem: '' };
}

/** 出包成功后落一条台账；写失败只警告，不把已经打好的包判成失败。 */
function appendBuild(rootDir, entry) {
  const file = ledgerFile(rootDir, entry.applicationId);
  try {
    const entries = readLedger(file);
    entries.push({ ...entry, at: new Date().toISOString() });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(entries.slice(-200), null, 2)}\n`, 'utf8');
    return file;
  } catch (e) {
    console.warn(`[ledger] 台账写入失败（不影响产物）：${e.message}`);
    return null;
  }
}

function show() {
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(distDir)) {
    console.log('[ledger] dist/ 还不存在，没有出包记录');
    return;
  }
  let printed = 0;
  for (const appId of fs.readdirSync(distDir)) {
    const file = ledgerFile(ROOT, appId);
    const entries = readLedger(file);
    if (entries.length === 0) continue;
    printed += 1;
    const last = entries[entries.length - 1];
    console.log(
      `[ledger] ${appId}: 共 ${entries.length} 次，最近 ${last.mode} v${last.versionName}(${last.versionCode}) ` +
        `${last.at ? last.at.slice(0, 16).replace('T', ' ') : ''} → ${last.artifact}` +
        `｜release 最大版本码 ${lastReleaseCode(entries) ?? '无'}`
    );
  }
  if (printed === 0) console.log('[ledger] 暂无台账记录');
}

if (require.main === module) {
  if (process.argv[2] === 'show') show();
  else console.error('用法: node scripts/build-ledger.js show');
}

module.exports = { ledgerFile, readLedger, lastReleaseCode, checkReleaseVersionCode, appendBuild };
