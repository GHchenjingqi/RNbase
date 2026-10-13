#!/usr/bin/env node
/**
 * 把仓库根 h5/ 同步到 iOS 工程 platforms/ios/qux/h5/，
 * 供开发者在 Xcode 中以「Create folder references」（蓝色文件夹）方式加入 App target。
 *
 * 为什么需要这一步：
 *  iOS 没有 android_asset，本地 H5 必须作为 App bundle 资源随 .app 分发。
 *  Xcode 不会自动把「构建目录里新出现的文件夹」打进 app，必须将 h5 以 folder reference
 *  引用进工程；folder reference 指向的就是本脚本同步过去的 platforms/ios/qux/h5 目录。
 *
 * 用法：node scripts/ios-sync-h5.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'h5');
const dst = path.join(root, 'platforms', 'ios', 'qux', 'h5');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

if (!fs.existsSync(src)) {
  // 源目录缺失不致命：Xcode 编译不依赖 h5 文件，仅运行时本地模式需要。
  // 远程站点模式（version.json remoteUrl）下可忽略；本地模式运行前请先构建 H5 子项目。
  console.warn(
    `[ios:sync-h5] 源目录不存在：${src}（跳过；本地模式运行前请先构建 H5 子项目并 sync:base 到基座 h5/）`
  );
  process.exit(0);
}

copyDir(src, dst);
console.log(`[ios:sync-h5] 已同步 ${src} -> ${dst}`);
console.log('[ios:sync-h5] 下一步：在 Xcode 打开 platforms/ios/qux.xcworkspace，');
console.log('              右键 App target → Add Files to "qux" → 选择上述 h5 文件夹，');
console.log(
  '              勾选「Create folder references」（蓝色图标），确保构建后 .app/h5/index.html 存在。'
);
