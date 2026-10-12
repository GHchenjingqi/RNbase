/**
 * WebView 错误统一收口（对应 Phase 2 / 规范 §26）。
 *
 * 区分五类错误：
 *  - network:  网络连接失败、DNS 解析失败、超时
 *  - http:     HTTP 4xx/5xx 响应
 *  - render:   页面渲染崩溃、JS 异常
 *  - timeout:  加载超时
 *  - unknown:  其他未分类错误
 *
 * 所有错误必须结构化，禁止只显示 "WebView error"。
 */
import type { WebViewErrorInfo, WebViewErrorType } from './types';

/**
 * 将 react-native-webview 的 onError 原生事件转换为结构化错误。
 */
export function classifyNativeError(nativeEvent: {
  code?: number | string;
  message?: string;
  url?: string;
  domain?: string;
}): WebViewErrorInfo {
  const code = nativeEvent.code;
  const message = nativeEvent.message ?? '';
  const url = nativeEvent.url;

  let type: WebViewErrorType = 'unknown';

  // 网络错误码判断
  if (typeof code === 'number') {
    if (code === -2 || code === -6 || code === -1009 || code === -1004 || code === -1001) {
      type = 'network';
    } else if (code >= 400 && code < 600) {
      type = 'http';
    }
  }

  // 消息关键词判断
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) {
    type = 'timeout';
  } else if (
    lower.includes('net::') ||
    lower.includes('network') ||
    lower.includes('connection') ||
    lower.includes('dns')
  ) {
    type = 'network';
  } else if (lower.includes('render') || lower.includes('crash') || lower.includes('javascript')) {
    type = 'render';
  }

  return { type, code, message, url };
}

/**
 * 将 onHttpError 事件转换为结构化错误。
 */
export function classifyHttpError(nativeEvent: {
  statusCode?: number;
  description?: string;
  url?: string;
}): WebViewErrorInfo {
  return {
    type: 'http',
    code: nativeEvent.statusCode,
    message: nativeEvent.description ?? `HTTP ${nativeEvent.statusCode ?? 'error'}`,
    url: nativeEvent.url,
    httpStatus: nativeEvent.statusCode,
  };
}

/**
 * 获取用户可读的错误标题。
 */
export function getErrorTitle(error: WebViewErrorInfo): string {
  switch (error.type) {
    case 'network':
      return '网络连接失败';
    case 'http':
      return `页面加载失败 (${error.httpStatus ?? error.code ?? ''})`.trim();
    case 'render':
      return '页面渲染异常';
    case 'timeout':
      return '加载超时';
    default:
      return '加载失败';
  }
}

/**
 * 获取用户可读的错误建议。
 */
export function getErrorSuggestion(error: WebViewErrorInfo): string {
  switch (error.type) {
    case 'network':
      return '请检查网络连接后重试';
    case 'http':
      if (error.httpStatus && error.httpStatus >= 500) {
        return '服务器暂时不可用，请稍后重试';
      }
      if (error.httpStatus === 404) {
        return '页面不存在，请联系管理员';
      }
      return '请检查链接或稍后重试';
    case 'render':
      return '页面出现异常，请重新加载';
    case 'timeout':
      return '网络较慢，请检查网络后重试';
    default:
      return '请重新加载或稍后重试';
  }
}
