/**
 * location 桥接模块（规则11/50：定位，需经权限层授权）。 */
import type { BridgeServer } from '../../bridge-server';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerLocationModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('location', {
    async getCurrentPosition() {
      const adapter = requireAdapter(adapters.location, 'location');
      return adapter.getCurrentPosition();
    },
  });
}
