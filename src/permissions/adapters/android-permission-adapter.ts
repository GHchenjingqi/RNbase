/**
 * Android 权限适配器。
 *
 * 使用 RN 内置的 PermissionsAndroid，不引入额外原生依赖。
 * 通过将 `never_ask_again` 映射为 `blocked`，支撑 Skill 规则 11 的
 * “永久拒绝 -> 前往系统设置再次授权”流程。
 */
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import type { Permission, PermissionStatus } from '../permissions.types';
import type { PermissionAdapter } from './permission-adapter';

type AndroidPermission = Parameters<typeof PermissionsAndroid.check>[0];

const ANDROID_PERMISSIONS: Record<Permission, AndroidPermission | null> = {
  camera: PermissionsAndroid.PERMISSIONS.CAMERA,
  photo:
    PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES ??
    PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
  location: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  locationWhenInUse: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  notification: PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS ?? null,
  file:
    PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES ??
    PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
  microphone: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
};

function normalizeResult(result: string): PermissionStatus {
  switch (result) {
    case PermissionsAndroid.RESULTS.GRANTED:
      return 'granted';
    case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
      return 'blocked';
    case PermissionsAndroid.RESULTS.DENIED:
    default:
      return 'denied';
  }
}

export const androidPermissionAdapter: PermissionAdapter = {
  async check(permission: Permission): Promise<PermissionStatus> {
    const androidPermission = ANDROID_PERMISSIONS[permission];
    if (!androidPermission) {
      return 'unavailable';
    }
    const result = await PermissionsAndroid.check(androidPermission);
    return result ? 'granted' : 'denied';
  },

  async request(permission: Permission): Promise<PermissionStatus> {
    const androidPermission = ANDROID_PERMISSIONS[permission];
    if (!androidPermission) {
      return 'unavailable';
    }
    const result = await PermissionsAndroid.request(androidPermission);
    return normalizeResult(result);
  },

  async openSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }
    await Linking.openSettings();
    return true;
  },
};
