/**
 * WebView 消息处理单测：验证 H5 请求经 BridgeServer 后回传结构化响应，
 * 且非 request 消息被忽略。
 */
import { createWebViewMessageHandler } from '../src/webview/webview-message-handler';
import { createBridgeServer } from '../src/bridge';
import { PermissionManager } from '../src/permissions/permission-manager';
import type { PermissionAdapter } from '../src/permissions/adapters/permission-adapter';
import type { PermissionStatus } from '../src/permissions/permissions.types';

function mockAdapter(status: PermissionStatus): PermissionAdapter {
  return {
    check: async () => status,
    request: async () => status,
    openSettings: async () => true,
  };
}

describe('createWebViewMessageHandler', () => {
  it('returns JSON response for a valid bridge request', async () => {
    const server = createBridgeServer();
    const handler = createWebViewMessageHandler(server);
    const req = JSON.stringify({
      type: 'request',
      id: 'wv1',
      version: '1.0.0',
      module: 'app',
      action: 'getCapabilities',
    });
    const raw = await handler(req);
    expect(raw).not.toBeNull();
    const res = JSON.parse(raw as string);
    expect(res.id).toBe('wv1');
    expect(res.success).toBe(true);
    expect(res.data).toHaveProperty('features');
  });

  it('round-trips a permission denial through the WebView channel', async () => {
    const server = createBridgeServer(new PermissionManager(mockAdapter('denied')));
    const handler = createWebViewMessageHandler(server);
    const req = JSON.stringify({
      type: 'request',
      id: 'wv2',
      version: '1.0.0',
      module: 'permission',
      action: 'request',
      params: { permission: 'camera' },
    });
    const raw = await handler(req);
    const res = JSON.parse(raw as string);
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('PERMISSION_DENIED');
  });

  it('ignores non-request messages', async () => {
    const server = createBridgeServer();
    const handler = createWebViewMessageHandler(server);
    expect(await handler('not-json')).toBeNull();
    expect(await handler(JSON.stringify({ type: 'event', event: 'ping' }))).toBeNull();
  });
});
