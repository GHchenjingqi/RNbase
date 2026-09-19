/**
 * orientation 桥接模块：屏幕方向控制与查询。
 *
 * 纯 RN 实现：Dimensions 查询；方向锁定需原生支持（未接入时返回 DEVICE_UNSUPPORTED）。
 */
import { Dimensions, Platform } from 'react-native';
import type { BridgeServer } from '../bridge-server';
import { BridgeException } from '../bridge-error';

export type Orientation =
  | 'portrait'
  | 'landscape'
  | 'portrait-upside-down'
  | 'landscape-left'
  | 'landscape-right';

function getCurrentOrientation(): Orientation {
  const { width, height } = Dimensions.get('screen');
  return height >= width ? 'portrait' : 'landscape';
}

export function registerOrientationModule(server: BridgeServer): void {
  server.registerModule('orientation', {
    /** 获取当前屏幕方向。 */
    getOrientation() {
      return { orientation: getCurrentOrientation() };
    },

    /** 锁定屏幕方向（需原生支持，未接入时返回 DEVICE_UNSUPPORTED）。 */
    lockTo(params) {
      const p = params as { orientation?: Orientation } | undefined;
      if (!p?.orientation) {
        throw new BridgeException('INVALID_PARAMS', 'orientation 不能为空');
      }
      // RN 核心不支持方向锁定，需原生模块（如 react-native-orientation-locker）
      throw new BridgeException(
        'DEVICE_UNSUPPORTED',
        '方向锁定需原生模块支持（如 react-native-orientation-locker）',
      );
    },

    /** 解除方向锁定。 */
    unlockAll() {
      throw new BridgeException(
        'DEVICE_UNSUPPORTED',
        '方向锁定需原生模块支持（如 react-native-orientation-locker）',
      );
    },

    /** 获取屏幕尺寸（物理像素）。 */
    getScreenSize() {
      const { width, height, scale } = Dimensions.get('screen');
      return {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        scale,
        orientation: getCurrentOrientation(),
      };
    },

    /** 平台信息。 */
    getPlatform() {
      return { os: Platform.OS, version: String(Platform.Version) };
    },
  });
}
