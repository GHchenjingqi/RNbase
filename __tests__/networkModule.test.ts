/**
 * network 桥接模块单测：验证 getStatus 通过适配器转发到原生，
 * 以及原生未接入时抛出 DEVICE_UNSUPPORTED。
 */
import { NativeModules } from 'react-native';
import { BridgeServer } from '../src/bridge/bridge-server';
import { registerNetworkModule } from '../src/middleware/network/network-module';
import { resolveNativeNetworkAdapter } from '../src/middleware/network/native-network-adapter';

function installMockNative(overrides: Record<string, unknown> = {}) {
  (NativeModules as Record<string, unknown>).ERPNetwork = {
    getStatus: jest.fn(async () => ({ connected: true, type: 'wifi' })),
    ...overrides,
  };
}

describe('registerNetworkModule', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).ERPNetwork;
  });

  it('getStatus forwards to native adapter', async () => {
    installMockNative({
      getStatus: jest.fn(async () => ({ connected: true, type: 'wifi' })),
    });
    const server = new BridgeServer();
    registerNetworkModule(server, resolveNativeNetworkAdapter());
    const res = await server.handle({
      type: 'request',
      id: 'n1',
      version: '1.0.0',
      module: 'network',
      action: 'getStatus',
      params: {},
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ connected: true, type: 'wifi' });
  });

  it('returns DEVICE_UNSUPPORTED when adapter is undefined', async () => {
    const server = new BridgeServer();
    registerNetworkModule(server, undefined);
    const res = await server.handle({
      type: 'request',
      id: 'n2',
      version: '1.0.0',
      module: 'network',
      action: 'getStatus',
      params: {},
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  it('cellular type is reported correctly', async () => {
    installMockNative({
      getStatus: jest.fn(async () => ({ connected: true, type: 'cellular' })),
    });
    const server = new BridgeServer();
    registerNetworkModule(server, resolveNativeNetworkAdapter());
    const res = await server.handle({
      type: 'request',
      id: 'n3',
      version: '1.0.0',
      module: 'network',
      action: 'getStatus',
      params: {},
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ connected: true, type: 'cellular' });
  });

  it('disconnected state is reported correctly', async () => {
    installMockNative({
      getStatus: jest.fn(async () => ({ connected: false, type: 'none' })),
    });
    const server = new BridgeServer();
    registerNetworkModule(server, resolveNativeNetworkAdapter());
    const res = await server.handle({
      type: 'request',
      id: 'n4',
      version: '1.0.0',
      module: 'network',
      action: 'getStatus',
      params: {},
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ connected: false, type: 'none' });
  });
});
