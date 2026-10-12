/**
 * brightness 桥接模块：屏幕亮度控制。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerBrightnessModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('brightness', {
    async getBrightness() {
      const adapter = requireAdapter(adapters.brightness, 'brightness');
      return adapter.getBrightness();
    },

    async setBrightness(params) {
      const p = params as { brightness?: number } | undefined;
      if (typeof p?.brightness !== 'number' || p.brightness < 0 || p.brightness > 1) {
        throw new BridgeException('INVALID_PARAMS', 'brightness 必须是 0-1 之间的数字');
      }
      const adapter = requireAdapter(adapters.brightness, 'brightness');
      return adapter.setBrightness(p.brightness);
    },

    async getSystemBrightness() {
      const adapter = requireAdapter(adapters.brightness, 'brightness');
      if (!adapter.getSystemBrightness) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getSystemBrightness 未实现');
      }
      return adapter.getSystemBrightness();
    },
  });
}
