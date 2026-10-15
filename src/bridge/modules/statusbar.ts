/**
 * statusbar 桥接模块：状态栏控制（样式/隐藏/背景色/网络活动指示器）。
 *
 * 纯 RN 实现：StatusBar API。
 */
import { StatusBar, Platform } from 'react-native';
import type { BridgeServer } from '../bridge-server';
import { BridgeException } from '../bridge-error';

export type BarStyle = 'default' | 'light-content' | 'dark-content';

/**
 * H5 经 Bridge 接管的 barStyle（未接管为 null）。
 * 组合根（App.tsx）的声明式 <StatusBar barStyle> 会在深浅色切换等重渲染时重新生效，
 * 会把 H5 设置的样式冲回默认 —— 这里记录接管状态，组合根据此决定是否还按系统值覆盖。
 */
let h5BarStyleOverride: BarStyle | null = null;
let h5BarStyleListener: ((style: BarStyle) => void) | null = null;

/** 组合根注册监听：H5 每次接管 barStyle 时收到通知（返回清理函数语义由调用方处理）。 */
export function setH5BarStyleListener(cb: ((style: BarStyle) => void) | null): void {
  h5BarStyleListener = cb;
}

/** 当前 H5 接管的 barStyle；未接管为 null（组合根按系统深浅色渲染）。 */
export function getH5BarStyleOverride(): BarStyle | null {
  return h5BarStyleOverride;
}

export function registerStatusBarModule(server: BridgeServer): void {
  server.registerModule('statusBar', {
    /** 设置状态栏样式：default（黑字）/ light-content（白字）。 */
    setBarStyle(params) {
      const p = params as { style?: BarStyle } | undefined;
      const style = p?.style ?? 'default';
      StatusBar.setBarStyle(style, true);
      h5BarStyleOverride = style;
      h5BarStyleListener?.(style);
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
