/**
 * 原生能力适配器单测：验证对接 NativeModules.ERPCapabilities，
 * 以及原生未链接时安全降级为空（模块返回 DEVICE_UNSUPPORTED）。
 *
 * 剪贴板 / 应用管理按「原生方法存在性」逐项挂载：iOS 只实现 appOpenSettings，
 * 不能因此把 isInstalled 之类的安卓能力也当成可用。
 */
import { NativeModules } from 'react-native';
import { BridgeException } from '../src/bridge/bridge-error';
import { resolveNativeCapabilityAdapters } from '../src/middleware/native/capability-native-adapters';

function installMockNative(overrides: Record<string, unknown> = {}) {
  (NativeModules as Record<string, unknown>).ERPCapabilities = {
    scan: jest.fn(async () => ({ code: 'X' })),
    takePhoto: jest.fn(async () => ({ uri: 'f.jpg' })),
    pickImage: jest.fn(async () => ({
      files: [{ name: 'a.png', size: 1, mimeType: 'image/png', uri: 'a' }],
    })),
    saveImage: jest.fn(async () => ({ saved: true })),
    filePick: jest.fn(async () => ({
      files: [{ name: 'b.pdf', size: 2, mimeType: 'application/pdf', uri: 'b' }],
    })),
    fileDownload: jest.fn(async () => ({ uri: 'd' })),
    fileOpen: jest.fn(async () => ({ opened: true })),
    getCurrentPosition: jest.fn(async () => ({
      latitude: 1,
      longitude: 2,
      accuracy: 3,
    })),
    ...overrides,
  };
}

describe('resolveNativeCapabilityAdapters', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).ERPCapabilities;
  });

  it('returns empty when native module absent (graceful degrade)', () => {
    expect(resolveNativeCapabilityAdapters()).toEqual({});
  });

  it('maps native methods to capability adapters with file normalization', async () => {
    installMockNative();
    const adapters = resolveNativeCapabilityAdapters();
    expect(adapters.scanner).toBeDefined();
    expect(await adapters.scanner!.scan()).toEqual({ code: 'X' });
    expect(await adapters.camera!.takePhoto()).toEqual({ uri: 'f.jpg' });

    const media = await adapters.media!.pickImage({ multiple: false });
    expect(media.files[0]).toEqual({
      name: 'a.png',
      size: 1,
      mimeType: 'image/png',
      uri: 'a',
    });

    const loc = await adapters.location!.getCurrentPosition();
    expect(loc).toEqual({ latitude: 1, longitude: 2, accuracy: 3 });
  });

  it('skips clipboard/appManager when native methods absent', () => {
    installMockNative();
    const adapters = resolveNativeCapabilityAdapters();
    expect(adapters.clipboard).toBeUndefined();
    expect(adapters.appManager).toBeUndefined();
  });

  it('maps clipboard methods to getString/setString/hasString', async () => {
    installMockNative({
      clipboardGetString: jest.fn(async () => ({ text: 'ERP-001' })),
      clipboardSetString: jest.fn(async () => ({ ok: true })),
      clipboardHasString: jest.fn(async () => ({ has: true })),
    });
    const clipboard = resolveNativeCapabilityAdapters().clipboard!;
    expect(await clipboard.getString()).toEqual({ text: 'ERP-001' });
    expect(await clipboard.setString('ERP-001')).toEqual({ ok: true });
    expect(await clipboard.hasString!()).toEqual({ has: true });
  });

  it('wraps native clipboard rejection as NATIVE_ERROR', async () => {
    installMockNative({
      clipboardGetString: jest.fn(async () => {
        throw new Error('PASTE_FAILED: no focus');
      }),
    });
    const err = await resolveNativeCapabilityAdapters()
      .clipboard!.getString()
      .catch(e => e as BridgeException);
    expect(err).toBeInstanceOf(BridgeException);
    expect(err.error.code).toBe('NATIVE_ERROR');
    expect(err.error.message).toContain('no focus');
  });

  it('exposes app management only for the methods the platform actually has', async () => {
    // 安卓：安装检测 + 深链打开 + 系统设置分区
    installMockNative({
      appInstalled: jest.fn(async () => ({ installed: true })),
      appOpen: jest.fn(async () => ({ opened: true })),
      appOpenSystemSettings: jest.fn(async () => ({ opened: true })),
    });
    const android = resolveNativeCapabilityAdapters().appManager!;
    expect(await android.isInstalled!('com.tencent.mm')).toEqual({ installed: true });
    expect(await android.openApp!('com.tencent.mm', { data: 'weixin://dl/business/' })).toEqual({
      opened: true,
    });
    expect(await android.openSystemSettings!('wifi')).toEqual({ opened: true });
    // 未提供的方法保持 undefined，由桥接层报 DEVICE_UNSUPPORTED
    expect(android.openAppStore).toBeUndefined();
  });

  it('keeps appManager alive for iOS-style partial native (only appOpenSettings)', async () => {
    installMockNative({
      appOpenSettings: jest.fn(async () => ({ opened: true })),
    });
    const appManager = resolveNativeCapabilityAdapters().appManager!;
    expect(await appManager.openAppSettings!()).toEqual({ opened: true });
    // iOS 没有包名维度的安装检测，这两项必须缺省而不是返回假数据
    expect(appManager.isInstalled).toBeUndefined();
    expect(appManager.openApp).toBeUndefined();
  });
});
