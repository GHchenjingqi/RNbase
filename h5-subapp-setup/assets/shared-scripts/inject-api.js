#!/usr/bin/env node
/**
 * 入口薄壳：用基座唯一真源 `RNbase/scripts/api.js` 覆盖本工程的 Bridge 中间件产物。
 *
 * 为什么不直接在 package.json 里写 `node ../RNbase/scripts/inject-h5-api.js ../RN_h5/dist`：
 * 那条命令同时写死了「基座目录名 RNbase」和「本工程目录名 RN_h5」，仓库被克隆成别的
 * 目录名（如 RN_h5）就失效。这里只按「同级目录」找基座，路径全部转成绝对路径再传给基座脚本。
 *
 * 用法：node scripts/inject-api.js <本工程内的相对目录>   # 如 dist / public
 * 基座位置：默认取同级 RNbase，可用环境变量 BASE_DIR 覆盖。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) {
  console.error('[inject-api] 用法: node scripts/inject-api.js <相对本工程的目录，如 dist>');
  process.exit(1);
}

const baseRoot = path.resolve(
  process.env.BASE_DIR || path.resolve(projectRoot, '..', 'RNbase')
);
const baseScript = path.join(baseRoot, 'scripts', 'inject-h5-api.js');
if (!fs.existsSync(baseScript)) {
  console.error(`[inject-api] 未找到基座注入脚本：${baseScript}`);
  console.error('[inject-api] 请把基座仓库放在本工程同级目录（RNbase），或用 BASE_DIR 指定基座路径');
  process.exit(1);
}

const r = spawnSync(process.execPath, [baseScript, path.resolve(projectRoot, target)], {
  stdio: 'inherit',
});
process.exit(r.status === null ? 1 : r.status);
