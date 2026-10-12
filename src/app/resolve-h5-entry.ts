/**
 * H5 入口 URL 解析。
 *
 * 安卓：WebView 统一从 file:///android_asset/index.html 加载，不走 Metro dev-server（http://）。
 * 原因：
 *  - dev-server 模式下 Metro 只提供被 require 的资源，H5 外部引用的 ./js/api.js
 *    未被 require，会 404，导致 window.RN 未定义、Bridge 全部超时；
 *  - file:// 模式下整个 H5 目录已通过 app/build.gradle 的 sourceSets 打进 APK assets，
 *    相对资源（css/js/图片/api.js）全部可访问，与 Metro 状态无关，最稳定。
 *
 * iOS：还没接。下面 getH5EntryUri() 的兜底分支是安卓专属路径，iOS 上不存在
 * `android_asset`，需要改成 Bundle 内资源路径（原生侧目前也没有对应的路径解析方法），
 * 现状是装机后 WebView 白屏。缺口清单见 scripts/ios.js 的 KNOWN_GAPS（npm run ios:doctor）。
 *
 * 鸿蒙（RNOH）没有 android_asset 这套：H5 由 scripts/hvigor.js 拷进
 * `entry/src/main/resources/rawfile/assets/h5/`，移植的 webview 把 `asset://X` 映射成
 * `$rawfile('assets/' + X)`；裸 `file://` 会被 ArkWeb 拒掉（错误码 17100003，直接崩进程）。
 * debug 期则走宿主机的 vite dev server（`hdc rport tcp:5173 tcp:5173`，见 harmony-dev.js），
 * 否则每改一次 H5 都要重打一次 HAP。
 *
 * H5 页面更新流程：H5 子项目 build → sync:base 到基座 h5/ → 重新构建 APK / HAP。
 * RN 代码仍可通过 Metro 热更新，不影响 H5 页面加载方式。
 */
import { isHarmony } from '../platform/os';

/** 鸿蒙 debug：宿主机 vite dev server（设备侧端口由 hdc rport 映射过来）。 */
const HARMONY_DEV_ENTRY = 'http://127.0.0.1:5173/';

/** 鸿蒙 release：rawfile 里的内置 H5。 */
const HARMONY_RELEASE_ENTRY = 'asset://h5/index.html';

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
  if (isHarmony()) {
    // asset:// 绝不能带 query：移植的 webview 拿整串 URL 当 rawfile 键名去查，
    // 加了 ?_cb= 就查不到文件，表现是白屏 + 一条 404，看不出入口出了问题。
    return __DEV__ ? HARMONY_DEV_ENTRY : HARMONY_RELEASE_ENTRY;
  }
  // 统一从 APK assets 加载，不依赖 Metro dev-server
  return appendCacheBustQuery('file:///android_asset/index.html');
}
