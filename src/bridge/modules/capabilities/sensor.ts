/**
 * sensor 桥接模块：传感器数据（加速度计/陀螺仪/磁力计/气压计/计步器等）。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter, type SensorType } from './types';

const activeSubscriptions = new Map<string, () => void>();

export function registerSensorModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('sensor', {
    async isAvailable(params) {
      const p = params as { type?: SensorType } | undefined;
      if (!p?.type) {
        throw new BridgeException('INVALID_PARAMS', 'type 不能为空');
      }
      const adapter = requireAdapter(adapters.sensor, 'sensor');
      return adapter.isAvailable(p.type);
    },

    async start(params) {
      const p = params as
        | {
            type: SensorType;
            interval?: 'fastest' | 'game' | 'ui' | 'normal';
          }
        | undefined;
      if (!p?.type) {
        throw new BridgeException('INVALID_PARAMS', 'type 不能为空');
      }
      const adapter = requireAdapter(adapters.sensor, 'sensor');
      const result = await adapter.start(
        p.type,
        data => {
          server.emitEvent(`sensor.${p.type}`, data);
        },
        { interval: p.interval },
      );
      activeSubscriptions.set(result.subscriptionId, () => {
        adapter.stop(result.subscriptionId).catch(() => {});
      });
      return result;
    },

    async stop(params) {
      const p = params as { subscriptionId?: string } | undefined;
      if (!p?.subscriptionId) {
        throw new BridgeException('INVALID_PARAMS', 'subscriptionId 不能为空');
      }
      const cleanup = activeSubscriptions.get(p.subscriptionId);
      if (cleanup) {
        cleanup();
        activeSubscriptions.delete(p.subscriptionId);
      }
      return { ok: true };
    },

    async getStepCount() {
      const adapter = requireAdapter(adapters.sensor, 'sensor');
      if (!adapter.getStepCount) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '计步器未实现');
      }
      return adapter.getStepCount();
    },
  });
}
