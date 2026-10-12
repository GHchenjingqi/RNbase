/**
 * H5 Bridge API 产物注入脚本。
 *
 * 唯一源文件：scripts/api.js（与 sync-h5-api.js 同一个源，基座协议唯一真源）
 * 作用：子应用构建完成后、打包 zip 前，将基座唯一源 api.js 覆盖复制到
 *       子应用构建产物 dist/js/api.js，保证子包运行时的 Bridge 协议与基座一致。
 *       （开发期模板 public/js/api.js 由 npm run sync:api 同步，仅 vite dev server 使用；
 *         本脚本负责生产产物。）
 *
 * 用法：node scripts/inject-h5-api.js <子应用构建产物目录>
 * 例：  node scripts/inject-h5-api.js ../app_h5/dist
 *       node scripts/inject-h5-api.js dist
 *
 * 若产物目录下无 js/ 子目录，自动创建。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'scripts', 'api.js');

function main() {
  const distArg = process.argv[2];
  if (!distArg) {
    console.error('[inject-h5-api] 用法: node scripts/inject-h5-api.js <子应用构建产物目录>');
    process.exit(1);
  }

  const distDir = path.resolve(ROOT, distArg);
  const target = path.join(distDir, 'js', 'api.js');

  if (!fs.existsSync(SOURCE)) {
    console.error(`[inject-h5-api] 源文件不存在: ${SOURCE}`);
    process.exit(1);
  }
  if (!fs.existsSync(distDir)) {
    // 目录不存在（如 dev/build 流程中 H5 尚未构建）：跳过而非报错，保证打包链路不被中断
    console.warn(`[inject-h5-api] 目标目录不存在，跳过: ${distDir}`);
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = fs.readFileSync(SOURCE, 'utf8');
  fs.writeFileSync(target, content, 'utf8');

  console.log(`[inject-h5-api] 已覆盖: ${path.relative(ROOT, target)}`);
  console.log(
    `[inject-h5-api] 来源: ${path.relative(ROOT, SOURCE)} (${Buffer.byteLength(
      content,
      'utf8',
    )} bytes)`,
  );
}

main();
