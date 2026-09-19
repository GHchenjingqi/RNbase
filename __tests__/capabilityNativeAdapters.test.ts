/**
 * 原生能力适配器单测：验证对接 NativeModules.ERPCapabilities，
 * 以及原生未链接时安全降级为空（模块返回 DEVICE_UNSUPPORTED）。
 */
import { NativeModules } from 'react-native';
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
});
