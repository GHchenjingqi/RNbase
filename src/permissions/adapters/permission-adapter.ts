/**
 * 平台权限适配器接口。
 *
 * 与 Skill 规则 51 一致：Android/iOS 差异必须集中在 platform adapter，
 * 业务与 PermissionManager 不直接依赖具体原生实现。
 */
import type { Permission, PermissionStatus } from '../permissions.types';

export interface PermissionAdapter {
  /** 查询当前权限状态。 */
  check(permission: Permission): Promise<PermissionStatus>;
  /** 向系统申请权限，返回申请后的状态。 */
  request(permission: Permission): Promise<PermissionStatus>;
  /** 跳转系统设置页（用于永久拒绝后的再次授权）。 */
  openSettings(): Promise<boolean>;
}
