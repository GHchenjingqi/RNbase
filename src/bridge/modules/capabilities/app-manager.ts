/**
 * app-manager 桥接模块：应用管理（检测安装/打开/应用市场/应用设置/已安装列表）。
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
      return adapter.isInstalled(p.packageName);
    },

    async openApp(params) {
      const p = params as { packageName: string; data?: string } | undefined;
      if (!p?.packageName) {
        throw new BridgeException('INVALID_PARAMS', 'packageName 不能为空');
      }
      const adapter = requireAdapter(adapters.appManager, 'appManager');
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

    async getInstalledApps() {
      const adapter = requireAdapter(adapters.appManager, 'appManager');
      if (!adapter.getInstalledApps) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getInstalledApps 未实现');
      }
      return adapter.getInstalledApps();
    },
  });
}
