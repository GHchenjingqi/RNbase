/**
 * file 桥接模块（规则 22/23：文件选择/下载/打开，禁止大文件转 Base64）。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerFileModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('file', {
    async pick(params) {
      const adapter = requireAdapter(adapters.file, 'file');
      const p = params as { accept?: string[]; multiple?: boolean } | undefined;
      return adapter.pick(p);
    },
    /**
     * 读取文件内容为 Base64（H5 调用 FILE.READASBASE64）。
     * 供 H5 侧转 Blob 后上传到后端（如头像上传 /system/user/profile/avatar）。
     */
    async readAsBase64(params) {
      const adapter = requireAdapter(adapters.file, 'file');
      const p = params as { uri: string } | undefined;
      if (!p?.uri) {
        throw new BridgeException('INVALID_PARAMS', 'uri 不能为空');
      }
      return adapter.readAsBase64(p.uri);
    },
    /**
     * 从相册选图（H5 调用 FILE.PICKIMAGE）。
     * 底层走 media.pickImage（原生 pickImage），返回第一张图的 { uri }，
     * 与 camera.takePhoto 返回格式对齐，便于 H5 头像页统一处理。
     */
    async pickImage(params) {
      const adapter = requireAdapter(adapters.media, 'media');
      const p = params as { multiple?: boolean } | undefined;
      const result = await adapter.pickImage(p);
      const file = result.files?.[0];
      if (!file) {
        throw new BridgeException('USER_CANCELLED', '未选择图片');
      }
      return {
        uri: file.uri,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
      };
    },
    async download(params) {
      const adapter = requireAdapter(adapters.file, 'file');
      const p = params as { url: string } | undefined;
      if (!p?.url) {
        throw new BridgeException('INVALID_PARAMS', 'url 不能为空');
      }
      return adapter.download(p.url);
    },
    async open(params) {
      const adapter = requireAdapter(adapters.file, 'file');
      const p = params as { uri: string } | undefined;
      if (!p?.uri) {
        throw new BridgeException('INVALID_PARAMS', 'uri 不能为空');
      }
      return adapter.open(p.uri);
    },
  });
}
