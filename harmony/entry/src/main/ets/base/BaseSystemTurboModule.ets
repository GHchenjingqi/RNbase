/**
 * 鸿蒙侧 BaseSystem TurboModule：与 Android `BaseSystemModule.kt` 的 `getDeviceInfo`
 * 逐字段对齐（RN 侧契约见 `src/bridge/modules/system.ts` 的 `DeviceInfoResult`）。
 *
 * 全部读取无需权限：deviceInfo / batteryInfo / statvfs / i18n。
 * 单台设备取不到某项时按 Android 的降级语义给哨兵值（电量 -1 / 存储 0），不整条 reject。
 */
import batteryInfo from '@ohos.batteryInfo';
import deviceInfo from '@ohos.deviceInfo';
import i18n from '@ohos.i18n';
import statvfs from '@ohos.file.statvfs';
import type { UITurboModuleContext } from '@rnoh/react-native-openharmony';
import { UITurboModule } from '@rnoh/react-native-openharmony';

export interface BaseDeviceInfoResult {
  brand: string;
  model: string;
  systemVersion: string;
  sdkInt: number;
  batteryLevel: number;
  isCharging: boolean;
  totalStorage: number;
  freeStorage: number;
  timezone: string;
}

export class BaseSystemTurboModule extends UITurboModule {
  public static readonly NAME: string = 'BaseSystem';

  private dataPath: string;

  constructor(ctx: UITurboModuleContext) {
    super(ctx);
    this.dataPath = ctx.uiAbilityContext.filesDir;
  }

  async getDeviceInfo(): Promise<BaseDeviceInfoResult> {
    let batteryLevel: number = -1;
    let isCharging: boolean = false;
    try {
      batteryLevel = batteryInfo.batterySOC;
      isCharging = batteryInfo.chargingStatus === batteryInfo.BatteryChargeState.ENABLE;
    } catch (error) {
      this.ctx.logger.error('[BaseSystem] batteryInfo 读取失败: ' + error);
    }

    let totalStorage: number = 0;
    let freeStorage: number = 0;
    try {
      totalStorage = await statvfs.getTotalSize(this.dataPath);
      freeStorage = await statvfs.getFreeSize(this.dataPath);
    } catch (error) {
      this.ctx.logger.error('[BaseSystem] statvfs 读取失败: ' + error);
    }

    let timezone: string = '';
    try {
      timezone = i18n.getTimeZone().getID();
    } catch (error) {
      this.ctx.logger.error('[BaseSystem] 时区读取失败: ' + error);
    }

    const result: BaseDeviceInfoResult = {
      brand: deviceInfo.brand,
      model: deviceInfo.productModel,
      systemVersion: deviceInfo.osFullName,
      sdkInt: deviceInfo.sdkApiVersion,
      batteryLevel: batteryLevel,
      isCharging: isCharging,
      totalStorage: totalStorage,
      freeStorage: freeStorage,
      timezone: timezone,
    };
    return result;
  }

  /**
   * 退出应用（H5 双击返回的兜底）。RNOH 没实现 RN 核心的 `ExitApp` 模块，
   * JS 侧 `BackHandler.exitApp()` 会抛 `undefined is not a function`，
   * 容器退出统一走这里，见 `src/webview/WebViewBridge.tsx` 的 `exitContainer`。
   */
  async exitApp(): Promise<void> {
    await this.ctx.uiAbilityContext.terminateSelf();
  }
}
