/**
 * 安全区两条路的互斥性：本地 file:// 子应用「注入 RN_SAFE_AREA 给页面」，
 * 远程站点「只注入一条 CSS」。
 *
 * 远程模式下第三方页既不读 window.RN_SAFE_AREA，也没写 viewport-fit=cover /
 * safe-area-inset（装机实测过），注入能力值对它是无效的；而 targetSdk 36 强制
 * edge-to-edge，WebView 从屏幕最上沿铺开，页头就会被状态栏压住。留白改由页面自己的
 * html padding 承担（那条带用站点背景绘制，不像容器 padding 那样切出一条白条），
 * 但注入内容必须锁在样式范围内 —— 一旦带上 window.*，就等于把原生句柄交给第三方 origin。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const mockInsets = { current: { top: 24, bottom: 16, left: 8, right: 12 } };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets.current,
}));

jest.mock('react-native-webview', () => {
  const ReactMod = require('react');
  const MockWebView = ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) =>
    ReactMod.createElement('mock-webview', { ...props, ref })
  );
  return { __esModule: true, default: MockWebView, WebView: MockWebView };
});

import { WebViewBridge } from '../../src/webview/WebViewBridge';

const SITE = 'https://tenant.example.com/';
const ASSET = 'file:///android_asset/index.html';

/**
 * 取挂载树里的 WebView 节点。
 * 宿主节点在测试树里的 type 就是字符串标签，但 ReactTestInstance.type 声明成 ElementType
 * （不含裸字符串），直接和字面量比较会被 TS 判成"永不相等"，所以在这一个地方窄化。
 */
function findWebView(root: ReactTestInstance) {
  return root.findAll((n) => (n.type as unknown as string) === 'mock-webview')[0];
}

/** 挂载 → 取快照 → 立刻卸载：状态更新都关在 act 里，断言只看纯数据。 */
function snapshot(bridgeEnabled: boolean) {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(
      React.createElement(WebViewBridge, {
        source: { uri: bridgeEnabled ? ASSET : SITE },
        bridgeEnabled,
      })
    );
  });
  const root = tree!.root;
  const webViewProps = findWebView(root).props as Record<string, unknown>;
  const container = StyleSheet.flatten(root.findAllByType(View)[0].props.style) as
    | Record<string, number>
    | undefined;
  act(() => {
    tree!.unmount();
  });
  return {
    container,
    injection: webViewProps.injectedJavaScriptBeforeContentLoaded as string | undefined,
    source: webViewProps.source as { uri: string },
  };
}

describe('安全区：远程注入 CSS / 本地注入能力值，两条路不叠加', () => {
  test('远程模式：给 html 垫出状态栏与导航栏高度，容器自己不加 padding', () => {
    const { injection, container } = snapshot(false);
    expect(injection).toContain('padding-top:24px');
    expect(injection).toContain('padding-bottom:16px');
    expect(container?.paddingTop).toBeUndefined();
    expect(container?.paddingBottom).toBeUndefined();
  });

  test('远程模式：注入内容只有样式，不留任何 window 句柄', () => {
    const { injection } = snapshot(false);
    expect(injection).toContain("createElement('style')");
    expect(injection).not.toMatch(/window\./);
    expect(injection).not.toContain('RN_SAFE_AREA');
    expect(injection).not.toContain('ReactNativeWebView');
  });

  test('远程模式：不把容器内部参数拼进第三方 URL', () => {
    expect(snapshot(false).source).toEqual({ uri: SITE });
  });

  test('本地模式：容器不垫，安全区仍走 RN_SAFE_AREA 注入', () => {
    const { injection, container } = snapshot(true);
    expect(container?.paddingTop).toBeUndefined();
    expect(injection).toContain('window.RN_SAFE_AREA');
    expect(injection).toContain('top: 24');
    expect(injection).not.toContain('padding-top:24px');
  });

  test('本地模式：insets 仍作为 URL query 双保险下发', () => {
    const uri = snapshot(true).source.uri;
    expect(uri.startsWith(ASSET)).toBe(true);
    expect(uri).toContain('safeTop=24');
    expect(uri).toContain('safeBottom=16');
  });

  test('本地模式：insets 运行期变化不重拼 URL（旋转/分屏不再触发整页重载）', () => {
    let tree: ReactTestRenderer | undefined;
    const element = () => React.createElement(WebViewBridge, { source: { uri: ASSET } });
    act(() => {
      tree = create(element());
    });
    const uriBefore = (findWebView(tree!.root).props as Record<string, unknown>).source as {
      uri: string;
    };
    act(() => {
      mockInsets.current = { top: 48, bottom: 32, left: 0, right: 0 };
      tree!.update(element());
    });
    const uriAfter = (findWebView(tree!.root).props as Record<string, unknown>).source as {
      uri: string;
    };
    act(() => {
      tree!.unmount();
    });
    // URL query 冻结在首载 insets；运行期变化走 system.safeareachange 事件，不改 source
    expect(uriAfter.uri).toBe(uriBefore.uri);
    expect(uriAfter.uri).toContain('safeTop=24');
  });
});
