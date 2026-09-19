/**
 * media 桥接模块（规则21：相册选图 / 保存图片，先经权限层授权）。 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerMediaModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('media', {
    async pickImage(params) {
      const adapter = requireAdapter(adapters.media, 'media');
      const p = params as { multiple?: boolean } | undefined;
      return adapter.pickImage(p);
    },
    async saveImage(params) {
      const adapter = requireAdapter(adapters.media, 'media');
      const p = params as { uri: string } | undefined;
      if (!p?.uri) {
        throw new BridgeException('INVALID_PARAMS', 'uri 不能为空');
      }
      return adapter.saveImage(p.uri);
    },
  });
}
