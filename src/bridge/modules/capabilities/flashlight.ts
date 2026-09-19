/**
 * flashlight 桥接模块：手电筒控制。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerFlashlightModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('flashlight', {
    async isAvailable() {
      const adapter = requireAdapter(adapters.flashlight, 'flashlight');
      return adapter.isAvailable();
    },

    async toggle(params) {
      const p = params as { enabled?: boolean } | undefined;
      if (typeof p?.enabled !== 'boolean') {
        throw new BridgeException('INVALID_PARAMS', 'enabled 必须是布尔值');
      }
      const adapter = requireAdapter(adapters.flashlight, 'flashlight');
      return adapter.toggle(p.enabled);
    },
  });
}
