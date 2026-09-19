/**
 * device 桥接模块：设备信息扩展（唯一ID/应用版本/构建号/渠道/首次安装时间等）。
 *
 * 纯 RN 可获取的信息直接返回；需原生的信息通过 adapter 注入。
 */
import { Platform } from 'react-native';
import type { BridgeServer } from '../bridge-server';
import { APP_VERSION } from '../../config';
import { BridgeException } from '../bridge-error';

export type DeviceAdapters = {
  getUniqueId?: () => Promise<string>;
  getBuildNumber?: () => Promise<string>;
  getChannel?: () => Promise<string>;
  getFirstInstallTime?: () => Promise<number>;
  getLastUpdateTime?: () => Promise<number>;
  getAppName?: () => Promise<string>;
  getBundleId?: () => Promise<string>;
};

export function registerDeviceModule(server: BridgeServer, adapters: DeviceAdapters = {}): void {
  server.registerModule('device', {
    /** 获取设备唯一 ID（需原生）。 */
    async getUniqueId() {
      if (!adapters.getUniqueId) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getUniqueId 未接入');
      }
      const id = await adapters.getUniqueId();
      return { uniqueId: id };
    },

    /** 获取应用版本号（与 version.json 同步）。 */
    getVersion() {
      return { version: APP_VERSION };
    },

    /** 获取构建号（需原生）。 */
    async getBuildNumber() {
      if (!adapters.getBuildNumber) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getBuildNumber 未接入');
      }
      const build = await adapters.getBuildNumber();
      return { buildNumber: build };
    },

    /** 获取应用渠道（需原生）。 */
    async getChannel() {
      if (!adapters.getChannel) {
        return { channel: 'default' };
      }
      const channel = await adapters.getChannel();
      return { channel };
    },

    /** 获取首次安装时间戳（需原生）。 */
    async getFirstInstallTime() {
      if (!adapters.getFirstInstallTime) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getFirstInstallTime 未接入');
      }
      const time = await adapters.getFirstInstallTime();
      return { firstInstallTime: time };
    },

    /** 获取最近更新时间戳（需原生）。 */
    async getLastUpdateTime() {
      if (!adapters.getLastUpdateTime) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getLastUpdateTime 未接入');
      }
      const time = await adapters.getLastUpdateTime();
      return { lastUpdateTime: time };
    },

    /** 获取应用名称（需原生）。 */
    async getAppName() {
      if (!adapters.getAppName) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getAppName 未接入');
      }
      const name = await adapters.getAppName();
      return { appName: name };
    },

    /** 获取包名/Bundle ID（需原生）。 */
    async getBundleId() {
      if (!adapters.getBundleId) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getBundleId 未接入');
      }
      const id = await adapters.getBundleId();
      return { bundleId: id };
    },

    /** 获取平台信息。 */
    getPlatform() {
      return {
        os: Platform.OS,
        version: String(Platform.Version),
        isTV: Platform.isTV,
        isTesting: __DEV__,
      };
    },
  });
}
