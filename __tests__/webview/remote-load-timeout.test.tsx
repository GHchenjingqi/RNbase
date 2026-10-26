/**
 * 远程站点模式加载超时兜底（P0-5 韧性地基）。
 *
 * 仅 bridgeEnabled=false（远程站点）时启用：onLoadStart 后若在 REMOTE_H5_LOAD_TIMEOUT_MS
 * 内未收到 onLoadEnd（HTML 主资源没到达 = 离线/DNS 挂起/站点过慢），切到错误页。
 * 「200 却卡在自身加载态」的 SPA 因 onLoadEnd 已触发，不会被误判（见 config 注释）。
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 捕获 Mock WebView 组件类型，便于在测试中按 findByType 取它的 props
let CapturedWebView: React.ComponentType<Record<string, unknown>> | undefined;
jest.mock('react-native-webview', () => {
  const ReactMod = require('react');
  const MockWebView = ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) =>
    ReactMod.createElement('mock-webview', { ...props, ref }),
  );
  CapturedWebView = MockWebView;
  return { __esModule: true, default: MockWebView, WebView: MockWebView };
});

import { WebViewBridge } from '../../src/webview/WebViewBridge';
import { REMOTE_H5_LOAD_TIMEOUT_MS } from '../../src/config';

const REMOTE = 'https://remote-h5.example.test/';

function getWebView(tree: ReactTestRenderer) {
  const wv = tree.root.findByType(CapturedWebView as React.ComponentType<Record<string, unknown>>);
  return wv.props as {
    onLoadStart: (e: { nativeEvent: { canGoBack: boolean } }) => void;
    onLoadEnd: (e: { nativeEvent: { canGoBack: boolean } }) => void;
  };
}

test('remote mode: timeout before onLoadEnd shows error page', () => {
  jest.useFakeTimers();
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<WebViewBridge source={{ uri: REMOTE }} bridgeEnabled={false} />);
  });

  act(() => {
    getWebView(tree!).onLoadStart({ nativeEvent: { canGoBack: false } });
  });

  act(() => {
    jest.advanceTimersByTime(REMOTE_H5_LOAD_TIMEOUT_MS + 100);
  });

  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('加载超时');
  expect(json).toContain('重新加载');
  jest.useRealTimers();
});

test('remote mode: onLoadEnd before timeout does not show error page', () => {
  jest.useFakeTimers();
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<WebViewBridge source={{ uri: REMOTE }} bridgeEnabled={false} />);
  });

  act(() => {
    getWebView(tree!).onLoadStart({ nativeEvent: { canGoBack: false } });
  });
  act(() => {
    getWebView(tree!).onLoadEnd({ nativeEvent: { canGoBack: false } });
  });
  act(() => {
    jest.advanceTimersByTime(REMOTE_H5_LOAD_TIMEOUT_MS + 100);
  });

  expect(JSON.stringify(tree!.toJSON())).not.toContain('加载超时');
  jest.useRealTimers();
});
