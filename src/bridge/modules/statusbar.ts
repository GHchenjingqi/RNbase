/**
 * statusbar 桥接模块：状态栏控制（样式/隐藏/背景色/网络活动指示器）。
 *
 * 纯 RN 实现：StatusBar API。
 */
import { StatusBar, Platform } from 'react-native';
import type { BridgeServer } from '../bridge-server';
import { BridgeException } from '../bridge-error';

export function registerStatusBarModule(server: BridgeServer): void {
  server.registerModule('statusBar', {
    /** 设置状态栏样式：default（黑字）/ light-content（白字）。 */
    setBarStyle(params) {
      const p = params as { style?: 'default' | 'light-content' | 'dark-content' } | undefined;
      const style = p?.style ?? 'default';
      StatusBar.setBarStyle(style as 'default' | 'light-content' | 'dark-content', true);
      return { ok: true };
    },

    /** 隐藏/显示状态栏。 */
    setHidden(params) {
      const p = params as { hidden?: boolean; animation?: 'none' | 'fade' | 'slide' } | undefined;
      StatusBar.setHidden(p?.hidden ?? false, p?.animation ?? 'fade');
      return { ok: true };
    },

    /** 设置状态栏背景色（仅 Android）。 */
    setBackgroundColor(params) {
      const p = params as { color?: string; animated?: boolean } | undefined;
      if (!p?.color) {
        throw new BridgeException('INVALID_PARAMS', 'color 不能为空');
      }
      if (Platform.OS === 'android') {
        (
          StatusBar as unknown as {
            setBackgroundColor: (color: string, animated?: boolean) => void;
          }
        ).setBackgroundColor(p.color, p?.animated ?? true);
        return { ok: true };
      }
      throw new BridgeException('DEVICE_UNSUPPORTED', 'iOS 不支持设置状态栏背景色');
    },

    /** 设置网络活动指示器可见性（仅 iOS）。 */
    setNetworkActivityIndicatorVisible(params) {
      const p = params as { visible?: boolean } | undefined;
      if (Platform.OS === 'ios') {
        (
          StatusBar as unknown as {
            setNetworkActivityIndicatorVisible: (visible: boolean) => void;
          }
        ).setNetworkActivityIndicatorVisible(p?.visible ?? false);
        return { ok: true };
      }
      throw new BridgeException('DEVICE_UNSUPPORTED', 'Android 不支持网络活动指示器');
    },

    /** 获取当前状态栏高度。 */
    getHeight() {
      return { height: StatusBar.currentHeight ?? 0 };
    },
  });
}
