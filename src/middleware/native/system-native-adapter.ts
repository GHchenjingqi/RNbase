/**
 * 原生系统信息适配器（RN 侧，规则 13/51）：将 SYSTEM 模块对接到原生模块
 * `NativeModules.BaseSystem`。原生未链接时安全降级为空（模块返回
 * DEVICE_UNSUPPORTED），不抛出、不影响 App 启动。
 *
 * copy 优先走 `BaseCapabilities.clipboardSetString`（安卓与鸿蒙都实现了它），
 * 没有该原生方法时才退回 RN 自带的 Clipboard API；
 * share 直接用 RN 自带 Share API（安卓 = Activity chooser，鸿蒙 = RNOH 的
 * `ShareTurboModule`，两边都有实现，不必再走自研模块）。
 */
import { Clipboard, Share } from 'react-native';
import { NativeModules } from 'react-native';
import type { DeviceInfoResult, SystemAdapters } from '../../bridge/modules/system';

export interface BaseSystemNative {
  getDeviceInfo(): Promise<DeviceInfoResult>;
}

/** BaseCapabilities 里与剪贴板有关的部分（只声明本文件用到的方法）。 */
type BaseClipboardNative = {
  clipboardSetString?(text: string): Promise<{ ok: boolean }>;
};

export function resolveNativeSystemAdapter(): SystemAdapters {
  const nativeModule = (NativeModules as Record<string, unknown>).BaseSystem as
    | BaseSystemNative
    | undefined;
  const capabilities = (NativeModules as Record<string, unknown>).BaseCapabilities as
    | BaseClipboardNative
    | undefined;

  const adapters: SystemAdapters = {};

  if (nativeModule) {
    adapters.deviceInfo = () => nativeModule.getDeviceInfo();
  }

  /**
   * 复制文本到剪贴板。
   * 安卓 10+ 后台写入剪贴板有限制，但前台 H5 调用不受影响。
   * RN 的 Clipboard 在鸿蒙上不保证有实现（RNOH 未列进核心模块清单的那几个会回
   * undefined），所以只要有自研 clipboardSetString 就用它，失败再退 RN。
   */
  adapters.copy = async (text: string) => {
    try {
      if (capabilities?.clipboardSetString) {
        const r = await capabilities.clipboardSetString(text);
        return Boolean(r?.ok);
      }
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
