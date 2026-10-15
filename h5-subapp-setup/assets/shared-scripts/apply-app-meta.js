#!/usr/bin/env node
/**
 * 入口薄壳：品牌下发逻辑已收敛到基座唯一实现 `RNbase/scripts/apply-app-meta.js`。
 * 本工程与 app_h5 曾各持一份完全相同的副本，副本之间会漂移，故改为委托调用。
 *
 * 用法：node scripts/apply-app-meta.js
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const baseScript = path.resolve(
  process.env.BASE_DIR || path.resolve(projectRoot, "..", "RNbase"),
  "scripts",
  "apply-app-meta.js"
);

if (!fs.existsSync(baseScript)) {
  console.error(`[app-meta] 未找到基座下发脚本：${baseScript}`);
  console.error(
    "[app-meta] 请确认本工程的兄弟目录 RNbase 存在（或用 BASE_DIR 指定基座）"
  );
  process.exit(1);
}

const r = spawnSync(process.execPath, [baseScript, "--app", projectRoot], {
  stdio: "inherit",
});
process.exit(r.status === null ? 1 : r.status);
