/**
 * Bridge 客户端类型定义（Phase 4 / 规范 §13/§16/§62）。
 *
 * BridgeTransport：传输层抽象（RN WebView / 浏览器 Mock）。
 * NativeFacade：H5 业务侧统一入口，10 模块门面 + 事件订阅 + 能力检测。
 */
import type { BridgeModule } from '../protocol';
import type { EventHandler } from './bridge-client';

export type BridgeTransport = {
  /** 向 Native 发送一条已序列化的消息。 */
  send: (raw: string) => void;
  /** 订阅来自 Native 的消息，返回取消订阅函数。 */
  subscribe: (listener: (raw: string) => void) => () => void;
};

/** app 模块门面（规范 §12）。 */
export type AppModule = {
  getInfo: () => Promise<{
    appVersion: string;
    bridgeVersion: string;
    platform: string;
  }>;
  getVersion: () => Promise<{
    appVersion: string;
    bridgeVersion: string;
    platform: string;
  }>;
  getCapabilities: () => Promise<{
    bridgeVersion: string;
    platform: string;
    features: Record<string, boolean>;
  }>;
  ready: (info?: { h5Version?: string; bridgeVersion?: string }) => Promise<{ ok: boolean }>;
  close: () => Promise<{ ok: boolean }>;
};

/** auth 模块门面（规范 §12，安全存储细节在 Phase 9）。 */
export type AuthModule = {
  getToken: () => Promise<{ token: string | null }>;
  getUser: () => Promise<{ user: Record<string, unknown> | null }>;
  logout: () => Promise<{ ok: boolean }>;
};

/** network 模块门面（规范 §12/§46/§62）。 */
export type NetworkModule = {
  getStatus: () => Promise<{ connected: boolean; type: string }>;
};

/** camera 模块门面。 */
export type CameraModule = {
  takePhoto: (options?: {
    quality?: number;
  }) => Promise<{ uri: string; width: number; height: number }>;
};

/** scanner 模块门面（规范 §20）。 */
export type ScannerModule = {
  scan: (options?: {
    torch?: boolean;
    continuous?: boolean;
  }) => Promise<{ code: string; format: string }>;
};

/** media 模块门面（压缩/上传在 Phase 11）。 */
export type MediaModule = {
  pickImage: (options?: { multiple?: boolean }) => Promise<{ uris: string[] }>;
  previewImage: (options: { uris: string[]; current?: number }) => Promise<void>;
  saveImage: (options: { uri: string }) => Promise<{ ok: boolean }>;
};

/** file 模块门面（规范 §22/§23，只回传 URI，禁止 Base64）。 */
export type FileModule = {
  pick: (options?: {
    accept?: string[];
    multiple?: boolean;
  }) => Promise<{ uris: string[]; names: string[]; sizes: number[] }>;
  download: (options: { url: string; filename?: string }) => Promise<{ uri: string }>;
  open: (options: { uri: string }) => Promise<{ ok: boolean }>;
};

/** location 模块门面（规范 §61，持续定位须节流）。 */
export type LocationModule = {
  getCurrentPosition: () => Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
  }>;
};

/** system 模块门面。 */
export type SystemModule = {
  vibrate: (options?: { duration?: number }) => Promise<void>;
  copy: (options: { text: string }) => Promise<{ ok: boolean }>;
  share: (options: { title?: string; text?: string; url?: string }) => Promise<{ ok: boolean }>;
};

/** notification 模块门面（推送通道在 Phase 12）。 */
export type NotificationModule = {
  getToken: () => Promise<{ token: string | null }>;
  setBadge: (options: { count: number }) => Promise<{ ok: boolean }>;
};

/** permission 模块门面（规范 §50）。 */
export type PermissionModule = {
  request: (params: { permission: string }) => Promise<{
    permission: string;
    status: string;
    granted: boolean;
    canAskAgain: boolean;
  }>;
  check: (params: {
    permission: string;
  }) => Promise<{ permission: string; status: string; granted: boolean }>;
  openSettings: () => Promise<{ opened: boolean }>;
};

/**
 * Native 门面：H5 业务侧统一入口（规范 §13/§41）。
 * 业务代码只依赖此对象，禁止直接调用 window.ReactNativeWebView。
 */
export type NativeFacade = {
  app: AppModule;
  auth: AuthModule;
  network: NetworkModule;
  camera: CameraModule;
  scanner: ScannerModule;
  media: MediaModule;
  file: FileModule;
  location: LocationModule;
  system: SystemModule;
  notification: NotificationModule;
  permission: PermissionModule;

  /** 能力检测（规范 §16）。 */
  supports: (feature: string) => Promise<boolean>;
  getCapabilities: () => Promise<Record<string, boolean>>;

  /** 事件订阅（规范 §62）。 */
  on: (event: string, handler: EventHandler) => () => void;
  off: (event: string, handler: EventHandler) => void;
  once: (event: string, handler: EventHandler) => () => void;
};

export type { BridgeModule };
