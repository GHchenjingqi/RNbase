/**
 * battery 桥接模块：电池信息（电量/充电状态/电池健康/温度/电压）。
 *
 * 纯 RN 无法直接获取电池信息，需原生 adapter；未接入时返回 DEVICE_UNSUPPORTED。
 */
import type { BridgeServer } from '../bridge-server';
import { BridgeException } from '../bridge-error';

export type BatteryInfo = {
  level: number;
  isCharging: boolean;
  health?: 'good' | 'overheat' | 'dead' | 'overvoltage' | 'unknown';
  temperature?: number;
  voltage?: number;
  technology?: string;
};

export type BatteryAdapters = {
  getBatteryInfo?: () => Promise<BatteryInfo>;
  onBatteryLevelChange?: (callback: (level: number) => void) => () => void;
  onChargingChange?: (callback: (isCharging: boolean) => void) => () => void;
};

export function registerBatteryModule(server: BridgeServer, adapters: BatteryAdapters = {}): void {
  server.registerModule('battery', {
    /** 获取电池信息。 */
    async getInfo() {
      if (!adapters.getBatteryInfo) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'battery 能力未接入');
      }
      return adapters.getBatteryInfo();
    },

    /** 获取电量百分比（0-100）。 */
    async getLevel() {
      if (!adapters.getBatteryInfo) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'battery 能力未接入');
      }
      const info = await adapters.getBatteryInfo();
      return { level: info.level };
    },

    /** 获取充电状态。 */
    async isCharging() {
      if (!adapters.getBatteryInfo) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'battery 能力未接入');
      }
      const info = await adapters.getBatteryInfo();
      return { isCharging: info.isCharging };
    },
  });
}
