/**
 * in-app-review 桥接模块：应用内评价。
 */
import type { BridgeServer } from '../../bridge-server';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerInAppReviewModule(
  server: BridgeServer,
  adapters: CapabilityAdapters,
): void {
  server.registerModule('inAppReview', {
    async requestReview() {
      const adapter = requireAdapter(adapters.inAppReview, 'inAppReview');
      return adapter.requestReview();
    },
  });
}
