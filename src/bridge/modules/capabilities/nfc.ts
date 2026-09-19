/**
 * nfc 桥接模块：NFC 标签读写。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerNfcModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('nfc', {
    async isAvailable() {
      const adapter = requireAdapter(adapters.nfc, 'nfc');
      return adapter.isAvailable();
    },

    async readTag(params) {
      const p = params as { timeout?: number } | undefined;
      const adapter = requireAdapter(adapters.nfc, 'nfc');
      return adapter.readTag(p?.timeout);
    },

    async writeNdef(params) {
      const p = params as { records: { type: string; data: string }[] } | undefined;
      if (!p?.records || !Array.isArray(p.records) || p.records.length === 0) {
        throw new BridgeException('INVALID_PARAMS', 'records 不能为空');
      }
      const adapter = requireAdapter(adapters.nfc, 'nfc');
      if (!adapter.writeNdef) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'NFC 写入未实现');
      }
      return adapter.writeNdef(p.records);
    },
  });
}
