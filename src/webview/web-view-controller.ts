/**
 * WebView 控制器（对应 Phase 2 / 规范 §4）：封装 WebView 的加载、重载、
 * 回退与加载状态管理，与 UI 组件解耦。
 *
 * 状态机：idle -> loading -> loaded / error
 *  - loadStart: 进入 loading
 *  - loadEnd:   进入 loaded
 *  - onError:   进入 error
 */
import { useCallback, useRef, useState } from 'react';
import type { WebViewErrorInfo, WebViewSource } from './types';

/** WebView 实例最小接口（react-native-webview v14 类型未暴露 ref，此处仅声明用到的方法）。 */
export interface WebViewHandle {
  reload: () => void;
  goBack: () => void;
  goForward?: () => void;
  loadUrl?: (url: string) => void;
  stopLoading?: () => void;
  postMessage: (message: string) => void;
  injectJavaScript?: (script: string) => void;
}

export type WebViewLoadState = 'idle' | 'loading' | 'loaded' | 'error';

export type WebViewController = {
  state: WebViewLoadState;
  error: WebViewErrorInfo | null;
  source: WebViewSource;
  load: (source: WebViewSource) => void;
  reload: () => void;
  goBack: () => Promise<boolean>;
  canGoBack: () => boolean;
  /** WebView 组件内部回调，勿在业务中直接调用。 */
  _onLoadStart: () => void;
  _onLoadEnd: () => void;
  _onError: (error: WebViewErrorInfo) => void;
  _onHttpError: (error: WebViewErrorInfo) => void;
  /** WebView 组件实例 ref（由 WebViewBridge 注入）。 */
  _webViewRef: { current: WebViewHandle | null };
};

export function useWebViewController(initialSource: WebViewSource): WebViewController {
  const [state, setState] = useState<WebViewLoadState>('idle');
  const [error, setError] = useState<WebViewErrorInfo | null>(null);
  const [source, setSource] = useState<WebViewSource>(initialSource);
  const webViewRef = useRef<WebViewHandle>(null);

  const load = useCallback((next: WebViewSource) => {
    setError(null);
    setState('loading');
    setSource(next);
  }, []);

  const reload = useCallback(() => {
    setError(null);
    setState('loading');
    webViewRef.current?.reload();
  }, []);

  const goBack = useCallback(async (): Promise<boolean> => {
    if (!webViewRef.current) return false;
    webViewRef.current.goBack();
    return true;
  }, []);

  const canGoBack = useCallback((): boolean => {
    return !!webViewRef.current;
  }, []);

  const _onLoadStart = useCallback(() => {
    setState('loading');
    setError(null);
  }, []);

  const _onLoadEnd = useCallback(() => {
    setState('loaded');
  }, []);

  const _onError = useCallback((err: WebViewErrorInfo) => {
    setError(err);
    setState('error');
  }, []);

  const _onHttpError = useCallback((err: WebViewErrorInfo) => {
    setError(err);
    setState('error');
  }, []);

  return {
    state,
    error,
    source,
    load,
    reload,
    goBack,
    canGoBack,
    _onLoadStart,
    _onLoadEnd,
    _onError,
    _onHttpError,
    _webViewRef: webViewRef as WebViewController['_webViewRef'],
  };
}
