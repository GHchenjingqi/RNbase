/**
 * PermissionManager 单元测试：验证 Skill 规则 11 的状态机与结构化错误。
 * 使用内存 mock adapter，不依赖真实原生权限 API。
 */
import { PermissionManager, buildResult } from '../src/permissions/permission-manager';
import type { PermissionAdapter } from '../src/permissions/adapters/permission-adapter';
import type { PermissionStatus } from '../src/permissions/permissions.types';

function createMockAdapter(
  statuses: Partial<Record<'check' | 'request', PermissionStatus>>,
  openSettingsResult = true,
): PermissionAdapter {
  return {
    check: async () => statuses.check ?? 'notDetermined',
    request: async () => statuses.request ?? 'denied',
    openSettings: async () => openSettingsResult,
  };
}

describe('buildResult', () => {
  it('marks granted correctly', () => {
    const result = buildResult('camera', 'granted');
    expect(result.granted).toBe(true);
    expect(result.canAskAgain).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('marks denied as re-requestable with PERMISSION_DENIED', () => {
    const result = buildResult('camera', 'denied');
    expect(result.granted).toBe(false);
    expect(result.canAskAgain).toBe(true);
    expect(result.error?.code).toBe('PERMISSION_DENIED');
  });

  it('marks blocked as non re-requestable with PERMISSION_BLOCKED', () => {
    const result = buildResult('camera', 'blocked');
    expect(result.granted).toBe(false);
    expect(result.canAskAgain).toBe(false);
    expect(result.error?.code).toBe('PERMISSION_BLOCKED');
  });

  it('marks unavailable with PERMISSION_UNAVAILABLE', () => {
    const result = buildResult('file', 'unavailable');
    expect(result.error?.code).toBe('PERMISSION_UNAVAILABLE');
  });
});

describe('PermissionManager', () => {
  it('check returns structured result from adapter', async () => {
    const manager = new PermissionManager(createMockAdapter({ check: 'granted' }));
    const result = await manager.check('camera');
    expect(result.status).toBe('granted');
    expect(result.granted).toBe(true);
  });

  it('request granted', async () => {
    const manager = new PermissionManager(createMockAdapter({ request: 'granted' }));
    const result = await manager.request('camera');
    expect(result.granted).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('request denied allows re-auth (再次授权)', async () => {
    const manager = new PermissionManager(createMockAdapter({ request: 'denied' }));
    const result = await manager.request('camera');
    expect(result.granted).toBe(false);
    expect(result.canAskAgain).toBe(true);
    expect(result.error?.code).toBe('PERMISSION_DENIED');
  });

  it('request blocked requires settings (再次授权 via settings)', async () => {
    const manager = new PermissionManager(createMockAdapter({ request: 'blocked' }));
    const result = await manager.request('camera');
    expect(result.canAskAgain).toBe(false);
    expect(result.error?.code).toBe('PERMISSION_BLOCKED');
  });

  it('openSettings delegates to adapter', async () => {
    const manager = new PermissionManager(createMockAdapter({}, false));
    expect(await manager.openSettings()).toBe(false);
  });
});
