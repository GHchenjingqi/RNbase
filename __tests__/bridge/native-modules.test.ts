/**
 * Phase 5：Native 能力模块单元测试（规范 §12/§13/§16/§50）。
 */
import { BridgeServer } from '../../src/bridge/bridge-server';
import { registerAuthModule, createMemoryAuthStore } from '../../src/bridge/modules/auth';
import { registerSystemModule } from '../../src/bridge/modules/system';
import { registerNotificationModule } from '../../src/bridge/modules/notification';
import { createBridgeServer } from '../../src/bridge';

function makeServer(): BridgeServer {
  return new BridgeServer({ timeoutMs: 1000 });
}

describe('auth 模块', () => {
  test('getToken 默认返回 null', async () => {
    const server = makeServer();
    registerAuthModule(server);
    const res = await server.handle({
      type: 'request',
      id: 't1',
      version: '1.0.0',
      module: 'auth',
      action: 'getToken',
      params: {},
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ token: null });
  });

  test('getUser 默认返回 null', async () => {
    const server = makeServer();
    registerAuthModule(server);
    const res = await server.handle({
      type: 'request',
      id: 't2',
      version: '1.0.0',
      module: 'auth',
      action: 'getUser',
      params: {},
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ user: null });
  });

  test('自定义 store 可返回 token 和 user', async () => {
    const server = makeServer();
    const store = {
      getToken: () => 'test-token-123',
      getUser: () => ({ id: 'u1', name: 'Test' }),
      logout: () => {},
    };
    registerAuthModule(server, store);
    const tokenRes = await server.handle({
      type: 'request',
      id: 't3',
      version: '1.0.0',
      module: 'auth',
      action: 'getToken',
      params: {},
    });
    expect(tokenRes.data).toEqual({ token: 'test-token-123' });
    const userRes = await server.handle({
      type: 'request',
      id: 't4',
      version: '1.0.0',
      module: 'auth',
      action: 'getUser',
      params: {},
    });
    expect(userRes.data).toEqual({ user: { id: 'u1', name: 'Test' } });
  });

  test('logout 清除 token 并推送事件', async () => {
    const server = makeServer();
    const store = createMemoryAuthStore();
    registerAuthModule(server, store);
    // 先设置 token（通过直接操作 store 内部不可行，用自定义 store）
    let token: string | null = 'before-logout';
    const store2 = {
      getToken: () => token,
      getUser: () => null,
      logout: () => {
        token = null;
      },
    };
    const server2 = makeServer();
    registerAuthModule(server2, store2);
    const beforeRes = await server2.handle({
      type: 'request',
      id: 't5',
      version: '1.0.0',
      module: 'auth',
      action: 'getToken',
      params: {},
    });
    expect(beforeRes.data).toEqual({ token: 'before-logout' });
    const logoutRes = await server2.handle({
      type: 'request',
      id: 't6',
      version: '1.0.0',
      module: 'auth',
      action: 'logout',
      params: {},
    });
    expect(logoutRes.success).toBe(true);
    expect(logoutRes.data).toEqual({ ok: true });
    const afterRes = await server2.handle({
      type: 'request',
      id: 't7',
      version: '1.0.0',
      module: 'auth',
      action: 'getToken',
      params: {},
    });
    expect(afterRes.data).toEqual({ token: null });
  });
});

