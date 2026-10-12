/**
 * 跨平台权限管理器（业务无关的纯逻辑）。
 *
 * 落实 Skill 规则 11：在涉及权限/隐私/相机/相册/定位/文件时，
 * 同步处理 用户授权、拒绝、再次授权、错误提示。
 *
 * 本类只负责状态机与结构化结果，原生平差异在 adapter，
 * UI 提示在 PermissionGate，避免把原生 API 直接写在页面里（规则 40）。
 */
import { createPermissionError } from './permission-errors';
import type {
  Permission,
  PermissionError,
  PermissionResult,
  PermissionStatus,
} from './permissions.types';
import type { PermissionAdapter } from './adapters/permission-adapter';
import { androidPermissionAdapter } from './adapters/android-permission-adapter';
import { iosPermissionAdapter } from './adapters/ios-permission-adapter';
import { harmonyPermissionAdapter } from './adapters/harmony-permission-adapter';
import { isHarmony, isIos } from '../platform/os';

function getDefaultAdapter(): PermissionAdapter {
  // RN 的 Platform.OS 联合类型里没有 'harmony'，一律先按 string 取值再比较（见 platform/os.ts）。
  if (isHarmony()) return harmonyPermissionAdapter;
  return isIos() ? iosPermissionAdapter : androidPermissionAdapter;
}

function canAskAgainFor(status: PermissionStatus): boolean {
  return status === 'denied';
}

function errorForStatus(
  status: PermissionStatus,
  permission: Permission,
): PermissionError | undefined {
  switch (status) {
    case 'denied':
      return createPermissionError('PERMISSION_DENIED', permission);
    case 'blocked':
      return createPermissionError('PERMISSION_BLOCKED', permission);
    case 'unavailable':
      return createPermissionError('PERMISSION_UNAVAILABLE', permission);
    default:
      return undefined;
  }
}

export function buildResult(permission: Permission, status: PermissionStatus): PermissionResult {
  return {
    permission,
    status,
    granted: status === 'granted',
    canAskAgain: canAskAgainFor(status),
    error: errorForStatus(status, permission),
  };
}

export class PermissionManager {
  private readonly adapter: PermissionAdapter;

  constructor(adapter?: PermissionAdapter) {
    this.adapter = adapter ?? getDefaultAdapter();
  }

  async check(permission: Permission): Promise<PermissionResult> {
    const status = await this.adapter.check(permission);
    return buildResult(permission, status);
  }

  /**
   * 申请权限。返回结构化结果，覆盖：授权成功 / 拒绝（可再次授权）/
   * 永久拒绝（需前往设置）/ 不支持 / 未知错误。
   */
  async request(permission: Permission): Promise<PermissionResult> {
    const status = await this.adapter.request(permission);
    return buildResult(permission, status);
  }

  /** 跳转系统设置，用于永久拒绝后的再次授权。 */
  async openSettings(): Promise<boolean> {
    return this.adapter.openSettings();
  }
}

export const permissionManager = new PermissionManager();
