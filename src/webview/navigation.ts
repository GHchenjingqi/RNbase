/**
 * 导航拦截与白名单决策（对应 Phase 2 / 规范 §24）。
 *
 * 决策表：
 *  - 白名单内 http/https  → allow（容器内加载）
 *  - 白名单外 http/https  → open-external（系统浏览器，不继承 Bridge 权限）
 *  - 自定义 scheme（base:// 等） → block（交 Deep Link 模块，本阶段安全拦截）
 *  - about:blank / data:   → allow（内部使用）
 *  - file:///android_asset/ → allow（APK 内置 assets，安全）
 *  - file:///android_res/   → allow（APK 内置 res/raw，H5 入口，安全）
 *  - android.resource://     → allow（Android 资源 URI，H5 入口，安全）
 *  - asset:// / resource://rawfile/ → allow（鸿蒙 HAP 内置 rawfile，H5 离线包，安全）
 *  - 其他 file://           → block（禁止本地文件加载，安全策略）
 */
import { APP_PACKAGE, DOMAIN_WHITELIST } from '../config';
import type { NavigationDecision } from './types';

/**
 * 取 URL 的 origin（`scheme://host`）；解析失败返回 null。Bridge 来源判定共用。
 *
 * 为什么先手工验 scheme：Hermes/RN 的 URL 实现允许「相对解析」，
 * `new URL('null')` 不抛异常，而是给出 protocol='' / host='' 的半成品，
 * 拼出来是一个真值 `"//"`。真机实测（雷电 Android 9，APK 内置 assets 首屏）：
 * 安卓 WebMessageListener 对 file:// 页给的 sourceOrigin 正是字面量 "null"，
 * 于是 "//" !== "file://" → 本地模式 14 个 Bridge 接口全被 SECURITY_BLOCKED 拒掉。
 * 没有 scheme 的串不是 origin，一律回 null，让「拿不到来源」走来源缺失的分支。
 */
export function normalizeOrigin(url: string): string | null {
  const value = (url ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return null;
  }
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * 离线 H5 子包所在的应用私有目录前缀（两种形态都放行）。
 * 包名来自 version.json 的 applicationId —— 写死基座自己的包名会让换了包名的子应用
 * 把自己的离线包拦在门外（decideNavigation 判成 file_scheme_blocked）。
 */
const H5_VERSIONS_PREFIXES = [
  `file:///data/user/0/${APP_PACKAGE}/files/h5-versions/`,
  `file:///data/data/${APP_PACKAGE}/files/h5-versions/`,
];

function isTrustedOrigin(url: string, whitelist: string[]): boolean {
  const origin = normalizeOrigin(url);
  if (!origin) return false;
  return whitelist.some(w => {
    try {
      const wOrigin = normalizeOrigin(w);
      return wOrigin === origin;
    } catch {
      return false;
    }
  });
}

/**
 * 判断导航请求是否允许在 WebView 容器内加载。
 * @param url 目标 URL
 * @param whitelist 信任域名列表（默认使用 config 中的 DOMAIN_WHITELIST）
 */
export function decideNavigation(
  url: string,
  whitelist: string[] = DOMAIN_WHITELIST,
): NavigationDecision {
  if (!url || url.trim() === '') {
    return { action: 'block', reason: 'empty_url' };
  }

  // about:blank / data: 内部使用允许
  if (url.startsWith('about:') || url.startsWith('data:')) {
    return { action: 'allow', reason: 'internal_scheme' };
  }

  // file:///android_asset/ 允许（APK 内置 assets，安全）
  if (url.startsWith('file:///android_asset/')) {
    return { action: 'allow', reason: 'android_asset' };
  }

  // file:///android_res/ 允许（APK 内置 res/raw，H5 入口，安全）
  if (url.startsWith('file:///android_res/')) {
    return { action: 'allow', reason: 'android_res' };
  }

  // android.resource:// 允许（Android 资源 URI，H5 入口，安全）
  if (url.startsWith('android.resource://')) {
    return { action: 'allow', reason: 'android_resource' };
  }

  // 鸿蒙 HAP 内置 rawfile 允许（H5 离线包，等价于安卓的 file:///android_asset）。
  // 两个形态都要放行：JS 侧下发 asset://h5/index.html，而 ArkWeb 的 onLoadIntercept
  // 报回给 JS 的是翻译后的真实 URL resource://rawfile/assets/h5/index.html。
  // 只放行 rawfile 这一层根，HAP 其余资源（如 bundle.harmony.js）不作为页面加载入口。
  if (url.startsWith('asset://') || url.startsWith('resource://rawfile/')) {
    return { action: 'allow', reason: 'harmony_rawfile' };
  }

  // 动态 H5 子包（App 私有目录 h5-versions）允许。
  // 仅放行应用私有目录内的版本文件，杜绝任意本地文件加载。
  // 包名来自 version.json 的 applicationId（config 的 APP_PACKAGE）：写死基座自己的包名
  // 会让换了包名的子应用读不到自己的离线包，而 /data/data 与 /data/user/0 两个形态
  // 都要放行 —— 部分机型/工作目录（Android for Work、二次用户）解析出来的形态不同。
  if (H5_VERSIONS_PREFIXES.some(prefix => url.startsWith(prefix))) {
    return { action: 'allow', reason: 'h5_versions' };
  }

  // 其他 file:// 禁止
  if (url.startsWith('file://')) {
    return { action: 'block', reason: 'file_scheme_blocked' };
  }

  // 自定义 scheme（非 http/https）拦截，交 Deep Link
  if (!/^https?:\/\//i.test(url)) {
    return { action: 'block', reason: 'custom_scheme_deep_link' };
  }

  // http/https 白名单判断
  if (isTrustedOrigin(url, whitelist)) {
    return { action: 'allow', reason: 'trusted_origin' };
  }

  return { action: 'open-external', reason: 'untrusted_origin' };
}

/**
 * onShouldStartLoadWithRequest 的便捷封装。
 * 返回 true 表示允许加载，false 表示拦截。
 */
export function shouldStartLoad(url: string, whitelist?: string[]): boolean {
  const decision = decideNavigation(url, whitelist);
  return decision.action === 'allow';
}
