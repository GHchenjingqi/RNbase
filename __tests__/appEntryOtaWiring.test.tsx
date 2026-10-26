/**
 * 组合根（App.tsx）的启动分支单测：入口三态 + H5 子包热更新（OTA）闸门。
 *
 * 为什么这些用例必须挂在 App 上而不是某个内部组件上：装机跑的就是 App.tsx，
 * 入口解析与 OTA 只有在那条链路上生效才算数（曾经它们只活在一个从未被挂载的
 * AppRoot 里，文档写的「启动后自动热更」在真机上从未发生）。
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

const SITE = 'https://remote-h5.example.test/';
const MANIFEST = 'https://ota.example.test/manifest.json';
// 已激活子包入口（原生 BaseH5 给的路径）
const ACTIVATED = 'file:///data/user/0/com.qux.app/files/h5-versions/1.2.0/index.html';
// 上一版（回滚目标）
const PREVIOUS = 'file:///data/user/0/com.qux.app/files/h5-versions/1.1.0/index.html';

const mockRemote = { on: false };
// debug 期「直连本机 H5」开关（src/config 的 H5_DEV_SERVER_URL）。它依赖 __DEV__，
// jest 里恒为 true，不 mock 的话本地模式这组用例会被 debug 分支抢走。
const mockDevServer: { url: string | null } = { url: null };
// OTA 总开关：version.json 的 manifestUrl。没配就不该发请求。
const mockManifest: { url: string | null } = { url: MANIFEST };
// 握手期限：用例里等 10s 太久，压到 50ms 用真定时器睡过去即可。
const mockHandshakeMs = { value: 50 };
// 原生「当前激活的子包入口」的替身；OTA 激活成功后由测试改这里，模拟冷交换包。
const mockEntry = { value: '' };

const mockBridgeProps: Record<string, unknown> = {};
// checkForUpdate 的返回只要这两项（App 读 available 与 manifest.version）
type CheckResult = { available: boolean; manifest?: { version: string } };
const mockRuntime = {
  resolveEntry: jest.fn(async () => mockEntry.value),
  checkForUpdate: jest.fn(async (): Promise<CheckResult> => ({ available: false })),
  update: jest.fn(async () => undefined),
  markReady: jest.fn(async () => undefined),
  markFailed: jest.fn(async () => undefined),
};
const mockErrorPage = { renders: 0, onReload: null as null | (() => void) };

jest.mock('../src/config', () => ({
  ...jest.requireActual('../src/config'),
  get IS_REMOTE_H5() {
    return mockRemote.on;
  },
  get REMOTE_H5_URL() {
    return mockRemote.on ? SITE : null;
  },
  get H5_DEV_SERVER_URL() {
    return mockDevServer.url;
  },
  get H5_MANIFEST_URL() {
    return mockManifest.url;
  },
  get HANDSHAKE_TIMEOUT_MS() {
    return mockHandshakeMs.value;
  },
}));

jest.mock('../src/app/create-real-runtime', () => ({
  createRealRuntime: () => mockRuntime,
}));

jest.mock('../src/webview/WebViewBridge', () => ({
  WebViewBridge: (props: Record<string, unknown>) => {
    Object.assign(mockBridgeProps, props);
    return null;
  },
}));

jest.mock('../src/webview/WebViewErrorPage', () => ({
  WebViewErrorPage: (props: { onReload: () => void }) => {
    mockErrorPage.renders += 1;
    mockErrorPage.onReload = props.onReload;
    return null;
  },
}));

// v5 的 SafeAreaProvider 在拿到 onLayout 之前整棵子树渲染 null，测试环境没有真实布局，
// App 这条链路会在 provider 处断掉，所以换成直通的替身。
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: (props: { children?: React.ReactNode }) => props.children ?? null,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 0, height: 0 }),
}));

// 闪屏自带 200ms 倒计时轮询，它的行为由 splashOverlay.test.tsx 单独锁。
// 这里替身掉，是为了本文件能用真定时器：fake timers 与 react-test-renderer 的
// 异步 act 不兼容（第 3 次挂载起 await act 永不返回），入口/OTA 的用例不需要计时。
jest.mock('../src/app/SplashOverlay', () => ({
  SplashOverlay: () => null,
}));

import { DOMAIN_WHITELIST } from '../src/config';
import App from '../App';

/** 每次 boot 都留一棵树，afterEach 统一卸载：不卸载的话旧树还会重渲染并覆盖 mockBridgeProps。 */
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function boot(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    mounted.push(await ReactTestRenderer.create(<App />));
  });
}

