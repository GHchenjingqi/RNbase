/**
 * resolve-h5-entry iOS 分支单测（P1 补齐 iOS）。
 *
 * 验证：iOS 本地模式从原生 H5BundleBasePath 拼出 bundle 内 h5 入口；
 * 原生路径未就绪且无远程配置时返回 null（由 App 渲染配置缺失错误页）；
 * 安卓/鸿蒙分支不回归。
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: { BaseCapabilities: { H5BundleBasePath: '/fake/bundle' } },
}));

// REMOTE_H5_URL 来自 version.json——那是构建期派生文件（.gitignore），会随
// app:use / brand:apply 变化。不 mock 的话，本机切一次子应用这个测试就红一次，
// 断言的其实是机器状态而不是代码行为。这里固定为「未配置」，远程分支单独用用例覆盖。
jest.mock('../src/config', () => ({
  __esModule: true,
  REMOTE_H5_URL: null,
}));

import { getH5EntryUri, appendCacheBustQuery } from '../src/app/resolve-h5-entry';

const RN = require('react-native');
const config = require('../src/config');

describe('getH5EntryUri', () => {
  beforeEach(() => {
    RN.NativeModules.BaseCapabilities = { H5BundleBasePath: '/fake/bundle' };
    config.REMOTE_H5_URL = null;
  });

  test('iOS 本地模式使用 H5BundleBasePath 拼出 bundle 内 h5 入口', () => {
    RN.Platform.OS = 'ios';
    expect(getH5EntryUri()).toBe('file:///fake/bundle/h5/index.html');
  });

  test('iOS 未暴露 H5BundleBasePath 且无远程配置时返回 null（触发配置缺失错误页）', () => {
    RN.Platform.OS = 'ios';
    RN.NativeModules.BaseCapabilities = {};
    expect(getH5EntryUri()).toBeNull();
  });

  test('iOS 未暴露 H5BundleBasePath 但已配置远程地址时回落到远程地址', () => {
    RN.Platform.OS = 'ios';
    RN.NativeModules.BaseCapabilities = {};
    config.REMOTE_H5_URL = 'https://remote.example/';
    expect(getH5EntryUri()).toBe('https://remote.example/');
  });

  test('安卓模式使用 android_asset（带防缓存参数）', () => {
    RN.Platform.OS = 'android';
    const uri = getH5EntryUri();
    expect(uri).toContain('android_asset/index.html');
    expect(uri).toContain('_cb=');
  });

  test('鸿蒙模式使用 asset:// 或 dev 入口（不回归）', () => {
    RN.Platform.OS = 'harmony';
    const uri = getH5EntryUri();
    expect(['asset://h5/index.html', 'http://127.0.0.1:5173/']).toContain(uri);
  });
});

describe('appendCacheBustQuery', () => {
  test('无 query 时加 ?_cb=', () => {
    expect(appendCacheBustQuery('file:///x/index.html')).toContain('?_cb=');
  });
  test('已有 query 时加 &_cb=', () => {
    expect(appendCacheBustQuery('http://a.com/?y=1')).toMatch(/&_cb=/);
  });
});
