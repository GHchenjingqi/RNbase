/**
 * Phase 4：H5 SDK 单元测试（规范 §13/§16/§42/§62）。
 */
import { BridgeClient } from '../../src/bridge/client/bridge-client';
import { createNative } from '../../src/bridge/client/Native';
import {
  createMockTransport,
  createBrowserMockTransport,
} from '../../src/bridge/client/adapters/mock-transport';
import type { BridgeTransport } from '../../src/bridge/client/types';
import type { BridgeRequest, BridgeResponse } from '../../src/bridge/protocol';
import { APP_VERSION } from '../../src/config';

function makeEchoTransport(): {
  transport: BridgeTransport;
  requests: BridgeRequest[];
} {
  const requests: BridgeRequest[] = [];
  const transport = createMockTransport(raw => {
    const req = JSON.parse(raw) as BridgeRequest;
    requests.push(req);
    const res: BridgeResponse = {
      type: 'response',
      id: req.id,
      success: true,
      data: { echoed: req.params, module: req.module, action: req.action },
      error: null,
    };
    return JSON.stringify(res);
  });
  return { transport, requests };
}

describe('BridgeClient 事件订阅', () => {
  test('on 订阅事件，收到 event 消息时触发', () => {
    let eventListener: (raw: string) => void = () => {};
    const transport: BridgeTransport = {
      send: () => {},
      subscribe: l => {
        eventListener = l;
        return () => {
          eventListener = () => {};
        };
      },
    };
    const client = new BridgeClient(transport);
    const handler = jest.fn();
    client.on('test.event', handler);
    eventListener?.(
      JSON.stringify({
        type: 'event',
        event: 'test.event',
        data: { x: 1 },
        timestamp: 1,
      }),
    );
    expect(handler).toHaveBeenCalledWith({ x: 1 });
    client.destroy();
  });

  test('off 取消订阅后不再触发', () => {
    let eventListener: (raw: string) => void = () => {};
    const transport: BridgeTransport = {
      send: () => {},
      subscribe: l => {
        eventListener = l;
        return () => {
          eventListener = () => {};
        };
      },
    };
    const client = new BridgeClient(transport);
    const handler = jest.fn();
    client.on('test.event', handler);
    client.off('test.event', handler);
    eventListener?.(
      JSON.stringify({
        type: 'event',
        event: 'test.event',
        data: null,
        timestamp: 1,
      }),
    );
    expect(handler).not.toHaveBeenCalled();
    client.destroy();
  });

  test('once 只触发一次', () => {
    let eventListener: (raw: string) => void = () => {};
    const transport: BridgeTransport = {
      send: () => {},
      subscribe: l => {
        eventListener = l;
        return () => {
          eventListener = () => {};
        };
      },
    };
    const client = new BridgeClient(transport);
    const handler = jest.fn();
    client.once('test.event', handler);
    const evt = JSON.stringify({
      type: 'event',
      event: 'test.event',
      data: { n: 1 },
      timestamp: 1,
    });
    eventListener?.(evt);
    eventListener?.(evt);
    expect(handler).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  test('on 返回 unsubscribe 函数', () => {
    const { transport } = makeEchoTransport();
    const client = new BridgeClient(transport);
    const handler = jest.fn();
    const unsubscribe = client.on('test.event', handler);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    client.destroy();
  });
});

describe('BridgeClient 能力检测', () => {
  test('getCapabilities 从 Native 获取并缓存', async () => {
    const transport = createBrowserMockTransport({
      capabilities: { camera: true, nfc: false },
    });
    const client = new BridgeClient(transport);
    const caps1 = await client.getCapabilities();
    expect(caps1.camera).toBe(true);
    expect(caps1.nfc).toBe(false);
    // 第二次应使用缓存
    const caps2 = await client.getCapabilities();
    expect(caps2).toBe(caps1);
    client.destroy();
  });

  test('supports 返回能力是否可用', async () => {
    const transport = createBrowserMockTransport({
      capabilities: { camera: true, nfc: false },
    });
    const client = new BridgeClient(transport);
    expect(await client.supports('camera')).toBe(true);
    expect(await client.supports('nfc')).toBe(false);
    expect(await client.supports('nonexistent')).toBe(false);
    client.destroy();
  });

  test('clearCapabilitiesCache 清除缓存', async () => {
    const transport = createBrowserMockTransport({
      capabilities: { camera: true },
    });
    const client = new BridgeClient(transport);
    await client.getCapabilities();
    client.clearCapabilitiesCache();
    const caps = await client.getCapabilities();
    expect(caps.camera).toBe(true);
    client.destroy();
  });
});

describe('Native 门面', () => {
  test('app.getInfo 返回正确结构', async () => {
    const transport = createBrowserMockTransport();
    const native = createNative(new BridgeClient(transport));
    const info = await native.app.getInfo();
    expect(info.appVersion).toBe(APP_VERSION);
    expect(info.platform).toBe('web');
  });

  test('app.ready 返回 ok', async () => {
    const transport = createBrowserMockTransport();
    const native = createNative(new BridgeClient(transport));
    const res = await native.app.ready({ h5Version: '1.0.0' });
    expect(res.ok).toBe(true);
  });

  test('network.getStatus 返回连接状态', async () => {
    const transport = createBrowserMockTransport();
    const native = createNative(new BridgeClient(transport));
    const status = await native.network.getStatus();
    expect(status.connected).toBe(true);
    expect(status.type).toBe('wifi');
  });

  test('scanner.scan 返回扫码结果', async () => {
    const transport = createBrowserMockTransport({ scanResult: 'TEST-123' });
    const native = createNative(new BridgeClient(transport));
    const result = await native.scanner.scan();
    expect(result.code).toBe('TEST-123');
    expect(result.format).toBe('QR_CODE');
  });

  test('permission.request 返回已授权', async () => {
    const transport = createBrowserMockTransport();
    const native = createNative(new BridgeClient(transport));
    const result = await native.permission.request({ permission: 'camera' });
    expect(result.granted).toBe(true);
    expect(result.status).toBe('granted');
  });

  test('permission_denied 场景返回错误', async () => {
    const transport = createBrowserMockTransport({
      scenario: 'permission_denied',
      overrides: { 'permission.request': 'permission_denied' },
    });
    const native = createNative(new BridgeClient(transport));
    await expect(native.permission.request({ permission: 'camera' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  test('10 个模块都存在', () => {
    const transport = createBrowserMockTransport();
    const native = createNative(new BridgeClient(transport));
    expect(native.app).toBeDefined();
    expect(native.auth).toBeDefined();
    expect(native.network).toBeDefined();
    expect(native.camera).toBeDefined();
    expect(native.scanner).toBeDefined();
    expect(native.media).toBeDefined();
    expect(native.file).toBeDefined();
    expect(native.location).toBeDefined();
    expect(native.system).toBeDefined();
    expect(native.notification).toBeDefined();
    expect(native.permission).toBeDefined();
  });

  test('事件订阅方法存在', () => {
    const transport = createBrowserMockTransport();
    const native = createNative(new BridgeClient(transport));
    expect(typeof native.on).toBe('function');
    expect(typeof native.off).toBe('function');
    expect(typeof native.once).toBe('function');
  });

  test('能力检测方法存在', () => {
    const transport = createBrowserMockTransport();
    const native = createNative(new BridgeClient(transport));
    expect(typeof native.supports).toBe('function');
    expect(typeof native.getCapabilities).toBe('function');
  });
});

describe('BrowserMockTransport', () => {
  test('默认场景返回成功', async () => {
    const transport = createBrowserMockTransport();
    const client = new BridgeClient(transport);
    const result = await client.request('app', 'getInfo');
    expect(result).toBeDefined();
    client.destroy();
  });

  test('capability_missing 场景返回 DEVICE_UNSUPPORTED', async () => {
    const transport = createBrowserMockTransport({
      overrides: { 'camera.takePhoto': 'capability_missing' },
    });
    const client = new BridgeClient(transport);
    await expect(client.request('camera', 'takePhoto')).rejects.toMatchObject({
      code: 'DEVICE_UNSUPPORTED',
    });
    client.destroy();
  });

  test('自定义延迟生效', async () => {
    const transport = createBrowserMockTransport({ delayMs: 50 });
    const client = new BridgeClient(transport);
    const start = Date.now();
    await client.request('app', 'getInfo');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    client.destroy();
  });
});
