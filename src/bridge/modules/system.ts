/**
 * system 桥接模块（Phase 5 / 规范 §12）。
 *
 * 系统级能力分两类：
 *  1. 纯 RN 可直接获取的系统状态：
 *     - getDarkMode / getLanguage / getScreenInfo / getAccessibility / getInfo
 *  2. 需原生实现的系统信息（ERPSystem 模块）：
 *     - getDeviceInfo（品牌/型号/系统版本/电量/存储/时区）
 *     - getBattery（电量/充电状态）
 *
 * 原生未接入时返回 DEVICE_UNSUPPORTED（规范 §13/§16）。
 * 深色模式切换通过事件 system.darkmodechange 推送给 H5。
 *
 * H5 调用：
 *   RN.SYSTEM.GETDARKMODE()        -> { mode: 'dark'|'light'|'system' }
 *   RN.SYSTEM.GETLANGUAGE()        -> { language, locale }
 *   RN.SYSTEM.GETSCREENINFO()      -> { width, height, scale, fontScale }
 *   RN.SYSTEM.GETACCESSIBILITY()   -> { screenReader, reduceMotion, boldText, invertColors }
 *   RN.SYSTEM.GETINFO()            -> 汇总（含原生 device 信息，可选）
 *   RN.SYSTEM.GETDEVICEINFO()      -> { brand, model, systemVersion, ... }
 *   RN.SYSTEM.GETBATTERY()         -> { level, isCharging }
 *   RN.SYSTEM.VIBRATE/COPY/SHARE   -> 原能力
 */
import {
  AccessibilityInfo,
  Appearance,
  Dimensions,
  I18nManager,
  NativeModules,
  PixelRatio,
  Platform,
  Vibration,
} from 'react-native';
import { BridgeException } from '../bridge-error';
import type { BridgeServer } from '../bridge-server';
import { bridgeEventBus } from '../event-bus';

export type DeviceInfoResult = {
  brand: string;
  model: string;
  systemVersion: string;
  sdkInt: number;
  batteryLevel: number;
  isCharging: boolean;
  totalStorage: number;
  freeStorage: number;
  timezone: string;
};

export type SystemAdapters = {
  copy?: (text: string) => Promise<boolean>;
  share?: (options: { title?: string; text?: string; url?: string }) => Promise<boolean>;
  deviceInfo?: () => Promise<DeviceInfoResult>;
};

/**
 * 顶部安全区 inset（dp）模块级缓存。
 * Android 15+（targetSdk 35+）强制 edge-to-edge，StatusBar.currentHeight 已废弃并返回 0；
 * 真实值由 WebViewBridge 在渲染时用 useSafeAreaInsets()（WindowInsets）写入。
 */
let lastStatusBarInset = 0;
export function setStatusBarInset(top: number): void {
  lastStatusBarInset = top;
}

export type DarkMode = 'dark' | 'light' | 'system';

function getDarkModeValue(): DarkMode {
  const scheme = Appearance.getColorScheme();
  return scheme === 'dark' || scheme === 'light' ? scheme : 'system';
}

function getLanguageInfo(): { language: string; locale: string } {
  const i18n = I18nManager.getConstants() as { localeIdentifier?: string };
  const settings = (
    NativeModules.SettingsManager as
      | { settings?: { AppleLocale?: string; Locale?: string } }
      | undefined
  )?.settings;
  const locale = i18n.localeIdentifier ?? settings?.AppleLocale ?? settings?.Locale ?? '';
  const language = locale.split(/[-_]/)[0] || '';
  return { language, locale };
}

function getScreenInfo() {
  const { width, height } = Dimensions.get('window');
  return {
    width,
    height,
    scale: PixelRatio.get(),
    fontScale: PixelRatio.getFontScale(),
  };
}

async function getAccessibilityInfo() {
  const [screenReader, reduceMotion, boldText, invertColors] = await Promise.all([
    AccessibilityInfo.isScreenReaderEnabled(),
    AccessibilityInfo.isReduceMotionEnabled(),
    AccessibilityInfo.isBoldTextEnabled(),
    AccessibilityInfo.isInvertColorsEnabled(),
  ]);
  return { screenReader, reduceMotion, boldText, invertColors };
}

