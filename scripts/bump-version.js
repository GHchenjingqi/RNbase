#!/usr/bin/env node
/**
 * 命名版本迭代脚本。
 *
 * 版本的唯一真源是**活动子应用**的 `app.config.json`（appName/包名/版本都由它下发），
 * 基座 `version.json` 只是构建期派生产物，由 apply-app-meta.js 从配置整体重写。
 * 因此本脚本改的是配置文件，改完再走一次下发，保证两者不可能不一致。
 *
 * 用法：
 *   node scripts/bump-version.js                 # 默认补丁：+0.0.1，1.0 -> 1.0.1
 *   node scripts/bump-version.js major           # 主版本：+1，    1.0 -> 2.0
 *   node scripts/bump-version.js minor           # 次版本：+0.1，  1.0 -> 1.1
 *   node scripts/bump-version.js patch           # 补丁：+0.0.1，  1.0 -> 1.0.1
 *   node scripts/bump-version.js show            # 仅显示当前版本，不递增
 *   node scripts/bump-version.js patch --app app_h5   # 指定子应用（默认取注册表 activeApp）
 *
 * versionName 显示规则：patch 为 0 时显示 x.y（如 1.1），否则显示 x.y.z（如 1.0.1）。
 * versionCode 每次递增 +1（Android 系统判断升级依据）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveActiveApp } = require('./active-app');

const ROOT = path.resolve(__dirname, '..');
const PKG_FILE = path.join(ROOT, 'package.json');

// ---------- 工具 ----------
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** 解析 versionName 字符串为三段数字，支持 1 / 1.0 / 1.0.1。 */
function parseVersionName(s) {
  const parts = String(s).split('.');
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;
  return { major, minor, patch };
}

/** patch 为 0 时显示 x.y，否则显示 x.y.z。 */
function formatVersionName(v) {
  return v.patch === 0 ? `${v.major}.${v.minor}` : `${v.major}.${v.minor}.${v.patch}`;
}

/** 按粒度递增。 */
function bumpVersion(v, kind) {
  switch (kind) {
    case 'major':
      return { major: v.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: v.major, minor: v.minor + 1, patch: 0 };
    case 'patch':
      return { major: v.major, minor: v.minor, patch: v.patch + 1 };
    default:
      throw new Error(`未知递增粒度: ${kind}（可选 major / minor / patch）`);
  }
}

// ---------- 主流程 ----------
function main() {
  const argvAppIndex = process.argv.indexOf('--app');
  const appArg = argvAppIndex === -1 ? undefined : process.argv[argvAppIndex + 1];
  const kind = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'patch';

  const app = resolveActiveApp(appArg);
  if (!fs.existsSync(app.configPath)) {
    throw new Error(`未找到子应用配置：${app.configPath}`);
  }
  // 读-改-写：只动 versionName/versionCode，其余品牌字段原样保留。
  const config = readJson(app.configPath);
  const current = parseVersionName(config.versionName);
  const currentCode = parseInt(config.versionCode, 10) || 0;
  const prevVersionName = String(config.versionName);

  if (kind === 'show') {
    console.log(
      `app=${app.name} appName=${config.appName} pkg=${config.applicationId} ` +
        `versionName=${config.versionName} versionCode=${config.versionCode} ` +
        `(major=${current.major}, minor=${current.minor}, patch=${current.patch})`,
    );
    console.log(`版本真源: ${app.configPath}`);
    return;
  }

  const next = bumpVersion(current, kind);
  const nextVersionName = formatVersionName(next);
  const nextVersionCode = currentCode + 1;

  // 1. 递增活动子应用配置（唯一真源）
  config.versionName = nextVersionName;
  config.versionCode = nextVersionCode;
  writeJson(app.configPath, config);

  // 2. 重新下发到基座：整体重写 version.json + 品牌资源，并由下发脚本自身校验一致性。
  //    下发失败则回滚配置，避免出现「配置已递增、基座仍是旧版本」的半程状态。
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, 'apply-app-meta.js'), '--app', appArg || app.name],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    config.versionName = prevVersionName;
    config.versionCode = currentCode;
    writeJson(app.configPath, config);
    throw new Error(`apply-app-meta 下发失败（退出码 ${r.status}），已回滚 ${app.name} 版本号`);
  }

  // 3. 基座 package.json version 仅作项目元数据同步
  const pkg = readJson(PKG_FILE);
  pkg.version = nextVersionName;
  writeJson(PKG_FILE, pkg);

  console.log(
    `[bump:${kind}] ${app.name} ${prevVersionName} (${currentCode}) -> ${nextVersionName} (${nextVersionCode})`,
  );
  console.log(`已同步: ${path.relative(ROOT, app.configPath)} / version.json / package.json`);
  console.log('提示: 重新执行打包命令（如 npm run build:android:install）即可生成新版本 APK。');
}

try {
  main();
} catch (e) {
  console.error(`[bump-version] 失败: ${e.message}`);
  process.exit(1);
}
