/**
 * toast 桥接模块：原生 Toast 提示（Android）/ 底部提示（iOS）。
 *
 * 纯 RN 实现：Android 用 ToastAndroid，iOS 用 Alert 降级。
 */
import { Alert, Platform, ToastAndroid } from 'react-native';
import type { BridgeServer } from '../bridge-server';

export type ToastDuration = 'short' | 'long';
export type ToastGravity = 'top' | 'center' | 'bottom';

export function registerToastModule(server: BridgeServer): void {
  server.registerModule('toast', {
    show(params) {
      const p = params as
        | { message: string; duration?: ToastDuration; gravity?: ToastGravity }
        | undefined;
      const message = p?.message ?? '';
      const duration = p?.duration === 'long' ? ToastAndroid.LONG : ToastAndroid.SHORT;

      if (Platform.OS === 'android') {
        const gravity =
          p?.gravity === 'top'
            ? ToastAndroid.TOP
            : p?.gravity === 'center'
            ? ToastAndroid.CENTER
            : ToastAndroid.BOTTOM;
        ToastAndroid.showWithGravity(message, duration, gravity);
      } else {
        // iOS 无原生 Toast，用 Alert 降级（仅展示消息）
        Alert.alert('', message);
      }
      return { ok: true };
    },
  });
}
