/**
 * camera 桥接模块（规则21：拍照上传，先经权限层授权）。 */
import type { BridgeServer } from '../../bridge-server';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerCameraModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('camera', {
    async takePhoto() {
      const adapter = requireAdapter(adapters.camera, 'camera');
      return adapter.takePhoto();
    },
  });
}
