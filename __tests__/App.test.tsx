/**
 * @format
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

import App from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
