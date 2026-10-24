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
  /** 平台在 onMessage 事件里给的来源（安卓=源 origin，鸿蒙=整页 URL）；缺失一律拒。 */
  messageOrigin?: string;
  /** 容器当前页 URL（由入口 source 与 onLoadStart/onLoadEnd 跟踪，页面自己说了不算）。 */
  pageUrl: string;
  /** 容器本次装载的入口 URL（基座自己选定，不代表页面当前停在哪儿）。 */
  entryUrl: string;
  /** 域名白名单，与导航拦截共用一份（规则 24）。 */
  whitelist: string[];
};

export function isTrustedMessageOrigin(input: MessageOriginInput): boolean {
  const msgOrigin = normalizeOrigin(input.messageOrigin ?? '');
  const pageOrigin = normalizeOrigin(input.pageUrl);
  if (!msgOrigin || !pageOrigin) {
    return false;
  }
  if (msgOrigin !== pageOrigin) {
    return false;
  }
  // 入口页由基座挑选（本地产物 file:///android_asset/、鸿蒙 rawfile、内联兜底 html），
  // 形态多过白名单能枚举的种，直接认它，否则兜底重试页会被自己拦死。
  if (normalizeOrigin(input.entryUrl) === pageOrigin) {
    return true;
  }
  return decideNavigation(input.pageUrl, input.whitelist).action === 'allow';
}
