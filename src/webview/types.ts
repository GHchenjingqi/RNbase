/**
 * WebView 模块共享类型。
 */
export type WebViewSource = { uri: string } | { html: string };

/** 导航决策结果（规范 §24）。 */
export type NavigationDecision =
  | { action: 'allow'; reason: string }
  | { action: 'block'; reason: string }
  | { action: 'open-external'; reason: string };

/** 结构化 WebView 错误（规范 §26）。 */
export type WebViewErrorType = 'network' | 'http' | 'render' | 'timeout' | 'unknown';

export type WebViewErrorInfo = {
  type: WebViewErrorType;
  code?: string | number;
  message?: string;
  url?: string;
  httpStatus?: number;
};
