/**
 * 鸿蒙权限适配器。
 *
 * RNOH 0.84 没有 `PermissionsAndroid`，但鸿蒙侧的取图/扫码/选图根本不走应用级
 * 运行时权限：Scan Kit、cameraPicker、PhotoViewPicker、DocumentViewPicker 都是
 * 系统控件，权限由控件自己持有（首次用会弹「安全访问相机/图库」）。所以在调用
 * 前替用户点一次授权框是多余的，与 H5 的懒授权口径一致：本适配器的 request 只
 * 回答「这条链路在鸿蒙上能不能走通」。
 *
 * 例外是 location 与 notification：它们确实是应用级权限，弹窗已经内聚在原生方法
 * 里（`ERPCapabilities.getCurrentPosition` 走 `requestPermissionsFromUser`、
 * `sendNotification` 走 `requestEnableNotification`）。这里先放行，用户在真正取值时
 * 才看到系统弹窗；拒绝由原生抛错回给 H5，文案自带「请在设置中开启」。
 *
 * `openSettings` 走 RN 的 `Linking.openSettings()`，由 RNOH 的
 * `LinkingManagerTurboModule` 实现（startAbility 跳到本应用「应用信息」页），
 * 与 Android 行为一致。
 */
import { Linking } from 'react-native';
import type { Permission, PermissionStatus } from '../permissions.types';
import type { PermissionAdapter } from './permission-adapter';

/** 原生能力自带授权（系统控件或方法内弹窗），应用层无需再申请。 */
const HANDLED_BY_NATIVE: Permission[] = [
  'camera',
  'photo',
  'file',
  'location',
  'locationWhenInUse',
  'notification',
];

/**
 * 麦克风回 unavailable：基座在鸿蒙侧没有录音能力，H5 也没有入口。
 * 报 granted 会让上层以为可以录，最后拿到一个更难解释的原生错误。
 */
function statusFor(permission: Permission): PermissionStatus {
  return HANDLED_BY_NATIVE.includes(permission) ? 'granted' : 'unavailable';
}

export const harmonyPermissionAdapter: PermissionAdapter = {
  async check(permission: Permission): Promise<PermissionStatus> {
    return statusFor(permission);
  },

  async request(permission: Permission): Promise<PermissionStatus> {
    return statusFor(permission);
  },

  async openSettings(): Promise<boolean> {
    await Linking.openSettings();
    return true;
  },
};
