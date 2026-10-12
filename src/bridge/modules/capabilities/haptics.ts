/**
 * haptics 桥接模块：触觉反馈（冲击/通知/选择）。
 */
import type { BridgeServer } from '../../bridge-server';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerHapticsModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('haptics', {
    async impact(params) {
      const p = params as { style?: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' } | undefined;
      const style = p?.style ?? 'medium';
      const adapter = requireAdapter(adapters.haptics, 'haptics');
      await adapter.impact(style);
      return { ok: true };
    },

    async notification(params) {
      const p = params as { type?: 'success' | 'warning' | 'error' } | undefined;
      const type = p?.type ?? 'success';
      const adapter = requireAdapter(adapters.haptics, 'haptics');
      await adapter.notification(type);
      return { ok: true };
    },

    async selection() {
      const adapter = requireAdapter(adapters.haptics, 'haptics');
      await adapter.selection();
      return { ok: true };
    },
  });
}
