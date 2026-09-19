/**
 * 原生系统信息适配器（RN 侧，规则 13/51）：将 SYSTEM 模块对接到原生模块
 * `NativeModules.ERPSystem`。原生未链接时安全降级为空（模块返回
 * DEVICE_UNSUPPORTED），不抛出、不影响 App 启动。
 *
 * copy / share 不依赖原生模块，直接用 RN 自带的 Clipboard / Share API 实现。
 */
import { Clipboard, Share } from 'react-native';
import { NativeModules } from 'react-native';
import type { DeviceInfoResult, SystemAdapters } from '../../bridge/modules/system';

export interface ERPSystemNative {
  getDeviceInfo(): Promise<DeviceInfoResult>;
}

export function resolveNativeSystemAdapter(): SystemAdapters {
  const nativeModule = (NativeModules as Record<string, unknown>).ERPSystem as
    | ERPSystemNative
    | undefined;

  const adapters: SystemAdapters = {};

  if (nativeModule) {
    adapters.deviceInfo = () => nativeModule.getDeviceInfo();
  }

  /**
   * 复制文本到剪贴板（RN 自带 Clipboard API，跨平台可用）。
   * 安卓 10+ 后台写入剪贴板有限制，但前台 H5 调用不受影响。
   */
  adapters.copy = async (text: string) => {
    try {
      await Clipboard.setString(text);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * 调用系统分享面板（RN 自带 Share API，跨平台可用）。
   * 分享内容优先 text，url 作为附加链接。
   */
  adapters.share = async (options: { title?: string; text?: string; url?: string }) => {
    try {
      const result = await Share.share(
        {
          message: options.text ?? '',
          url: options.url,
          title: options.title ?? '分享',
        },
        {
          dialogTitle: options.title ?? '分享',
        },
      );
      return result.action === Share.sharedAction;
    } catch {
      return false;
    }
  };

  return adapters;
}
