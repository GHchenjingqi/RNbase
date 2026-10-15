#!/usr/bin/env node
/**
 * 将本工程 dist 同步为 RN 基座的 h5 代码目录（产物目录）。
 *
 * 用法：
 *   node scripts/sync-to-base.js
 *   BASE_H5=D:/codes/RNbase/h5 node scripts/sync-to-base.js   # 覆盖目标路径
 *
 * 行为：
 *   1. 校验 dist/index.html 存在（无则报错退出）。
 *   2. 若目标目录存在旧内容，先整体备份为 <目标>.backup（只保留最近一份），
 *      再清空目标目录。
 *   3. 复制 dist 全部内容到目标目录。
 *   4. 打印结果统计。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// 基座 h5 目录：默认取本工程同级 RNbase/h5，可用环境变量 BASE_H5 覆盖
const defaultBase = path.resolve(projectRoot, '..', 'RNbase', 'h5');
const baseH5 = process.env.BASE_H5 || defaultBase;
const distDir = path.join(projectRoot, 'dist');

function main() {
  if (!fs.existsSync(distDir)) {
    console.error(`[sync] 未找到 dist 目录：${distDir}`);
    console.error('[sync] 请先执行 npm run build 生成产物');
    process.exit(1);
  }
  const entry = path.join(distDir, 'index.html');
  if (!fs.existsSync(entry)) {
    console.error(`[sync] dist 缺少 index.html（${entry}），不是有效的 H5 产物`);
    process.exit(1);
  }

  console.log(`[sync] 源（dist）    ：${distDir}`);
  console.log(`[sync] 目标（基座 h5）：${baseH5}`);

  // api.js 由基座维护（与 RN Bridge 协议同版本），H5 产物不包含，sync 时需保留基座版本
  const baseApiJs = path.join(baseH5, 'js', 'api.js');
  let preservedApiJs = null;
  if (fs.existsSync(baseApiJs)) {
    preservedApiJs = fs.readFileSync(baseApiJs, 'utf8');
    console.log('[sync] 已保留基座 js/api.js（不随 H5 产物覆盖）');
  }

  // 1. 备份旧内容（只保留最近一份，可回退）
  if (fs.existsSync(baseH5)) {
    const backup = `${baseH5}.backup`;
    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.readdirSync(baseH5).length > 0) {
      fs.cpSync(baseH5, backup, { recursive: true });
      console.log(`[sync] 旧内容已备份到：${backup}`);
    }
    fs.rmSync(baseH5, { recursive: true, force: true });
  }

  // 2. 复制 dist → 基座 h5
  fs.mkdirSync(baseH5, { recursive: true });
  fs.cpSync(distDir, baseH5, { recursive: true });

  // 2.1 恢复基座 js/api.js（H5 产物不包含 api.js，由基座提供）
  if (preservedApiJs) {
    fs.mkdirSync(path.join(baseH5, 'js'), { recursive: true });
    fs.writeFileSync(baseApiJs, preservedApiJs, 'utf8');
  }

  // 2.1 基座 H5 以 file:///android_asset 方式加载，脚本引用必须为相对路径：
  //     vite 构建要求 public 资源用绝对路径（/js/api.js）才能通过 module 检查，
  //     但 file:// 下绝对路径会指向根目录导致 404，这里统一转回相对路径。
  const baseEntry = path.join(baseH5, 'index.html');
  if (fs.existsSync(baseEntry)) {
    let baseHtml = fs.readFileSync(baseEntry, 'utf8');
    const rewritten = baseHtml.replace(/src="\/js\/api\.js"/g, 'src="./js/api.js"');
    if (rewritten !== baseHtml) {
      fs.writeFileSync(baseEntry, rewritten, 'utf8');
      console.log('[sync] index.html 已把 /js/api.js 转为相对路径 ./js/api.js');
    }
  }

  // 2.2 IIFE 产物标签规范化：
  //     vite build 配置 rollupOptions.output.format='iife' 输出普通脚本，
  //     但 HTML 入口的 script 标签仍被 Vite 写成 <script type="module" crossorigin>。
  //     file:// 下 module script 会因 MIME 检查失败（白屏），普通 script 无此限制，
  //     故同步时把 module/crossorigin 属性去掉，产物保持外部文件引用（符合规范）。
  //     注意：业务 bundle（非 js/api.js）必须加 defer——普通 script 在 head 中同步执行时
  //     <div id="root"> 尚未解析，React createRoot 会报 #299（container is not a DOM element）
  //     导致白屏；defer 保证 DOM 解析完成后再执行。api.js（Bridge SDK）不依赖 DOM，保持同步。
  if (fs.existsSync(baseEntry)) {
    let baseHtml = fs.readFileSync(baseEntry, 'utf8');
    const orig = baseHtml;
    // script: <script type="module" crossorigin src="..."> → <script src="...">（api.js）/ <script defer src="...">（业务 bundle）
    baseHtml = baseHtml.replace(/<script\s+type="module"([^>]*)>/g, (_m, attrs) => {
      const cleaned = attrs.replace(/\s+crossorigin/g, '');
      const srcMatch = cleaned.match(/\ssrc="([^"]+)"/);
      const isApiJs = srcMatch && /api\.js$/.test(srcMatch[1]);
      return isApiJs ? `<script${cleaned}>` : `<script${cleaned} defer>`;
    });
    // link stylesheet: 去掉 crossorigin（file:// 下会触发 CORS 检查）
    baseHtml = baseHtml.replace(/<link\s+([^>]*?)\bcrossorigin\b([^>]*)>/g, (_m, pre, post) => {
      const joined = (pre + ' ' + post).replace(/\s{2,}/g, ' ').trim();
      return `<link ${joined}>`;
    });
    if (baseHtml !== orig) {
      fs.writeFileSync(baseEntry, baseHtml, 'utf8');
      console.log('[sync] index.html 已规范化 IIFE 标签（去掉 module/crossorigin，业务 bundle 加 defer）');
    }
  }

  // 3. 统计
  let files = 0;
  let bytes = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else {
        files += 1;
        bytes += fs.statSync(p).size;
      }
    }
  })(baseH5);
  console.log(`[sync] 完成：${files} 个文件，${(bytes / 1024).toFixed(1)} KB 已同步到基座 h5/`);
}

main();
