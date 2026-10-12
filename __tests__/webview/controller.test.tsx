/**
 * WebView 控制器单测：可回退状态（canGoBack）的来源。
 *
 * react-native-webview v14 删掉了 ref 上的 canGoBack() 命令，原生只在导航事件的
 * nativeEvent.canGoBack 里给快照。硬件返回键的兜底（能退就退、退无可退才退出容器）
 * 全靠这个值，所以它必须来自事件、且首屏为 false —— 装机实测过一次「一进子页面按返回
 * 就退出 App」，就是这个值不可信导致的。
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  useWebViewController,
  type WebViewHandle,
  type WebViewController,
} from '../../src/webview/web-view-controller';

let controller: WebViewController;

function Probe(): null {
  controller = useWebViewController({ uri: 'https://h5.example.com/' });
  return null;
}

function mount(): void {
  act(() => {
    create(React.createElement(Probe));
  });
}

/** 记录 goBack 被调了几次的假 WebView 实例。 */
function fakeHandle(): WebViewHandle & { calls: number } {
  const handle = {
    calls: 0,
    reload() {},
    goBack() {
      handle.calls += 1;
    },
    postMessage() {},
  };
  return handle as WebViewHandle & { calls: number };
}

describe('useWebViewController 可回退状态', () => {
  beforeEach(() => {
    mount();
  });

  test('未收到任何导航事件前不可回退（首屏按返回应该退出容器）', () => {
    expect(controller.canGoBack()).toBe(false);
  });

  test('导航事件里的 canGoBack 快照会被记下来，false 也能把它清掉', () => {
    act(() => controller._onLoadStart(true));
    expect(controller.canGoBack()).toBe(true);
    act(() => controller._onLoadEnd(false));
    expect(controller.canGoBack()).toBe(false);
  });

  test('事件没带 canGoBack 时保留上一次的值，不把它抹成 false', () => {
    act(() => controller._onLoadStart(true));
    act(() => controller._onLoadStart());
    expect(controller.canGoBack()).toBe(true);
  });

  test('SPA 路由（pushState 只触发 loadStart）也能更新状态', () => {
    act(() => controller._onLoadEnd(false));
    act(() => controller._onLoadStart(true));
    expect(controller.canGoBack()).toBe(true);
  });

  test('goBack：有实例才调命令并返回 true', async () => {
    const handle = fakeHandle();
    expect(await controller.goBack()).toBe(false);
    controller._webViewRef.current = handle;
    expect(await controller.goBack()).toBe(true);
    expect(handle.calls).toBe(1);
  });

  test('加载新入口会回到 loading 态并清掉旧错误', () => {
    act(() => controller._onError({ type: 'network', code: -1, message: 'boom' }));
    expect(controller.state).toBe('error');
    act(() => controller.load({ uri: 'https://h5.example.com/other' }));
    expect(controller.state).toBe('loading');
    expect(controller.error).toBeNull();
  });
});
