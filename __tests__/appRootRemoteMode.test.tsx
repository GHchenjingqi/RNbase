/**
 * AppRoot 的「基座 + URL」启动分支单测。
 *
 * 对照跑远程/本地两种配置，证明行为差异只来自 version.json 的 remoteUrl 开关：
 * 远程模式加载完成即 RUNNING（不想起 10s 握手定时器进诊断页）、不跑子包更新、不注入 Bridge。
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

const SITE = 'https://gushici.app.workbuddy.host/';
const SITE_ORIGIN = 'https://gushici.app.workbuddy.host';

const mockRemote = { on: false };

const mockBridgeProps: Record<string, unknown> = {};
const mockRuntime = {
  resolveEntry: jest.fn(async () => ''),
  checkForUpdate: jest.fn(async () => ({ available: false })),
  update: jest.fn(async () => undefined),
  markReady: jest.fn(async () => undefined),
};
const mockDiagnostic = { renders: 0 };

jest.mock('../src/config', () => ({
  ...jest.requireActual('../src/config'),
  get IS_REMOTE_H5() {
    return mockRemote.on;
  },
  get REMOTE_H5_URL() {
    return mockRemote.on ? SITE : null;
  },
  get REMOTE_H5_ORIGIN() {
    return mockRemote.on ? SITE_ORIGIN : null;
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

jest.mock('../src/components/DiagnosticPage', () => ({
  DiagnosticPage: () => {
    mockDiagnostic.renders += 1;
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

import { FALLBACK_H5_HTML } from '../src/app/fallback-h5';
import { AppRoot } from '../src/app/AppRoot';
import App from '../App';

/** 每次 boot 都留一棵树，afterEach 统一卸载：不卸载的话旧树还会重渲染并覆盖 mockBridgeProps。 */
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function boot(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    mounted.push(await ReactTestRenderer.create(<AppRoot />));
  });
}

async function fireLoadEnd(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    (mockBridgeProps.onLoadEnd as () => void)();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  for (const key of Object.keys(mockBridgeProps)) {
    delete mockBridgeProps[key];
  }
  mockDiagnostic.renders = 0;
  mockRuntime.resolveEntry.mockClear();
  mockRuntime.checkForUpdate.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  ReactTestRenderer.act(() => {
    while (mounted.length) {
      mounted.pop()!.unmount();
    }
  });
});

describe('AppRoot 远程模式', () => {
  beforeEach(() => {
    mockRemote.on = true;
  });

  it('入口就是站点地址，不查本地激活版本', async () => {
    await boot();
    expect(mockBridgeProps.source).toEqual({ uri: SITE });
    expect(mockRuntime.resolveEntry).not.toHaveBeenCalled();
  });

  it('不注入 Bridge，信任域收窄到站点自身', async () => {
    await boot();
    expect(mockBridgeProps.bridgeEnabled).toBe(false);
    expect(mockBridgeProps.trustedOrigins).toEqual([SITE_ORIGIN]);
  });

  it('跳过 H5 子包更新检查', async () => {
    await boot();
    expect(mockRuntime.checkForUpdate).not.toHaveBeenCalled();
  });

  it('加载完成即就绪：超时也不落诊断页', async () => {
    await boot();
    await fireLoadEnd();
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(mockDiagnostic.renders).toBe(0);
  });
});

describe('AppRoot 本地模式（对照）', () => {
  beforeEach(() => {
    mockRemote.on = false;
  });

  it('本地无激活版本时回退内置兜底页，并保留 Bridge 与 allowedOrigin', async () => {
    await boot();
    expect(mockBridgeProps.source).toEqual({ html: FALLBACK_H5_HTML });
    expect(mockBridgeProps.bridgeEnabled).toBe(true);
    expect(mockRuntime.checkForUpdate).toHaveBeenCalled();
  });

  it('H5 不发 app.ready 时握手超时进诊断页', async () => {
    await boot();
    await fireLoadEnd();
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(11000);
    });
    expect(mockDiagnostic.renders).toBe(1);
  });
});

/**
 * 装机实测走的是 App.tsx 这条（它直接挂 WebViewBridge，AppRoot 目前没被挂上），
 * 所以入口开关在 App 上再验一遍。App 在渲染期才读 config，同一个模块实例即可切换两种模式。
 */
async function bootApp(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    mounted.push(await ReactTestRenderer.create(<App />));
  });
}

describe('App 入口（真机链路）', () => {
  it('远程模式：入口是站点，不注入 Bridge，信任域只剩站点自身', async () => {
    mockRemote.on = true;
    await bootApp();
    expect(mockBridgeProps.source).toEqual({ uri: SITE });
    expect(mockBridgeProps.bridgeEnabled).toBe(false);
    expect(mockBridgeProps.trustedOrigins).toEqual([SITE_ORIGIN]);
  });

  it('本地模式：入口仍是 APK 内置 assets，Bridge 照常', async () => {
    mockRemote.on = false;
    // jest 默认 Platform.OS='ios'；固定为 android 以验证 APK 内置 assets 入口
    // （iOS 本地模式在没有原生 H5BundleBasePath 时会走配置缺失错误页，那是另一条分支）
    require('react-native').Platform.OS = 'android';
    await bootApp();
    expect(mockBridgeProps.source as { uri: string }).toEqual({
      uri: expect.stringMatching(/^file:\/\/\/android_asset\/index\.html/),
    });
    expect(mockBridgeProps.bridgeEnabled).toBe(true);
    expect(mockBridgeProps.trustedOrigins).toBeUndefined();
  });
});