/** 让挂起的 promise 全部落地：入口解析和后台更新是两条独立的异步链。 */
async function settle(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

/** 真定时器睡一会儿（要让握手期限到点）。 */
async function waitMs(ms: number): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  for (const key of Object.keys(mockBridgeProps)) {
    delete mockBridgeProps[key];
  }
  mockRemote.on = false;
  mockDevServer.url = null;
  mockManifest.url = MANIFEST;
  mockHandshakeMs.value = 50;
  mockEntry.value = '';
  mockErrorPage.renders = 0;
  mockErrorPage.onReload = null;
  // jest 默认 Platform.OS='ios'；本地内置入口按 android 断言（iOS 那条是「配置缺失」分支）
  require('react-native').Platform.OS = 'android';
  mockRuntime.resolveEntry.mockClear();
  mockRuntime.checkForUpdate.mockClear();
  mockRuntime.update.mockClear();
  mockRuntime.markReady.mockClear();
  mockRuntime.markFailed.mockClear();
  mockRuntime.markFailed.mockImplementation(async () => {
    mockEntry.value = PREVIOUS;
  });
});

afterEach(() => {
  ReactTestRenderer.act(() => {
    while (mounted.length) {
      mounted.pop()!.unmount();
    }
  });
});

describe('App 入口：远程站点模式', () => {
  beforeEach(() => {
    mockRemote.on = true;
  });

  it('入口就是站点地址，不查已激活子包', async () => {
    await boot();
    expect(mockBridgeProps.source).toEqual({ uri: SITE });
    expect(mockRuntime.resolveEntry).not.toHaveBeenCalled();
  });

  it('不注入 Bridge，信任域用 config 的全量白名单', async () => {
    await boot();
    expect(mockBridgeProps.bridgeEnabled).toBe(false);
    // 以前这里传 [REMOTE_H5_ORIGIN]，把 version.json 声明的 trustedDomains 全丢了：
    // 子应用配了第二个域（支付页、CDN）也会被弹到系统浏览器。真机上远程 origin 由
    // src/config 在模块初始化时并入 DOMAIN_WHITELIST（那时才读得到 version.json 的 remoteUrl），
    // 所以断言的是「App 用的是同一个集合」，而不是在本用例里重算一遍。
    expect(mockBridgeProps.trustedOrigins).toEqual(DOMAIN_WHITELIST);
  });

  it('页面在站点那边，本地没有可激活的子包：跳过热更新检查', async () => {
    await boot();
    await settle();
    expect(mockRuntime.checkForUpdate).not.toHaveBeenCalled();
  });
});

describe('App 入口：本地模式', () => {
  it('无激活子包时用车主内置 assets 入口，Bridge 照常', async () => {
    await boot();
    expect(mockBridgeProps.source as { uri: string }).toEqual({
      uri: expect.stringMatching(/^file:\/\/\/android_asset\/index\.html/),
    });
    expect(mockBridgeProps.bridgeEnabled).toBe(true);
    expect(mockBridgeProps.trustedOrigins).toEqual(DOMAIN_WHITELIST);
  });

  it('有已激活子包时入口换成那个子包 —— OTA 落地的包真的会被加载', async () => {
    mockEntry.value = ACTIVATED;
    await boot();
    expect(mockBridgeProps.source).toEqual({ uri: ACTIVATED });
  });

  it('iOS 本地模式解析不出入口时渲染配置缺失页，而不是闪一下白屏', async () => {
    require('react-native').Platform.OS = 'ios';
    await boot();
    expect(mockBridgeProps.source).toBeUndefined();
    expect(mockErrorPage.renders).toBe(1);
  });

  it('配置缺失页的「重新加载」重算一次入口', async () => {
    require('react-native').Platform.OS = 'ios';
    await boot();
    const before = mockRuntime.resolveEntry.mock.calls.length;
    mockEntry.value = ACTIVATED;
    await ReactTestRenderer.act(async () => {
      mockErrorPage.onReload!();
      await Promise.resolve();
    });
    await settle();
    expect(mockRuntime.resolveEntry.mock.calls.length).toBeGreaterThan(before);
    expect(mockBridgeProps.source).toEqual({ uri: ACTIVATED });
  });

  it('入口异步解析期间不渲染错误页（否则冷启动会闪一下「配置缺失」）', async () => {
    let resolveEntryPromise: ((v: string) => void) | undefined;
    mockRuntime.resolveEntry.mockImplementationOnce(
      () => new Promise<string>(r => (resolveEntryPromise = r)),
    );
    await ReactTestRenderer.act(async () => {
      mounted.push(ReactTestRenderer.create(<App />));
    });
    expect(mockErrorPage.renders).toBe(0);
    await ReactTestRenderer.act(async () => {
      resolveEntryPromise!('');
      await Promise.resolve();
    });
    expect(mockErrorPage.renders).toBe(0);
    expect(mockBridgeProps.source as { uri: string }).toEqual({
      uri: expect.stringMatching(/^file:\/\/\/android_asset/),
    });
  });
});

