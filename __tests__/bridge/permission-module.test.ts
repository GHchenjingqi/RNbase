/**
 * permission 桥接模块单测：单项申请的错误码，与批量申请「不中断、不抛错」的语义。
 *
 * 批量申请（requestAll）是给 H5 首屏一次性铺权限用的：单项被拒不能力竭，
 * 结果按项回给 H5，由 H5 决定每一项的提示文案。
 */
import { BridgeServer } from '../../src/bridge/bridge-server';
import { registerPermissionModule } from '../../src/bridge/modules/permission';
import { PermissionManager } from '../../src/permissions/permission-manager';
import type { PermissionAdapter } from '../../src/permissions/adapters/permission-adapter';
import type { Permission, PermissionStatus } from '../../src/permissions/permissions.types';

let reqSeq = 0;

async function call(server: BridgeServer, action: string, params: unknown = {}) {
  reqSeq += 1;
  return server.handle({
    type: 'request',
    id: `permission-${action}-${reqSeq}`,
    version: '1.0.0',
    module: 'permission',
    action,
    params,
  });
}

/** 只关心 request 结果的权限适配器：其余方法给固定值。 */
function mockAdapter(
  request: (permission: Permission) => Promise<PermissionStatus>,
): PermissionAdapter {
  return {
    check: async () => 'notDetermined',
    request,
    openSettings: async () => true,
  };
}

function serverWith(adapter: PermissionAdapter): BridgeServer {
  const server = new BridgeServer({ timeoutMs: 1000 });
  registerPermissionModule(server, new PermissionManager(adapter));
  return server;
}

const grantAll = mockAdapter(async () => 'granted');

describe('permission.request', () => {
  test('授权成功回结构化数据', async () => {
    const res = await call(serverWith(grantAll), 'request', { permission: 'camera' });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      permission: 'camera',
      status: 'granted',
      granted: true,
      canAskAgain: false,
    });
  });

  test('拒绝回 PERMISSION_DENIED，永久拒绝回 PERMISSION_BLOCKED', async () => {
    const denied = serverWith(mockAdapter(async () => 'denied'));
    const blocked = serverWith(mockAdapter(async () => 'blocked'));
    expect((await call(denied, 'request', { permission: 'microphone' })).error?.code).toBe(
      'PERMISSION_DENIED',
    );
    expect((await call(blocked, 'request', { permission: 'microphone' })).error?.code).toBe(
      'PERMISSION_BLOCKED',
    );
  });

  test('permission 为空回 INVALID_PARAMS', async () => {
    expect((await call(serverWith(grantAll), 'request', {})).error?.code).toBe('INVALID_PARAMS');
  });
});

describe('permission.requestAll', () => {
  test('permissions 缺失或空数组回 INVALID_PARAMS', async () => {
    const server = serverWith(grantAll);
    expect((await call(server, 'requestAll', {})).error?.code).toBe('INVALID_PARAMS');
    expect((await call(server, 'requestAll', { permissions: [] })).error?.code).toBe(
      'INVALID_PARAMS',
    );
  });

  test('逐项申请不中断：被拒与原生异常都按未授权计入 results，响应仍成功', async () => {
    const asked: Permission[] = [];
    const server = serverWith(
      mockAdapter(async permission => {
        asked.push(permission);
        if (permission === 'microphone') {
          throw new Error('native crashed');
        }
        return permission === 'camera' ? 'granted' : 'denied';
      }),
    );
    const res = await call(server, 'requestAll', {
      permissions: ['camera', 'notification', 'microphone'],
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      ok: true,
      results: { camera: true, notification: false, microphone: false },
    });
    // 顺序即 H5 传入顺序：权限弹窗的先后直接决定用户看到的引导文案顺序
    expect(asked).toEqual(['camera', 'notification', 'microphone']);
  });
});
