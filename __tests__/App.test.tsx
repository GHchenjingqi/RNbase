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

// CI runner（2 核）上整棵 App 树的挂载 + effect 可超 5s（实测 5.14s），
// 显式放宽超时避免慢机器偶发超时失败（本地快速机器无感）。
test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
}, 30_000);
