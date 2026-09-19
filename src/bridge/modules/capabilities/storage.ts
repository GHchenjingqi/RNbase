/**
 * storage 桥接模块：存储管理（磁盘空间/缓存清理/应用目录）。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerStorageModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('storage', {
    async getDiskInfo() {
      const adapter = requireAdapter(adapters.storage, 'storage');
      return adapter.getDiskInfo();
    },

    async clearCache() {
      const adapter = requireAdapter(adapters.storage, 'storage');
      return adapter.clearCache();
    },

    async getAppDir() {
      const adapter = requireAdapter(adapters.storage, 'storage');
      if (!adapter.getAppDir) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getAppDir 未实现');
      }
      return adapter.getAppDir();
    },
  });
}
