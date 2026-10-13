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
 * iOS：本地模式从 App bundle 内资源加载（iOS 没有 android_asset）。
 *  - 基座需要原生侧把 h5/ 作为 folder reference 加进 Xcode target（见 scripts/ios.js）；
 *  - BaseCapabilities 通过 constantsToExport 暴露 H5BundleBasePath（= Bundle.main.bundlePath）；
 *  - JS 侧拼出 file://{H5BundleBasePath}/h5/index.html 交给 WebView。
 *    WKWebView 加载本地 file:// 时自动以父目录作为 allowingReadAccessToURL，
 *    故子资源（h5/assets、h5/js）均可访问。
 *  - 若原生路径未就绪（开发者尚未加 folder reference / 未实现常量），则降级到远程站点
 *    （REMOTE_H5_URL，若已配置），否则返回 null 由 App 渲染「配置缺失」错误页。
 *  - 远程站点模式（REMOTE_H5_URL 非空）由 App.tsx 直接用该 URL，不走本函数。
 *
 * 鸿蒙（RNOH）没有 android_asset 这套：H5 由 scripts/hvigor.js 拷进
 * `entry/src/main/resources/rawfile/assets/h5/`，移植的 webview 把 `asset://X` 映射成
 * `$rawfile('assets/' + X)`；裸 `file://` 会被 ArkWeb 拒掉（错误码 17100003，直接崩进程）。
 * debug 期则走宿主机的 vite dev server（`hdc rport tcp:5173 tcp:5173`，见 harmony-dev.js），
 * 否则每改一次 H5 都要重打一次 HAP。
 *
 * H5 页面更新流程：H5 子项目 build → sync:base 到基座 h5/ → 重新构建 APK / HAP / iOS bundle。
 * RN 代码仍可通过 Metro 热更新，不影响 H5 页面加载方式。
 */
import { NativeModules } from 'react-native';
import { isHarmony, isIos } from '../platform/os';
import { REMOTE_H5_URL } from '../config';

/** 鸿蒙 debug：宿主机 vite dev server（设备侧端口由 hdc rport 映射过来）。 */
const HARMONY_DEV_ENTRY = 'http://127.0.0.1:5173/';

/** 鸿蒙 release：rawfile 里的内置 H5。 */
const HARMONY_RELEASE_ENTRY = 'asset://h5/index.html';

/** iOS bundle 内 H5 目录名（须与 Xcode folder reference 的目录名一致）。 */
const IOS_H5_BUNDLE_SUBDIR = 'h5';

/**
 * iOS 本地 H5 入口（App bundle 内资源）。
 * 返回 null 表示无法解析（原生未暴露 H5BundleBasePath 且未配置远程站点）。
 */
function getIosLocalH5EntryUri(): string | null {
  const base = (NativeModules.BaseCapabilities as { H5BundleBasePath?: string } | undefined)
    ?.H5BundleBasePath;
  if (base) {
    // 本地内置资源不需要防缓存随机参数（file:// 带 query 在 WKWebView 下有边缘问题，
    // 且 bundle 内置资源随 App 版本更新，无缓存陈旧问题）。
    return `file://${base}/${IOS_H5_BUNDLE_SUBDIR}/index.html`;
  }
  // 原生路径未就绪：尽量降级到远程站点，否则标记不可用。
  return REMOTE_H5_URL ?? null;
}

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

/**
 * 解析 H5 入口 URI。
 * @returns 入口 URI；本地模式不可用时返回 null（调用方应渲染配置缺失错误页）。
 */
export function getH5EntryUri(): string | null {
  if (isHarmony()) {
    // asset:// 绝不能带 query：移植的 webview 拿整串 URL 当 rawfile 键名去查，
    // 加了 ?_cb= 就查不到文件，表现是白屏 + 一条 404，看不出入口出了问题。
    return __DEV__ ? HARMONY_DEV_ENTRY : HARMONY_RELEASE_ENTRY;
  }
  if (isIos()) {
    // 远程站点模式由 App.tsx 直接用 REMOTE_H5_URL，这里仅处理本地模式。
    return getIosLocalH5EntryUri();
  }
  // 统一从 APK assets 加载，不依赖 Metro dev-server
  return appendCacheBustQuery('file:///android_asset/index.html');
}
