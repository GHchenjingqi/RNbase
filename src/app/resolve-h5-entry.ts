/**
 * H5 入口 URL 解析。
 *
 * WebView 统一从 file:///android_asset/index.html 加载，不走 Metro dev-server（http://）。
 * 原因：
 *  - dev-server 模式下 Metro 只提供被 require 的资源，H5 外部引用的 ./js/api.js
 *    未被 require，会 404，导致 window.RN 未定义、Bridge 全部超时；
 *  - file:// 模式下整个 H5 目录已通过 app/build.gradle 的 sourceSets 打进 APK assets，
 *    相对资源（css/js/图片/api.js）全部可访问，与 Metro 状态无关，最稳定。
 *
 * H5 页面更新流程：H5 子项目 build → sync:base 到基座 h5/ → 重新构建 APK。
 * RN 代码仍可通过 Metro 热更新，不影响 H5 页面加载方式。
 */

/**
 * 追加防缓存随机参数（cache busting）。
 *
 * 基座 WebView 对相同 URL 的 H5 页面可能命中旧缓存，导致打包更新后仍加载旧页面。
 * 每次冷启动随机追加 query 参数，强制 WebView 按新 URL 重新拉取。
 *  - 相对路径资源（./js、./assets 等）按去除 query 后的路径解析，不受影响；
 *  - 导航白名单按 scheme / 路径前缀判断（startsWith），不受影响。
 */
export function appendCacheBustQuery(uri: string): string {
  const sep = uri.includes('?') ? '&' : '?';
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${uri}${sep}_cb=${nonce}`;
}

export function getH5EntryUri(): string {
  // 统一从 APK assets 加载，不依赖 Metro dev-server
  return appendCacheBustQuery('file:///android_asset/index.html');
}