/** 深色模式切换监听：全局单例只注册一次，事件发到全局事件总线。 */
let darkModeListenerInstalled = false;
function installDarkModeListener(): void {
  if (darkModeListenerInstalled) {
    return;
  }
  darkModeListenerInstalled = true;
  Appearance.addChangeListener(({ colorScheme }) => {
    bridgeEventBus.emit('system.darkmodechange', {
      mode: colorScheme === 'dark' || colorScheme === 'light' ? colorScheme : 'system',
    });
  });
}

export function registerSystemModule(server: BridgeServer, adapters: SystemAdapters = {}): void {
  installDarkModeListener();

  server.registerModule('system', {
    vibrate(params) {
      const p = params as { duration?: number } | undefined;
      const duration = p?.duration ?? 200;
      // RN Vibration 是跨平台 API，iOS 只支持固定震动时长
      Vibration.vibrate(duration);
      return { ok: true };
    },

    async copy(params) {
      const p = params as { text?: string } | undefined;
      if (!p?.text) {
        throw new BridgeException('INVALID_PARAMS', 'text 不能为空');
      }
      if (!adapters.copy) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '剪贴板能力未接入');
      }
      const ok = await adapters.copy(p.text);
      return { ok };
    },

    async share(params) {
      const p = params as { title?: string; text?: string; url?: string } | undefined;
      if (!p?.text && !p?.url) {
        throw new BridgeException('INVALID_PARAMS', 'text 和 url 不能同时为空');
      }
      if (!adapters.share) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '分享能力未接入');
      }
      const ok = await adapters.share({
        title: p.title,
        text: p.text,
        url: p.url,
      });
      return { ok };
    },

    /** 当前深色模式：dark | light | system（跟随系统时返回 system）。 */
    getDarkMode() {
      return { mode: getDarkModeValue() };
    },

    /** 系统语言与区域。 */
    getLanguage() {
      return getLanguageInfo();
    },

    /** 屏幕尺寸 / 缩放 / 字体缩放。 */
    getScreenInfo() {
      return getScreenInfo();
    },

    /**
     * 手机顶部状态栏高度（dp）。
     * - Android：返回 WebViewBridge 注入的真实安全区顶部 inset（edge-to-edge 下
     *   StatusBar.currentHeight 已废弃返回 0，改用 WindowInsets，含刘海屏 cutout）；
     * - 未注入 / 读取不到：返回 0，H5 应回退到 CSS env(safe-area-inset-top) 或默认值。
     */
    getStatusBarHeight() {
      return { statusBarHeight: lastStatusBarInset };
    },

    /**
     * 当前运行平台：android | ios | windows | macos | web。
     * 取自 RN Platform.OS（原生确定值），比 H5 侧 UA 判断更准确。
     * H5 调用：RN.SYSTEM.GETPLATFORM() -> { os: 'android' }
     */
    getPlatform() {
      return { os: Platform.OS };
    },

    /** 无障碍状态（读屏 / 减少动态 / 粗体 / 反转颜色）。 */
    async getAccessibility() {
      return getAccessibilityInfo();
    },

    /** 汇总系统信息（原生 device 信息可选，缺失时省略）。 */
    async getInfo() {
      const [accessibility, device] = await Promise.all([
        getAccessibilityInfo(),
        adapters.deviceInfo ? adapters.deviceInfo().catch(() => null) : Promise.resolve(null),
      ]);
      return {
        os: Platform.OS,
        systemVersion: Platform.Version,
        darkMode: getDarkModeValue(),
        ...getLanguageInfo(),
        screen: getScreenInfo(),
        accessibility,
        ...(device ? { device } : {}),
      };
    },

    /** 设备信息（品牌/型号/系统版本/电量/存储/时区，需原生 ERPSystem）。 */
    async getDeviceInfo() {
      if (!adapters.deviceInfo) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '设备信息能力未接入');
      }
      return adapters.deviceInfo();
    },

    /** 电量与充电状态（需原生 ERPSystem）。 */
    async getBattery() {
      if (!adapters.deviceInfo) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '电量能力未接入');
      }
      const info = await adapters.deviceInfo();
      return {
        level: info.batteryLevel >= 0 ? info.batteryLevel : null,
        isCharging: info.isCharging,
      };
    },
  });
}
