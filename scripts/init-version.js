/**
 * 从模板生成 version.json（缺失时才写，已有则不覆盖）。
 *
 * 为什么需要它：version.json 是构建期派生产物，已被 .gitignore 排除、不再入库，
 * 但 src/config/index.ts 在编译期就 `import versionInfo from '../../version.json'`——
 * 新克隆的仓库没有这个文件会直接 tsc/打包失败。所以安装依赖（package.json 的 prepare
 * 钩子）时先兜底生成一份，内容就是中性基座的默认值（RNBase / com.qux.base）。
 *
 * 真正的品牌值不在这儿填：那是子应用 app.config.json 的事，由 brand:apply 下发。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '..');
const TARGET = path.join(baseDir, 'version.json');
const TEMPLATE = path.join(baseDir, 'version.example.json');

function main() {
  if (fs.existsSync(TARGET)) {
    return;
  }
  if (!fs.existsSync(TEMPLATE)) {
    console.error('[init-version] 缺少模板 version.example.json，无法生成 version.json');
    process.exit(1);
  }
  fs.copyFileSync(TEMPLATE, TARGET);
  console.log('[init-version] 已从 version.example.json 生成 version.json（中性基座默认值）');
}

main();
