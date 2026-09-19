/**
 * Bridge 统一协议类型（对应 Skill 规则 11 / 14 / 15）。
 *
 * H5 通过 WebView postMessage 发送 request，RN Bridge 返回 response。
 * 所有错误必须结构化（error.code），业务不依赖原生错误文本（规则 15/27）。
 */
import type { Permission, PermissionStatus } from '../permissions/permissions.types';

/**
 * Bridge 模块名。
 * 模块通过 registerModule 动态注册，此处用 string 而非固定联合类型，
 * 便于扩展新能力模块（clipboard/sensor/bluetooth 等）。
 */
export type BridgeModule = string;

/** 统一错误码，对齐 Skill 规则 15。 */
export type BridgeErrorCode =
  | 'BRIDGE_NOT_READY'
  | 'BRIDGE_VERSION_NOT_SUPPORTED'
  | 'METHOD_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'TIMEOUT'
  | 'BRIDGE_QUEUE_FULL'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_BLOCKED'
  | 'PERMISSION_UNAVAILABLE'
  | 'USER_CANCELLED'
  | 'DEVICE_UNSUPPORTED'
  | 'NETWORK_ERROR'
  | 'NATIVE_ERROR'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'SECURITY_BLOCKED'
  | 'UNKNOWN_ERROR';

export type BridgeError = {
  code: BridgeErrorCode;
  message: string;
};

export type BridgeRequest<P = unknown> = {
  type: 'request';
  id: string;
  version: string;
  module: BridgeModule;
  action: string;
  params?: P;
  /** 发起时间戳（毫秒），H5 侧新 SDK 发送时携带，用于观测/诊断。 */
  timestamp?: number;
};

export type BridgeResponse<D = unknown> = {
  type: 'response';
  id: string;
  success: boolean;
  data: D | null;
  error: BridgeError | null;
};

/**
 * RN→H5 事件消息（规范 §62）。
 * H5 通过 Native.on(event, handler) 订阅。
 */
export type BridgeEvent = {
  type: 'event';
  event: string;
  data: unknown;
  timestamp: number;
};

/** permission.request 入参。 */
export type PermissionRequestParams = {
  permission: Permission;
};

/** permission 相关返回数据结构。 */
export type PermissionResultData = {
  permission: Permission;
  status: PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
};

/** 一次 Bridge 调用的可观测信息（onCall 钩子，用于设备调用日志 / 监控）。 */
export type BridgeCallInfo = {
  requestId: string;
  module: string;
  action: string;
  success: boolean;
  params?: unknown;
  result?: unknown;
  error?: BridgeError | null;
  durationMs: number;
};

/** Bridge 调用观测回调（记录参数/结果/耗时/错误）。 */
export type BridgeCallHandler = (info: BridgeCallInfo) => void;

/**
 * 标准 Bridge 事件名（RN→H5 事件推送，RN 侧 emit 与 H5 侧订阅共用，
 * 对齐《RN_H5_Bridge_postMessage_onMessage_升级实施方案》§8 事件清单）。
 */
export const BRIDGE_EVENTS = {
  /** 握手完成（RN 侧在 app.ready 处理成功后推送，H5 侧可订阅兜底）。 */
  READY: 'bridge.ready',
  /** Bridge 断开（H5 侧状态机使用）。 */
  DISCONNECTED: 'bridge.disconnected',
  /** App 回到前台。 */
  APP_RESUME: 'app.resume',
  /** App 退到后台。 */
  APP_BACKGROUND: 'app.background',
  /** App 进入前台（与 APP_RESUME 语义一致，按平台习惯命名保留）。 */
  APP_FOREGROUND: 'app.foreground',
} as const;

export type BridgeEventName = (typeof BRIDGE_EVENTS)[keyof typeof BRIDGE_EVENTS];
