/**
 * qr 桥接模块：二维码生成。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerQrModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('qr', {
    async generate(params) {
      const p = params as
        | {
            text: string;
            size?: number;
            margin?: number;
            errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
          }
        | undefined;
      if (!p?.text) {
        throw new BridgeException('INVALID_PARAMS', 'text 不能为空');
      }
      const adapter = requireAdapter(adapters.qr, 'qr');
      return adapter.generate(p.text, {
        size: p.size,
        margin: p.margin,
        errorCorrectionLevel: p.errorCorrectionLevel,
      });
    },
  });
}
