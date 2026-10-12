/**
 * bluetooth 桥接模块：蓝牙扫描/连接/数据收发。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerBluetoothModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('bluetooth', {
    async isAvailable() {
      const adapter = requireAdapter(adapters.bluetooth, 'bluetooth');
      return adapter.isAvailable();
    },

    async enable() {
      const adapter = requireAdapter(adapters.bluetooth, 'bluetooth');
      if (!adapter.enable) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '蓝牙启用未实现');
      }
      return adapter.enable();
    },

    async startScan(params) {
      const p = params as { serviceUuids?: string[]; timeout?: number } | undefined;
      const adapter = requireAdapter(adapters.bluetooth, 'bluetooth');
      return adapter.startScan({
        serviceUuids: p?.serviceUuids,
        timeout: p?.timeout,
      });
    },

    async stopScan() {
      const adapter = requireAdapter(adapters.bluetooth, 'bluetooth');
      await adapter.stopScan();
      return { ok: true };
    },

    async connect(params) {
      const p = params as { deviceId?: string } | undefined;
      if (!p?.deviceId) {
        throw new BridgeException('INVALID_PARAMS', 'deviceId 不能为空');
      }
      const adapter = requireAdapter(adapters.bluetooth, 'bluetooth');
      return adapter.connect(p.deviceId);
    },

    async disconnect(params) {
      const p = params as { deviceId?: string } | undefined;
      if (!p?.deviceId) {
        throw new BridgeException('INVALID_PARAMS', 'deviceId 不能为空');
      }
      const adapter = requireAdapter(adapters.bluetooth, 'bluetooth');
      await adapter.disconnect(p.deviceId);
      return { ok: true };
    },

    async write(params) {
      const p = params as
        | {
            deviceId: string;
            serviceUuid: string;
            characteristicUuid: string;
            data: string;
          }
        | undefined;
      if (!p?.deviceId || !p?.serviceUuid || !p?.characteristicUuid || !p?.data) {
        throw new BridgeException('INVALID_PARAMS', '参数不完整');
      }
      const adapter = requireAdapter(adapters.bluetooth, 'bluetooth');
      if (!adapter.write) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '蓝牙写入未实现');
      }
      return adapter.write(p.deviceId, p.serviceUuid, p.characteristicUuid, p.data);
    },

    async read(params) {
      const p = params as
        | { deviceId: string; serviceUuid: string; characteristicUuid: string }
        | undefined;
      if (!p?.deviceId || !p?.serviceUuid || !p?.characteristicUuid) {
        throw new BridgeException('INVALID_PARAMS', '参数不完整');
      }
      const adapter = requireAdapter(adapters.bluetooth, 'bluetooth');
      if (!adapter.read) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '蓝牙读取未实现');
      }
      return adapter.read(p.deviceId, p.serviceUuid, p.characteristicUuid);
    },
  });
}
