/**
 * network-info 桥接模块：网络详细信息（WiFi/蜂窝/IP）。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerNetworkInfoModule(
  server: BridgeServer,
  adapters: CapabilityAdapters,
): void {
  server.registerModule('networkInfo', {
    async getWifiInfo() {
      const adapter = requireAdapter(adapters.networkInfo, 'networkInfo');
      return adapter.getWifiInfo();
    },

    async getCellularInfo() {
      const adapter = requireAdapter(adapters.networkInfo, 'networkInfo');
      if (!adapter.getCellularInfo) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '蜂窝信息未实现');
      }
      return adapter.getCellularInfo();
    },

    async getIpAddress(params) {
      const p = params as { type?: 'ipv4' | 'ipv6' } | undefined;
      const adapter = requireAdapter(adapters.networkInfo, 'networkInfo');
      if (!adapter.getIpAddress) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'IP 获取未实现');
      }
      return adapter.getIpAddress(p?.type);
    },
  });
}
