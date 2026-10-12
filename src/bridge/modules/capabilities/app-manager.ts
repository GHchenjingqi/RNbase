/**
 * app-manager 桥接模块：应用管理（检测安装/打开/应用市场/应用设置/系统设置分区/已安装列表）。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerAppManagerModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('appManager', {
    async isInstalled(params) {
      const p = params as { packageName?: string } | undefined;
      if (!p?.packageName) {
        throw new BridgeException('INVALID_PARAMS', 'packageName 不能为空');
      }
      const adapter = requireAdapter(adapters.appManager, 'appManager');
      if (!adapter.isInstalled) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'isInstalled 未实现');
      }
      return adapter.isInstalled(p.packageName);
    },

    async openApp(params) {
      const p = params as { packageName: string; data?: string } | undefined;
      if (!p?.packageName) {
        throw new BridgeException('INVALID_PARAMS', 'packageName 不能为空');
      }
      const adapter = requireAdapter(adapters.appManager, 'appManager');
      if (!adapter.openApp) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'openApp 未实现');
      }
      return adapter.openApp(p.packageName, { data: p.data });
    },

    async openAppStore(params) {
      const p = params as { appId?: string } | undefined;
      const adapter = requireAdapter(adapters.appManager, 'appManager');
      if (!adapter.openAppStore) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'openAppStore 未实现');
      }
      return adapter.openAppStore(p?.appId);
    },

    async openAppSettings() {
      const adapter = requireAdapter(adapters.appManager, 'appManager');
      if (!adapter.openAppSettings) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'openAppSettings 未实现');
      }
      return adapter.openAppSettings();
    },

    /** 跳转系统设置分区；action 不传回设置首页（取值见 AppManagerAdapter.openSystemSettings）。 */
    async openSystemSettings(params) {
      const p = params as { action?: string } | undefined;
      const adapter = requireAdapter(adapters.appManager, 'appManager');
      if (!adapter.openSystemSettings) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'openSystemSettings 未实现');
      }
      return adapter.openSystemSettings(p?.action);
    },

    async getInstalledApps() {
      const adapter = requireAdapter(adapters.appManager, 'appManager');
      if (!adapter.getInstalledApps) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getInstalledApps 未实现');
      }
      return adapter.getInstalledApps();
    },
  });
}
