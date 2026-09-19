/**
 * 原生网络适配器单测：验证对接 NativeModules.ERPNetwork，
 * 以及原生未链接时安全降级为 undefined（模块返回 DEVICE_UNSUPPORTED）。
 */
import { NativeModules } from 'react-native';
import { resolveNativeNetworkAdapter } from '../src/middleware/network/native-network-adapter';

function installMockNative(overrides: Record<string, unknown> = {}) {
  (NativeModules as Record<string, unknown>).ERPNetwork = {
    getStatus: jest.fn(async () => ({ connected: true, type: 'wifi' })),
    ...overrides,
  };
}

describe('resolveNativeNetworkAdapter', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).ERPNetwork;
  });

  it('returns undefined when native module absent (graceful degrade)', () => {
    expect(resolveNativeNetworkAdapter()).toBeUndefined();
  });

  it('returns adapter mapping getStatus to native module', async () => {
    installMockNative();
    const adapter = resolveNativeNetworkAdapter();
    expect(adapter).toBeDefined();
    const status = await adapter!.getStatus();
    expect(status).toEqual({ connected: true, type: 'wifi' });
  });

  it('respects overrides', async () => {
    installMockNative({
      getStatus: jest.fn(async () => ({ connected: false, type: 'none' })),
    });
    const adapter = resolveNativeNetworkAdapter();
    const status = await adapter!.getStatus();
    expect(status).toEqual({ connected: false, type: 'none' });
  });
});
