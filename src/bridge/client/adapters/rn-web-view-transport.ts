/**
 * RN WebView 传输适配器（运行在 WebView 内的 H5 侧，规则 13/43）。
 *
 * 发送：window.ReactNativeWebView.postMessage
 * 接收：window 'message' 事件（RN 注入的字符串）
 *
 * 注意：RN 的 tsconfig 不含 DOM lib，这里用最小化的本地类型描述所需全局，
 * 不依赖 `window`/`MessageEvent` 等 DOM 类型。
 */
import type { BridgeTransport } from '../types';

type MinimalWebView = {
  ReactNativeWebView?: { postMessage: (message: string) => void };
  addEventListener: (type: string, handler: (event: { data: unknown }) => void) => void;
  removeEventListener: (type: string, handler: (event: { data: unknown }) => void) => void;
};

function getWebViewWindow(): MinimalWebView | undefined {
  const g = globalThis as unknown as { window?: MinimalWebView };
  return g && g.window ? g.window : undefined;
}

export function isInRnWebView(): boolean {
  const w = getWebViewWindow();
  return !!w?.ReactNativeWebView?.postMessage;
}

export function createRnWebViewTransport(): BridgeTransport {
  const w = getWebViewWindow();
  return {
    send(raw: string): void {
      const rn = w?.ReactNativeWebView;
      if (!rn?.postMessage) {
        throw new Error('ReactNativeWebView.postMessage 不可用');
      }
      rn.postMessage(raw);
    },
    subscribe(listener: (raw: string) => void): () => void {
      if (!w) {
        return () => {};
      }
      const handler = (event: { data: unknown }): void => {
        if (typeof event.data === 'string') {
          listener(event.data);
        }
      };
      w.addEventListener('message', handler);
      return () => w.removeEventListener('message', handler);
    },
  };
}
