/**
 * biometric 桥接模块：生物识别（指纹/面容/虹膜）。
 */
import type { BridgeServer } from '../../bridge-server';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerBiometricModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('biometric', {
    async isAvailable() {
      const adapter = requireAdapter(adapters.biometric, 'biometric');
      return adapter.isAvailable();
    },

    async authenticate(params) {
      const p = params as
        | {
            promptMessage?: string;
            cancelButtonText?: string;
            fallbackLabel?: string;
            requireConfirmation?: boolean;
          }
        | undefined;
      const adapter = requireAdapter(adapters.biometric, 'biometric');
      return adapter.authenticate({
        promptMessage: p?.promptMessage,
        cancelButtonText: p?.cancelButtonText,
        fallbackLabel: p?.fallbackLabel,
        requireConfirmation: p?.requireConfirmation,
      });
    },
  });
}
