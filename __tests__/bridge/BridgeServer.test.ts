/**
 * Phase 3：BridgeServer 单元测试（规范 §10/§11/§14/§15/§17/§25）。
 */
import { BridgeServer } from '../../src/bridge/bridge-server';
import { BridgeException } from '../../src/bridge/bridge-error';
import type { BridgeRequest } from '../../src/bridge/protocol';

function makeRequest(overrides: Partial<BridgeRequest> = {}): BridgeRequest {
  return {
    type: 'request',
    id: `req_${Date.now()}_${Math.random()}`,
    version: '1.0.0',
    module: 'test',
    action: 'echo',
    params: {},
    ...overrides,
  };
}

describe('BridgeServer', () => {
  let server: BridgeServer;

  beforeEach(() => {
    server = new BridgeServer({ timeoutMs: 1000 });
  });

  test('register + handle 正常返回', async () => {
    server.register('test', 'echo', params => ({ echoed: params }));
    const req = makeRequest({
      module: 'test',
      action: 'echo',
      params: { hello: 'world' },
    });
    const res = await server.handle(req);
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ echoed: { hello: 'world' } });
  });

  test('registerModule 批量注册', async () => {
    // BridgeHandler 的入参是 unknown：测试里自己收一次窄化，别把参数写成具体类型（那是假安全，
    // 真实 handler 收到的都是 unknown）。
    const ab = (params: unknown) => params as { a: number; b: number };
    server.registerModule('test', {
      add: (params: unknown) => ab(params).a + ab(params).b,
      sub: (params: unknown) => ab(params).a - ab(params).b,
    });
    const res1 = await server.handle(
      makeRequest({ module: 'test', action: 'add', params: { a: 1, b: 2 } }),
    );
    expect(res1.data).toBe(3);
    const res2 = await server.handle(
      makeRequest({ module: 'test', action: 'sub', params: { a: 5, b: 3 } }),
    );
    expect(res2.data).toBe(2);
  });

  test('未注册 method 返回 METHOD_NOT_FOUND', async () => {
    const res = await server.handle(makeRequest({ module: 'nonexistent', action: 'foo' }));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('METHOD_NOT_FOUND');
  });

  test('handler 抛出 BridgeException 返回结构化错误', async () => {
    server.register('test', 'fail', () => {
      throw new BridgeException('PERMISSION_DENIED', 'no permission');
    });
    const res = await server.handle(makeRequest({ module: 'test', action: 'fail' }));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
    expect(res.error?.message).toBe('no permission');
  });

  test('handler 抛出普通异常返回 UNKNOWN_ERROR', async () => {
    server.register('test', 'boom', () => {
      throw new Error('unexpected');
    });
    const res = await server.handle(makeRequest({ module: 'test', action: 'boom' }));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('UNKNOWN_ERROR');
  });

  test('timeout 返回 TIMEOUT', async () => {
    server.register(
      'test',
      'slow',
      () => new Promise(resolve => setTimeout(() => resolve('done'), 2000)),
    );
    const res = await server.handle(makeRequest({ module: 'test', action: 'slow' }));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('TIMEOUT');
  }, 5000);

  test('重复 requestId 返回 INVALID_PARAMS', async () => {
    server.register('test', 'echo', () => 'ok');
    const req = makeRequest({ id: 'req_duplicate' });
    await server.handle(req);
    const res = await server.handle(req);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
  });

  test('version 不兼容返回 BRIDGE_VERSION_NOT_SUPPORTED', async () => {
    server.register('test', 'echo', () => 'ok');
    const res = await server.handle(makeRequest({ version: '2.0.0' }));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('BRIDGE_VERSION_NOT_SUPPORTED');
  });

  test('origin 校验：谓词放行的 origin 通过', async () => {
    const s = new BridgeServer({
      isTrustedOrigin: origin => origin === 'https://mobile-base.example.com',
    });
    s.register('test', 'echo', () => 'ok');
    const res = await s.handle(makeRequest(), 'https://mobile-base.example.com');
    expect(res.success).toBe(true);
  });

  test('origin 校验：非受信 origin 拒绝', async () => {
    const s = new BridgeServer({
      isTrustedOrigin: origin => origin === 'https://mobile-base.example.com',
    });
    s.register('test', 'echo', () => 'ok');
    const res = await s.handle(makeRequest(), 'https://evil.com');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('SECURITY_BLOCKED');
  });

  test('origin 校验：配了谓词就拿不到 origin 也拒绝（失败关闭，不再放行）', async () => {
    const s = new BridgeServer({
      isTrustedOrigin: () => true,
    });
    s.register('test', 'echo', () => 'ok');
    const res = await s.handle(makeRequest());
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('SECURITY_BLOCKED');
  });

  test('clearPending 清理所有 pending 并返回 BRIDGE_NOT_READY', async () => {
    server.register('test', 'slow', () => new Promise(() => undefined));
    const promise = server.handle(makeRequest({ module: 'test', action: 'slow' }));
    expect(server.pendingCount()).toBe(1);
    server.clearPending();
    expect(server.pendingCount()).toBe(0);
    const res = await promise;
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('BRIDGE_NOT_READY');
  });

  test('has 检查 method 是否已注册', () => {
    server.register('test', 'echo', () => 'ok');
    expect(server.has('test', 'echo')).toBe(true);
    expect(server.has('test', 'nonexistent')).toBe(false);
  });

  test('listMethods 返回所有已注册 method', () => {
    server.registerModule('test', { a: () => 1, b: () => 2 });
    const methods = server.listMethods();
    expect(methods).toContain('test.a');
    expect(methods).toContain('test.b');
    expect(methods.length).toBe(2);
  });

  test('emitEvent 通过 eventBus 推送', () => {
    const handler = jest.fn();
    server.eventBus.on('test.event', handler);
    server.emitEvent('test.event', { data: 1 });
    expect(handler).toHaveBeenCalledWith({ data: 1 });
  });

  test('onEvent 钩子在请求完成时触发', async () => {
    const onEvent = jest.fn();
    const s = new BridgeServer({ onEvent });
    s.register('test', 'echo', () => 'ok');
    await s.handle(makeRequest({ module: 'test', action: 'echo' }));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'test',
        action: 'echo',
        success: true,
      }),
    );
  });
});
