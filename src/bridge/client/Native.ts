/**
 * Native 门面（H5 业务侧统一入口，Phase 4 / 规范 §13/§41/§43）。
 *
 * 业务代码只依赖此对象，禁止直接调用 window.ReactNativeWebView。
 * 底层 transport 可在 RN WebView 与浏览器 Mock 间切换（规范 §42/§43）。
 *
 * 包含 10 个模块门面（app/auth/network/camera/scanner/media/file/location/system/notification）
 * + permission 模块 + 能力检测 + 事件订阅。
 */
import { BridgeClient } from './bridge-client';
import type { NativeFacade } from './types';

export function createNative(client: BridgeClient): NativeFacade {
  return {
    app: {
      getInfo: () => client.request('app', 'getInfo'),
      getVersion: () => client.request('app', 'getVersion'),
      getCapabilities: () => client.request('app', 'getCapabilities'),
      ready: info => client.request('app', 'ready', info),
      close: () => client.request('app', 'close'),
    },
    auth: {
      getToken: () => client.request('auth', 'getToken'),
      getUser: () => client.request('auth', 'getUser'),
      logout: () => client.request('auth', 'logout'),
    },
    network: {
      getStatus: () => client.request('network', 'getStatus'),
    },
    camera: {
      takePhoto: options => client.request('camera', 'takePhoto', options),
    },
    scanner: {
      scan: options => client.request('scanner', 'scan', options),
    },
    media: {
      pickImage: options => client.request('media', 'pickImage', options),
      previewImage: options => client.request('media', 'previewImage', options),
      saveImage: options => client.request('media', 'saveImage', options),
    },
    file: {
      pick: options => client.request('file', 'pick', options),
      download: options => client.request('file', 'download', options),
      open: options => client.request('file', 'open', options),
    },
    location: {
      getCurrentPosition: () => client.request('location', 'getCurrentPosition'),
    },
    system: {
      vibrate: options => client.request('system', 'vibrate', options),
      copy: options => client.request('system', 'copy', options),
      share: options => client.request('system', 'share', options),
    },
    notification: {
      getToken: () => client.request('notification', 'getToken'),
      setBadge: options => client.request('notification', 'setBadge', options),
    },
    permission: {
      request: params => client.request('permission', 'request', params),
      check: params => client.request('permission', 'check', params),
      openSettings: () => client.request('permission', 'openSettings'),
    },

    // 能力检测（规范 §16）
    supports: (feature: string) => client.supports(feature),
    getCapabilities: () => client.getCapabilities(),

    // 事件订阅（规范 §62）
    on: (event: string, handler) => client.on(event, handler),
    off: (event: string, handler) => client.off(event, handler),
    once: (event: string, handler) => client.once(event, handler),
  };
}
