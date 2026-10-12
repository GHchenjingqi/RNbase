/**
 * webview-control 桥接模块：WebView 控制（刷新/返回/前进/加载URL/停止/注入JS）。
 *
 * 通过 WebViewController 的 ref 实现，需在 WebViewBridge 中注入 controller。
 */
import type { BridgeServer } from '../bridge-server';
import { BridgeException } from '../bridge-error';
import type { WebViewHandle } from '../../webview/web-view-controller';

let webViewHandle: WebViewHandle | null = null;

/** 由 WebViewBridge 在挂载时注入 WebView 实例。 */
export function setWebViewHandle(handle: WebViewHandle | null): void {
  webViewHandle = handle;
}

function requireWebView(): WebViewHandle {
  if (!webViewHandle) {
    throw new BridgeException('DEVICE_UNSUPPORTED', 'WebView 未就绪');
  }
  return webViewHandle;
}

export function registerWebViewControlModule(server: BridgeServer): void {
  server.registerModule('webView', {
    /** 刷新当前 WebView。 */
    reload() {
      requireWebView().reload();
      return { ok: true };
    },

    /** WebView 后退。 */
    goBack() {
      const wv = requireWebView();
      if (typeof wv.goBack !== 'function') {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'goBack 未实现');
      }
      wv.goBack();
      return { ok: true };
    },

    /** WebView 前进。 */
    goForward() {
      const wv = requireWebView();
      if (typeof wv.goForward !== 'function') {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'goForward 未实现');
      }
      wv.goForward();
      return { ok: true };
    },

    /** 加载指定 URL。 */
    loadUrl(params) {
      const p = params as { url?: string } | undefined;
      if (!p?.url) {
        throw new BridgeException('INVALID_PARAMS', 'url 不能为空');
      }
      const wv = requireWebView();
      if (typeof wv.loadUrl !== 'function') {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'loadUrl 未实现');
      }
      wv.loadUrl(p.url);
      return { ok: true };
    },

    /** 停止加载。 */
    stopLoading() {
      const wv = requireWebView();
      if (typeof wv.stopLoading !== 'function') {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'stopLoading 未实现');
      }
      wv.stopLoading();
      return { ok: true };
    },

    /** 向 WebView 注入 JS 并执行。 */
    injectJavaScript(params) {
      const p = params as { script?: string } | undefined;
      if (!p?.script) {
        throw new BridgeException('INVALID_PARAMS', 'script 不能为空');
      }
      const wv = requireWebView();
      if (typeof wv.injectJavaScript === 'function') {
        wv.injectJavaScript(p.script);
      } else if (typeof wv.postMessage === 'function') {
        // 降级：通过 postMessage 传递脚本指令，由 H5 侧 eval 执行
        wv.postMessage(JSON.stringify({ type: '__inject_js__', script: p.script }));
      } else {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'injectJavaScript 未实现');
      }
      return { ok: true };
    },
  });
}
