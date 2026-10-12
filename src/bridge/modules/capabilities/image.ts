/**
 * image 桥接模块：图片处理（压缩/裁剪/尺寸获取）。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerImageModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('image', {
    async compress(params) {
      const p = params as
        | {
            uri: string;
            quality?: number;
            maxWidth?: number;
            maxHeight?: number;
            format?: 'jpeg' | 'png';
          }
        | undefined;
      if (!p?.uri) {
        throw new BridgeException('INVALID_PARAMS', 'uri 不能为空');
      }
      const adapter = requireAdapter(adapters.image, 'image');
      return adapter.compress(p.uri, {
        quality: p.quality,
        maxWidth: p.maxWidth,
        maxHeight: p.maxHeight,
        format: p.format,
      });
    },

    async crop(params) {
      const p = params as
        | { uri: string; x: number; y: number; width: number; height: number }
        | undefined;
      if (
        !p?.uri ||
        typeof p.x !== 'number' ||
        typeof p.y !== 'number' ||
        typeof p.width !== 'number' ||
        typeof p.height !== 'number'
      ) {
        throw new BridgeException('INVALID_PARAMS', 'uri/x/y/width/height 不能为空');
      }
      const adapter = requireAdapter(adapters.image, 'image');
      if (!adapter.crop) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'image.crop 未实现');
      }
      return adapter.crop(p.uri, {
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
      });
    },

    async getSize(params) {
      const p = params as { uri?: string } | undefined;
      if (!p?.uri) {
        throw new BridgeException('INVALID_PARAMS', 'uri 不能为空');
      }
      const adapter = requireAdapter(adapters.image, 'image');
      if (!adapter.getSize) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'image.getSize 未实现');
      }
      return adapter.getSize(p.uri);
    },
  });
}
