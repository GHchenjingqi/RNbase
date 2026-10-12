/**
 * clipboard 桥接模块：剪贴板读写。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerClipboardModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('clipboard', {
    async getString() {
      const adapter = requireAdapter(adapters.clipboard, 'clipboard');
      return adapter.getString();
    },

    async setString(params) {
      const p = params as { text?: string } | undefined;
      if (!p?.text) {
        throw new BridgeException('INVALID_PARAMS', 'text 不能为空');
      }
      const adapter = requireAdapter(adapters.clipboard, 'clipboard');
      return adapter.setString(p.text);
    },

    async hasString() {
      const adapter = requireAdapter(adapters.clipboard, 'clipboard');
      if (!adapter.hasString) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'hasString 未实现');
      }
      return adapter.hasString();
    },
  });
}
