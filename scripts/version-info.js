/**
 * version.json 的读取器（gradle.js 与 hvigor.js 原来各抄了一份同样的 8 行）。
 *
 * 为什么值得单独一层：出包命名（`<apkName>-<versionName>-<mode>.apk`）、产物投递校验
 * （collectApk 比对 versionName/versionCode/applicationId）、release 版本码闸门
 * 三处都依赖同一份真值，两份实现一旦漂移（例如一份改成 try 里读、另一份加了 trim），
 * 安卓和鸿蒙打出来的包就会用不同的版本号口径，而这种错位在单测里看不出来。
 */
const fs = require('fs');
const path = require('path');

/**
 * 读根目录 version.json；读不到返回 null，由调用方决定回退行为
 * （出包命名回退成无版本号、版本码闸门跳过）。
 *
 * @param {string} rootDir 仓库根
 * @param {string} tag 日志前缀，保持各脚本原有的 `[gradle]` / `[hvigor]` 口径
 */
function readVersionInfo(rootDir, tag) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'version.json'), 'utf8'));
  } catch (e) {
    console.warn(`[${tag}] 读取 version.json 失败，回退到无版本号命名:`, e.message);
    return null;
  }
}

module.exports = { readVersionInfo };
