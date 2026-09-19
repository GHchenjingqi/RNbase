/**
 * 能力模块（scanner/camera/media/file/location）单测：
 *  - 未注入 adapter -> DEVICE_UNSUPPORTED
 *  - 注入 mock adapter -> 返回真实数据
 *  - 参数缺失 -> INVALID_PARAMS
 */
import { createBridgeServer } from '../src/bridge/index';
import { PermissionManager } from '../src/permissions/permission-manager';
import type { CapabilityAdapters } from '../src/bridge/modules/capabilities/types';
import type { BridgeRequest } from '../src/bridge/protocol';

function req(module: string, action: string, params?: unknown): BridgeRequest {
  return {
    type: 'request',
    id: `c_${module}_${action}`,
    version: '1.0.0',
    module: module as BridgeRequest['module'],
    action,
    params,
  };
}

describe('capability modules', () => {
  it('scanner unavailable returns DEVICE_UNSUPPORTED', async () => {
    const server = createBridgeServer(new PermissionManager());
    const res = await server.handle(req('scanner', 'scan'));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  it('scanner with adapter returns scanned code', async () => {
    const capabilities: CapabilityAdapters = {
      scanner: { scan: async () => ({ code: '6901234567890' }) },
    };
    const server = createBridgeServer(new PermissionManager(), capabilities);
    const res = await server.handle(req('scanner', 'scan'));
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ code: '6901234567890' });
  });

  it('camera takePhoto returns uri', async () => {
    const capabilities: CapabilityAdapters = {
      camera: { takePhoto: async () => ({ uri: 'file://photo.jpg' }) },
    };
    const server = createBridgeServer(new PermissionManager(), capabilities);
    const res = await server.handle(req('camera', 'takePhoto'));
    expect(res.data).toEqual({ uri: 'file://photo.jpg' });
  });

  it('media.saveImage missing uri -> INVALID_PARAMS', async () => {
    const capabilities: CapabilityAdapters = {
      media: {
        pickImage: async () => ({ files: [] }),
        saveImage: async () => ({ saved: true }),
      },
    };
    const server = createBridgeServer(new PermissionManager(), capabilities);
    const res = await server.handle(req('media', 'saveImage', {}));
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_PARAMS');
  });

  it('file.pick returns picked files', async () => {
    const capabilities: CapabilityAdapters = {
      file: {
        pick: async () => ({
          files: [{ name: 'a.pdf', size: 10, mimeType: 'application/pdf', uri: 'f' }],
        }),
        readAsBase64: async () => ({
          base64: 'dGVzdA==',
          mimeType: 'application/pdf',
          name: 'a.pdf',
          size: 10,
        }),
        download: async () => ({ uri: 'd' }),
        open: async () => ({ opened: true }),
      },
    };
    const server = createBridgeServer(new PermissionManager(), capabilities);
    const res = await server.handle(req('file', 'pick', { accept: ['application/pdf'] }));
    expect(res.success).toBe(true);
    expect((res.data as { files: unknown[] }).files).toHaveLength(1);
  });

  it('location.getCurrentPosition returns coords', async () => {
    const caps: CapabilityAdapters = {
      location: {
        getCurrentPosition: async () => ({
          latitude: 31.2,
          longitude: 121.5,
          accuracy: 5,
          timestamp: Date.now(),
        }),
      },
    };
    const server = createBridgeServer(new PermissionManager(), caps);
    const res = await server.handle(req('location', 'getCurrentPosition'));
    expect(res.data).toMatchObject({ latitude: 31.2, longitude: 121.5 });
  });
});
