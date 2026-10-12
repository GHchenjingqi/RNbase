/**
 * 权限结构化错误构造工具（对齐 Skill 规则 15 / 27：错误必须结构化、日志需脱敏）。
 */
import type { Permission, PermissionError, PermissionErrorCode } from './permissions.types';

const DEFAULT_MESSAGES: Record<PermissionErrorCode, string> = {
  PERMISSION_DENIED: '权限被拒绝',
  PERMISSION_BLOCKED: '权限被永久拒绝，请前往系统设置开启',
  PERMISSION_UNAVAILABLE: '当前设备不支持该能力',
  PERMISSION_UNSUPPORTED: '当前平台不支持该权限申请',
  PERMISSION_REQUEST_CANCELLED: '权限申请已取消',
  PERMISSION_UNKNOWN_ERROR: '权限申请发生未知错误',
};

export function createPermissionError(
  code: PermissionErrorCode,
  permission: Permission,
  message?: string,
): PermissionError {
  return {
    code,
    permission,
    message: message ?? DEFAULT_MESSAGES[code],
  };
}