describe('system 模块', () => {
  test('vibrate 调用成功（不依赖 adapter）', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await server.handle({
      type: 'request',
      id: 's1',
      version: '1.0.0',
      module: 'system',
      action: 'vibrate',
      params: { duration: 200 },
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ok: true });
  });

  test('copy 无 adapter 时返回 DEVICE_UNSUPPORTED', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await server.handle({
      type: 'request',
      id: 's2',
      version: '1.0.0',
      module: 'system',
      action: 'copy',
      params: { text: 'hello' },
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  test('copy 空 text 返回 INVALID_PARAMS', async () => {
    const server = makeServer();
    registerSystemModule(server, { copy: async () => true });
    const res = await server.handle({
      type: 'request',
      id: 's3',
      version: '1.0.0',
      module: 'system',
      action: 'copy',
      params: {},
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
  });

  test('copy 有 adapter 时调用成功', async () => {
    const server = makeServer();
    const copyFn = jest.fn(async () => true);
    registerSystemModule(server, { copy: copyFn });
    const res = await server.handle({
      type: 'request',
      id: 's4',
      version: '1.0.0',
      module: 'system',
      action: 'copy',
      params: { text: 'hello' },
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ok: true });
    expect(copyFn).toHaveBeenCalledWith('hello');
  });

  test('share 无 adapter 时返回 DEVICE_UNSUPPORTED', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await server.handle({
      type: 'request',
      id: 's5',
      version: '1.0.0',
      module: 'system',
      action: 'share',
      params: { text: 'hello' },
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  test('share text 和 url 同时为空返回 INVALID_PARAMS', async () => {
    const server = makeServer();
    registerSystemModule(server, { share: async () => true });
    const res = await server.handle({
      type: 'request',
      id: 's6',
      version: '1.0.0',
      module: 'system',
      action: 'share',
      params: {},
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
  });
});

describe('notification 模块', () => {
  test('getToken 无 adapter 时返回 DEVICE_UNSUPPORTED', async () => {
    const server = makeServer();
    registerNotificationModule(server);
    const res = await server.handle({
      type: 'request',
      id: 'n1',
      version: '1.0.0',
      module: 'notification',
      action: 'getToken',
      params: {},
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  test('getToken 有 adapter 时返回 token', async () => {
    const server = makeServer();
    registerNotificationModule(server, {
      getToken: async () => 'push-token-123',
    });
    const res = await server.handle({
      type: 'request',
      id: 'n2',
      version: '1.0.0',
      module: 'notification',
      action: 'getToken',
      params: {},
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ token: 'push-token-123' });
  });

  test('setBadge 负数返回 INVALID_PARAMS', async () => {
    const server = makeServer();
    registerNotificationModule(server, { setBadge: async () => true });
    const res = await server.handle({
      type: 'request',
      id: 'n3',
      version: '1.0.0',
      module: 'notification',
      action: 'setBadge',
      params: { count: -1 },
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
  });

  test('setBadge 无 adapter 时返回 DEVICE_UNSUPPORTED', async () => {
    const server = makeServer();
    registerNotificationModule(server);
    const res = await server.handle({
      type: 'request',
      id: 'n4',
      version: '1.0.0',
      module: 'notification',
      action: 'setBadge',
      params: { count: 3 },
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  test('setBadge 有 adapter 时调用成功', async () => {
    const server = makeServer();
    const setBadgeFn = jest.fn(async () => true);
    registerNotificationModule(server, { setBadge: setBadgeFn });
    const res = await server.handle({
      type: 'request',
      id: 'n5',
      version: '1.0.0',
      module: 'notification',
      action: 'setBadge',
      params: { count: 5 },
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ok: true });
    expect(setBadgeFn).toHaveBeenCalledWith(5);
  });
});

describe('10 模块完整性', () => {
  test('createBridgeServer 注册了全部 40 个模块', () => {
    const server = createBridgeServer();
    const methods = server.listMethods();
    const modules = new Set(methods.map(m => m.split('.')[0]));
    // 基础模块
    expect(modules.has('app')).toBe(true);
    expect(modules.has('permission')).toBe(true);
    expect(modules.has('auth')).toBe(true);
    expect(modules.has('system')).toBe(true);
    expect(modules.has('notification')).toBe(true);
    expect(modules.has('network')).toBe(true);
    expect(modules.has('log')).toBe(true);
    // 设备能力模块
    expect(modules.has('camera')).toBe(true);
    expect(modules.has('scanner')).toBe(true);
    expect(modules.has('media')).toBe(true);
    expect(modules.has('file')).toBe(true);
    expect(modules.has('location')).toBe(true);
    expect(modules.has('clipboard')).toBe(true);
    expect(modules.has('brightness')).toBe(true);
    expect(modules.has('flashlight')).toBe(true);
    expect(modules.has('sensor')).toBe(true);
    expect(modules.has('biometric')).toBe(true);
    expect(modules.has('contacts')).toBe(true);
    expect(modules.has('calendar')).toBe(true);
    expect(modules.has('nfc')).toBe(true);
    expect(modules.has('bluetooth')).toBe(true);
    expect(modules.has('audio')).toBe(true);
    expect(modules.has('storage')).toBe(true);
    expect(modules.has('networkInfo')).toBe(true);
    expect(modules.has('qr')).toBe(true);
    expect(modules.has('image')).toBe(true);
    expect(modules.has('haptics')).toBe(true);
    expect(modules.has('speech')).toBe(true);
    expect(modules.has('appManager')).toBe(true);
    expect(modules.has('backgroundTask')).toBe(true);
    expect(modules.has('inAppReview')).toBe(true);
    // 纯 RN 模块
    expect(modules.has('toast')).toBe(true);
    expect(modules.has('dialog')).toBe(true);
    expect(modules.has('orientation')).toBe(true);
    expect(modules.has('statusBar')).toBe(true);
    expect(modules.has('keyboard')).toBe(true);
    expect(modules.has('navigation')).toBe(true);
    expect(modules.has('webView')).toBe(true);
    expect(modules.has('device')).toBe(true);
    expect(modules.has('battery')).toBe(true);
    expect(modules.size).toBe(40);
  });
});
