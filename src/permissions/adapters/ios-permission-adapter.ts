/**
 * iOS 权限适配器。
 *
 * iOS 的相机/相册/定位等权限需要原生侧实现，因此通过约定的
 * TurboModule / NativeModule `ERPPermissions` 暴露。
 * 若原生模块未链接，安全降级为 `unavailable`，避免运行时崩溃。
 *
 * 与 Skill 规则 5（禁止 H5 直接依赖具体原生实现）一致：差异集中在 adapter。
 */
import { Linking, NativeModules, Platform } from 'react-native';
import type { Permission, PermissionStatus } from '../permissions.types';
import type { PermissionAdapter } from './permission-adapter';

interface ERPPermissionsNativeModule {
  check(permission: Permission): Promise<string>;
  request(permission: Permission): Promise<string>;
}

const nativeModule = (NativeModules as Record<string, unknown>).ERPPermissions as
  | ERPPermissionsNativeModule
  | undefined;

function normalizeNativeStatus(status: string): PermissionStatus {
  switch (status) {
    case 'authorized':
    case 'limited':
    case 'granted':
      return 'granted';
    case 'notDetermined':
      return 'notDetermined';
    case 'restricted':
    case 'denied':
    case 'blocked':
    default:
      return 'blocked';
  }
}

export const iosPermissionAdapter: PermissionAdapter = {
  async check(permission: Permission): Promise<PermissionStatus> {
    if (!nativeModule) {
      return 'unavailable';
    }
    const status = await nativeModule.check(permission);
    return normalizeNativeStatus(status);
  },

  async request(permission: Permission): Promise<PermissionStatus> {
    if (!nativeModule) {
      return 'unavailable';
    }
    const status = await nativeModule.request(permission);
    return normalizeNativeStatus(status);
  },

  async openSettings(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false;
    }
    // iOS 通过 URL Scheme 跳转应用设置。
    const supported = await Linking.canOpenURL('app-settings:');
    if (!supported) {
      return false;
    }
    await Linking.openURL('app-settings:');
    return true;
  },
};
