/**
 * resolve-h5-entry 单测（P1 补齐 iOS / debug 直连本机 H5）。
 *
 * 验证：
 *  - iOS 本地模式从原生 H5BundleBasePath 拼出 bundle 内 h5 入口；
 *    原生路径未就绪且无远程配置时返回 null（由 App 渲染配置缺失错误页）；
 *  - 安卓 / 鸿蒙 的内置 H5 分支不回归；
 *  - debug 开启「直连本机 H5」时三端统一返回 dev server 地址，
 *    不再读内置资源、也不再追加防缓存参数。
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: { BaseCapabilities: { H5BundleBasePath: '/fake/bundle' } },
}));

// REMOTE_H5_URL 来自 version.json——那是构建期派生文件（.gitignore），会随
// app:use / brand:apply 变化。不 mock 的话，本机切一次子应用这个测试就红一次，
// 断言的其实是机器状态而不是代码行为。这里固定为「未配置」，远程分支单独用用例覆盖。
// H5_DEV_SERVER_URL 同理必须固定：它依赖 __DEV__（jest 里恒为 true）与当前平台，
// 不 mock 的话「内置 H5」这组用例会被 debug 分支整体抢走。
jest.mock('../src/config', () => ({
  __esModule: true,
  REMOTE_H5_URL: null,
  H5_DEV_SERVER_URL: null,
}));

import { getH5EntryUri, appendCacheBustQuery } from '../src/app/resolve-h5-entry';

const RN = require('react-native');
const config = require('../src/config');

const DEV_URL = 'http://127.0.0.1:5173/';

describe('getH5EntryUri — 内置 H5 模式（debug 直连关闭）', () => {
  beforeEach(() => {
    RN.Platform.OS = 'ios';
    RN.NativeModules.BaseCapabilities = { H5BundleBasePath: '/fake/bundle' };
    config.REMOTE_H5_URL = null;
    config.H5_DEV_SERVER_URL = null;
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

  test('鸿蒙模式使用 asset://（不带 query）', () => {
    RN.Platform.OS = 'harmony';
    expect(getH5EntryUri()).toBe('asset://h5/index.html');
  });
});

describe('getH5EntryUri — debug 直连本机 H5', () => {
  beforeEach(() => {
    config.REMOTE_H5_URL = null;
    config.H5_DEV_SERVER_URL = DEV_URL;
  });

  test('安卓：入口换成 dev server，不再读 android_asset 也不加防缓存参数', () => {
    RN.Platform.OS = 'android';
    const uri = getH5EntryUri();
    expect(uri).toBe(DEV_URL);
    expect(uri).not.toContain('_cb=');
  });

  test('鸿蒙：入口换成 dev server，不再读 rawfile', () => {
    RN.Platform.OS = 'harmony';
    expect(getH5EntryUri()).toBe(DEV_URL);
  });

  test('iOS：入口换成 dev server，此时即使原生未暴露 H5BundleBasePath 也不返回 null', () => {
    RN.Platform.OS = 'ios';
    RN.NativeModules.BaseCapabilities = {};
    expect(getH5EntryUri()).toBe(DEV_URL);
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