describe('App 后台 H5 子包更新闸门', () => {
  it('本地模式且配了 manifestUrl：检查更新，有可用版本就下载激活并换入口', async () => {
    mockRuntime.checkForUpdate.mockResolvedValueOnce({
      available: true,
      manifest: { version: '1.2.0' },
    });
    mockRuntime.update.mockImplementationOnce(async () => {
      mockEntry.value = ACTIVATED;
    });
    await boot();
    await settle();
    expect(mockRuntime.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(mockRuntime.update).toHaveBeenCalledTimes(1);
    // 激活后 WebView 用新入口（key 变了，source 也换了）
    expect(mockBridgeProps.source).toEqual({ uri: ACTIVATED });
  });

  it('检查到无更新时不下载、不重载 WebView', async () => {
    await boot();
    const sourceBefore = mockBridgeProps.source;
    await settle();
    expect(mockRuntime.update).not.toHaveBeenCalled();
    expect(mockBridgeProps.source).toEqual(sourceBefore);
  });

  it('没配 manifestUrl 时整条 OTA 关闭：不发请求', async () => {
    mockManifest.url = null;
    await boot();
    await settle();
    expect(mockRuntime.checkForUpdate).not.toHaveBeenCalled();
  });

  it('debug 直连本机 H5 时不跑热更新（入口就是宿主机源码，拉包只会把它拉回旧版本）', async () => {
    mockDevServer.url = 'http://127.0.0.1:5173/';
    await boot();
    await settle();
    expect(mockRuntime.checkForUpdate).not.toHaveBeenCalled();
  });

  it('更新失败只记日志，不影响当前入口', async () => {
    mockRuntime.checkForUpdate.mockResolvedValueOnce({ available: true });
    mockRuntime.update.mockRejectedValueOnce(new Error('sha256 mismatch'));
    await boot();
    await settle();
    expect(mockBridgeProps.source as { uri: string }).toEqual({
      uri: expect.stringMatching(/^file:\/\/\/android_asset/),
    });
  });

  it('H5 发 app.ready 时标记该版本 stable（否则激活过的版本永远停在未验证）', async () => {
    await boot();
    (mockBridgeProps.lifecycle as { onReady: () => void }).onReady();
    expect(mockRuntime.markReady).toHaveBeenCalledTimes(1);
  });
});

/**
 * 规则 8/9 的落地：只有「刚被 OTA 激活、还没跑通过」的那一版才进入握手期限。
 * 内置包与远程站点没有回滚对象，计时只会把它们误判成坏包。
 */
describe('刚激活子包的握手期限', () => {
  /** 走完「检查到更新 → 下载激活 → 换入口」，返回加载完新入口的 App。 */
  async function applyUpdate(): Promise<void> {
    mockRuntime.checkForUpdate.mockResolvedValueOnce({
      available: true,
      manifest: { version: '1.2.0' },
    });
    mockRuntime.update.mockImplementationOnce(async () => {
      mockEntry.value = ACTIVATED;
    });
    await boot();
    await settle();
    expect(mockBridgeProps.source).toEqual({ uri: ACTIVATED });
  }

  it('页面加载完仍不发 app.ready：markFailed 回滚上一版并重新解析入口', async () => {
    await applyUpdate();
    await ReactTestRenderer.act(async () => {
      (mockBridgeProps.onLoadEnd as () => void)();
    });
    await waitMs(200);
    await settle();
    expect(mockRuntime.markFailed).toHaveBeenCalledTimes(1);
    expect(mockBridgeProps.source).toEqual({ uri: PREVIOUS });
  });

  it('期限内发了 app.ready：不再回滚', async () => {
    await applyUpdate();
    await ReactTestRenderer.act(async () => {
      (mockBridgeProps.onLoadEnd as () => void)();
      (mockBridgeProps.lifecycle as { onReady: () => void }).onReady();
    });
    await waitMs(200);
    expect(mockRuntime.markFailed).not.toHaveBeenCalled();
    expect(mockBridgeProps.source).toEqual({ uri: ACTIVATED });
  });

  it('没走 OTA（内置包）时加载完成不起计时', async () => {
    await boot();
    await settle();
    await ReactTestRenderer.act(async () => {
      (mockBridgeProps.onLoadEnd as () => void)();
    });
    await waitMs(200);
    expect(mockRuntime.markFailed).not.toHaveBeenCalled();
  });
});
