/**
 * permission 桥接模块（规则 50 + 规则 11）。
 *
 * H5 调用：
 *   Native.permission.request({ permission: 'camera' })
 *
 * 落地到统一的 PermissionManager，并把结果转为 Bridge 结构化响应：
 *  - 授权成功 -> success:true + { status, granted, canAskAgain }
 *  - 拒绝     -> PERMISSION_DENIED
 *  - 永久拒绝 -> PERMISSION_BLOCKED（引导 H5 提示前往系统设置）
 *  - 不支持   -> PERMISSION_UNAVAILABLE
 */
import { BridgeException } from '../bridge-error';
import type { BridgeServer } from '../bridge-server';
import type { BridgeErrorCode, PermissionRequestParams, PermissionResultData } from '../protocol';
import { PermissionManager } from '../../permissions/permission-manager';
import type { PermissionResult } from '../../permissions/permissions.types';

function toData(result: PermissionResult): PermissionResultData {
  return {
    permission: result.permission,
    status: result.status,
    granted: result.granted,
    canAskAgain: result.canAskAgain,
  };
}

function errorCodeFor(status: PermissionResult['status']): BridgeErrorCode {
  switch (status) {
    case 'denied':
      return 'PERMISSION_DENIED';
    case 'blocked':
      return 'PERMISSION_BLOCKED';
    case 'unavailable':
      return 'PERMISSION_UNAVAILABLE';
    default:
      return 'UNKNOWN_ERROR';
  }
}

export function registerPermissionModule(
  server: BridgeServer,
  manager: PermissionManager = new PermissionManager(),
): void {
  server.registerModule('permission', {
    async check(params) {
      const p = params as PermissionRequestParams;
      if (!p?.permission) {
        throw new BridgeException('INVALID_PARAMS', 'permission 不能为空');
      }
      const result = await manager.check(p.permission);
      return toData(result);
    },

    async request(params) {
      const p = params as PermissionRequestParams;
      if (!p?.permission) {
        throw new BridgeException('INVALID_PARAMS', 'permission 不能为空');
      }
      const result = await manager.request(p.permission);
      if (!result.granted) {
        throw new BridgeException(errorCodeFor(result.status), result.error?.message);
      }
      return toData(result);
    },

    async openSettings() {
      const opened = await manager.openSettings();
      return { opened };
    },
  });
}
