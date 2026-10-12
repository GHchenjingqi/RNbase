#!/usr/bin/env node
/**
 * 切换 / 查看基座当前承载的 H5 子应用。
 *
 * 基座是通用壳，同一时刻只承载一个子应用的产物与品牌。本命令把「当前活动子应用」
 * 写进 app-registry.json，并立即重新下发品牌（图标 / 闪屏 / version.json），
 * 使「切 App」成为一次显式操作而不是靠最后一次 build:base 的副作用。
 *
 * 用法：
 *   node scripts/use-app.js                # 查看当前活动子应用
 *   node scripts/use-app.js cammer_h5      # 切换并重新下发品牌
 *   node scripts/use-app.js app_h5 --sync  # 切换 + 下发 + 把该子应用产物同步进基座 h5/
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { resolveActiveApp, readRegistry, setActiveApp } = require('./active-app');

const raw = readRegistry();
const target = process.argv[2];

function describe(app) {
  const line = (k, v) => `  ${k.padEnd(14)}${v}`;
  console.log(`当前活动子应用：${app.name}`);
  console.log(line('目录', app.dir));
  console.log(line('产物目录', app.distDir));
  console.log(line('配置', app.configPath));
  console.log(line('来源', app.source === 'registry' ? 'app-registry.json' : app.source));
}

if (!target) {
  describe(resolveActiveApp());
  console.log(`  已登记         ${Object.keys(raw.apps).join(' / ')}`);
  console.log('\n切换：node scripts/use-app.js <name> [--sync]');
  process.exit(0);
}

setActiveApp(target);
const app = resolveActiveApp(target);
describe(app);

const run = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`[use-app] ${script} 失败（退出码 ${r.status}）`);
    process.exit(r.status ?? 1);
  }
};

run('apply-app-meta.js', ['--app', target]);

if (process.argv.includes('--sync')) {
  const syncScript = path.join(app.dir, 'scripts', 'sync-to-base.js');
  const r = spawnSync(process.execPath, [syncScript], { stdio: 'inherit', cwd: app.dir });
  if (r.status !== 0) {
    console.error(`[use-app] ${syncScript} 失败（退出码 ${r.status}）`);
    process.exit(r.status ?? 1);
  }
}

console.log('[use-app] 完成。下一步：npm run build:android:install（或 build:android）');
