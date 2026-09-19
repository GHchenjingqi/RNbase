/**
 * 导航拦截与白名单决策（对应 Phase 2 / 规范 §24）。
 *
 * 决策表：
 *  - 白名单内 http/https  → allow（容器内加载）
 *  - 白名单外 http/https  → open-external（系统浏览器，不继承 Bridge 权限）
 *  - 自定义 scheme（erp:// 等） → block（交 Deep Link 模块，本阶段安全拦截）
 *  - about:blank / data:   → allow（内部使用）
 *  - file:///android_asset/ → allow（APK 内置 assets，安全）
 *  - file:///android_res/   → allow（APK 内置 res/raw，H5 入口，安全）
 *  - android.resource://     → allow（Android 资源 URI，H5 入口，安全）
 *  - 其他 file://           → block（禁止本地文件加载，安全策略）
 */
import { DOMAIN_WHITELIST } from '../config';
import type { NavigationDecision } from './types';

function normalizeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

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

  // 动态 H5 子包（App 私有目录 h5-versions）允许。
  // 仅放行应用私有目录内的版本文件，杜绝任意本地文件加载。
  if (
    url.startsWith('file:///data/user/0/com.qux/files/h5-versions/') ||
    url.startsWith('file:///data/data/com.qux/files/h5-versions/')
  ) {
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
