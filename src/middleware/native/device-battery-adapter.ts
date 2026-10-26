/**
 * device / battery 原生适配器（RN 侧）。
 *
 * 为什么单独一个文件：`device` / `battery` 两个桥模块在 src/bridge/index.ts 里注册时
 * 一直没传 adapters，结果是「注册了但每台设备都报 DEVICE_UNSUPPORTED」——
 * 而其中一半能力其实已经有真值可取（version.json 的包名/构建号、BaseSystem 的电量），
 * 另一半才真的等原生实现。这里把两条分清楚：JS 侧能给的直接给，给不了的显式留空，
 * 由 __tests__/bridge/device-battery-wiring.test.ts 断言「哪些必须成功、哪些是已知缺口」，
 * 以后再接入原生能力必须同步动那张缺口表，不会再静默退化。
 */
import { NativeModules } from 'react-native';
import type { BatteryAdapters, BatteryInfo } from '../../bridge/modules/battery';
import type { DeviceAdapters } from '../../bridge/modules/device';
import { APP_BUILD_NUMBER, APP_NAME, APP_PACKAGE } from '../../config';

/** BaseSystem.getDeviceInfo 里本适配器用到的字段。 */
type BaseSystemDeviceInfo = {
  batteryLevel: number;
  isCharging: boolean;
};

/** BaseSystem.getInstallInfo 的返回；原生未实现时该方法是 undefined。 */
type BaseSystemInstallInfo = {
  uniqueId: string;
  firstInstallTime: number;
  lastUpdateTime: number;
};

type BaseSystemNative = {
  getDeviceInfo?: () => Promise<BaseSystemDeviceInfo>;
  getInstallInfo?: () => Promise<BaseSystemInstallInfo>;
};

function baseSystem(): BaseSystemNative | undefined {
  return (NativeModules as Record<string, unknown>).BaseSystem as BaseSystemNative | undefined;
}

/** 电池信息：原生只给电量/充电状态，健康度/温度/电压不在基座的能力面内。 */
export function resolveNativeBatteryAdapter(): BatteryAdapters {
  const nativeModule = baseSystem();
  if (!nativeModule?.getDeviceInfo) {
    return {};
  }
  return {
    getBatteryInfo: async (): Promise<BatteryInfo> => {
      const info = await nativeModule.getDeviceInfo!();
      // 原生读不到电量时回 -1（BaseSystemModule.kt 的失败分支）。夹成 0 会让 H5 显示
      // 「电量耗尽」，是造出来的读数；这里按同仓 system.getBattery 的既有约定回 null。
      return {
        level: info.batteryLevel >= 0 ? info.batteryLevel : null,
        isCharging: Boolean(info.isCharging),
      };
    },
  };
}

/**
 * 设备信息：
 *  - getAppName / getBundleId / getBuildNumber 的真值来自 version.json（打包时下发），不需要原生；
 *  - getUniqueId / getFirstInstallTime / getLastUpdateTime 依赖 BaseSystem.getInstallInfo，
 *    安卓已实现，iOS / 鸿蒙暂未实现 —— 未实现时保持 DEVICE_UNSUPPORTED，而不是编一个假 ID。
 */
export function resolveNativeDeviceAdapter(): DeviceAdapters {
  const nativeModule = baseSystem();
  const adapters: DeviceAdapters = {
    getAppName: async () => APP_NAME,
    getBundleId: async () => APP_PACKAGE,
    getBuildNumber: async () => APP_BUILD_NUMBER,
  };

  if (nativeModule?.getInstallInfo) {
    const installInfo = () => nativeModule.getInstallInfo!();
    adapters.getUniqueId = async () => (await installInfo()).uniqueId;
    adapters.getFirstInstallTime = async () => (await installInfo()).firstInstallTime;
    adapters.getLastUpdateTime = async () => (await installInfo()).lastUpdateTime;
  }

  return adapters;
}
