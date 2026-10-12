/**
 * scanner 桥接模块（规则 20：扫码，需处理授权/拒绝/取消等，详见权限层）。
 */
import type { BridgeServer } from '../../bridge-server';
import { CapabilityAdapters, requireAdapter } from './types';

export interface ScanOptions {
  /** 期望识别的码格式列表，如 ['CODE_128', 'EAN_13']；不传或空数组表示自动识别所有格式 */
  formats?: string[];
}

export function registerScannerModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('scanner', {
    async scan(params) {
      const adapter = requireAdapter(adapters.scanner, 'scanner');
      const opts = params as ScanOptions | undefined;
      return adapter.scan(opts);
    },
  });
}
