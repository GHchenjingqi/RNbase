/**
 * Bridge 消息来源判定（规范 §25 的落地）。
 *
 * 判定式：消息来源必须与「容器当前那一页」同源，且那一页本身可信
 * （要么是容器自己选定的入口页，要么是导航白名单放行的页）。
 *
 * 为什么不是「拿消息 url 直接查白名单」：两个平台给的东西根本不是一个量纲——
 * 安卓走 WebMessageListener，nativeEvent.url 是消息**源 origin**（scheme://host，
 * 带 iframe）；鸿蒙的 RNOH webview 移植用 registerJavaScriptProxy，拿不到逐条消息的
 * 源，nativeEvent.url 是**当前主 frame 的整页 URL**。所以把消息 url 与容器自己跟踪的
 * 当前页 url 归一到 origin 再比，两边都成立：安卓能拦住跨域 iframe 冒出来调用，
 * 鸿蒙至少能拦住「页面已经跳到站外、还想要原生能力」。
 */
import { decideNavigation, normalizeOrigin } from './navigation';

export type MessageOriginInput = {
  /** 平台在 onMessage 事件里给的来源（安卓=源 origin，鸿蒙=整页 URL）；本地内置页会是 "null"。 */
  messageOrigin?: string;
  /** 容器当前页 URL（由入口 source 与 onLoadStart/onLoadEnd 跟踪，页面自己说了不算）。 */
  pageUrl: string;
  /** 容器本次装载的入口 URL（基座自己选定，不代表页面当前停在哪儿）。 */
  entryUrl: string;
  /** 域名白名单，与导航拦截共用一份（规则 24）。 */
  whitelist: string[];
};

/**
 * decideNavigation 里代表「这一页是基座自己装进 WebView 的本地资源」的 reason。
 * 这些页面拿不到消息来源是常态（见 isTrustedMessageOrigin），信任判定改由容器跟踪的当前页承担。
 */
const LOCAL_PAGE_REASONS = new Set([
  'internal_scheme',
  'android_asset',
  'android_res',
  'android_resource',
  'harmony_rawfile',
  'h5_versions',
]);

export function isTrustedMessageOrigin(input: MessageOriginInput): boolean {
  const msgOrigin = normalizeOrigin(input.messageOrigin ?? '');
  const pageOrigin = normalizeOrigin(input.pageUrl);
  const entryOrigin = normalizeOrigin(input.entryUrl);
  const decision = decideNavigation(input.pageUrl, input.whitelist);
  // 内联 html 入口（source.html，没有 uri）：pageUrl 与 entryUrl 都是空串，
  // 但那一页的代码本身就是基座拼出来的，不存在「站外脚本混进来」这条路。
  const pageIsInline = input.pageUrl === '' && input.entryUrl === '';
  const pageIsEntry = entryOrigin !== null && entryOrigin === pageOrigin;
  const pageIsLocal = pageIsInline || LOCAL_PAGE_REASONS.has(decision.reason);

  if (!msgOrigin) {
    // 本地内置页放行：真机实测（雷电 Android 9 + APK 内置 assets 入口）安卓
    // WebMessageListener 对 file:// 页给的 sourceOrigin 是字面量 "null"（opaque origin），
    // 鸿蒙与内联 html 同样给不出逐条消息的来源。这一页是容器自己装进 WebView 的，
    // 来源缺失不是攻击证据 —— 按「当前页可信」放行。
    // 反过来，站外 http(s) 页给不出来源仍然拒（失败关闭）。
    return pageIsLocal || pageIsEntry;
  }
  if (pageOrigin === null || msgOrigin !== pageOrigin) {
    return false;
  }
  return pageIsEntry || decision.action === 'allow';
}
