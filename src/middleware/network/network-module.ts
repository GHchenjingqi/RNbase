/**
 * network 桥接模块（规则 46）：获取网络状态。
 *
 * 未注入 adapter 且原生未链接时返回 DEVICE_UNSUPPORTED（规则 13/16）。
 */
import { BridgeException } from '../../bridge/bridge-error';
import type { BridgeServer } from '../../bridge/bridge-server';
import type { NetworkAdapter } from './types';

export function registerNetworkModule(server: BridgeServer, adapter?: NetworkAdapter): void {
  server.registerModule('network', {
    async getStatus() {
      if (!adapter) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'network 能力未接入');
      }
      return adapter.getStatus();
    },
  });
}
