/**
 * App 组合根冒烟测试：整棵树可挂载、不抛错。
 *
 * 注意：不能用真实的 react-native-safe-area-context —— v5 的 SafeAreaProvider
 * 在测试环境拿不到 onLayout / 原生测量回调（appRootRemoteMode.test.tsx 顶部注释
 * 有装机实测记录），act 会因此永不 resolve，CI 上稳定挂到用例超时（本地快速
 * 机器偶发能过，属于非确定性挂起而非慢）。此处照搬该测试已验证的直通替身。
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// WebView 依赖原生模块，单测中无需真实渲染，mock 即可。
jest.mock('react-native-webview', () => ({
  WebView: 'WebView',
}));

// H5 入口 URL 依赖 Metro 资源注册，单测环境无法解析，mock 掉。
jest.mock('../src/app/resolve-h5-entry', () => ({
  getH5EntryUri: () => 'http://mock/index.html',
}));

// SafeAreaProvider 直通替身：不依赖真实布局（见文件头说明）。
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: (props: { children?: React.ReactNode }) => props.children ?? null,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 0, height: 0 }),
}));

import App from '../App';

test('renders correctly', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = await ReactTestRenderer.create(<App />);
  });
  expect(tree).toBeDefined();
  ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});
