/**
 * Bridge 结构化错误构造工具（规则 15：错误必须结构化）。
 */
import type { BridgeErrorCode, BridgeError } from './protocol';

const DEFAULT_MESSAGES: Record<BridgeErrorCode, string> = {
  BRIDGE_NOT_READY: 'Bridge 未初始化',
  BRIDGE_VERSION_NOT_SUPPORTED: 'Bridge 版本不兼容',
  METHOD_NOT_FOUND: '未找到对应的 Bridge 方法',
  INVALID_PARAMS: '参数校验失败',
  TIMEOUT: 'Bridge 调用超时',
  BRIDGE_QUEUE_FULL: 'Bridge 请求队列已满',
  PERMISSION_DENIED: '权限被拒绝',
  PERMISSION_BLOCKED: '权限被永久拒绝',
  PERMISSION_UNAVAILABLE: '当前设备不支持该权限',
  USER_CANCELLED: '用户已取消',
  DEVICE_UNSUPPORTED: '当前设备不支持该能力',
  NETWORK_ERROR: '网络错误',
  NATIVE_ERROR: '原生调用异常',
  FILE_NOT_FOUND: '文件不存在',
  FILE_TOO_LARGE: '文件过大',
  SECURITY_BLOCKED: '安全策略阻止',
  UNKNOWN_ERROR: '未知错误',
};

export function createBridgeError(code: BridgeErrorCode, message?: string): BridgeError {
  return {
    code,
    message: message ?? DEFAULT_MESSAGES[code],
  };
}

/** 业务/原生 handler 抛出此异常，BridgeServer 会转换为结构化错误响应。 */
export class BridgeException extends Error {
  readonly error: BridgeError;

  constructor(code: BridgeErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'BridgeException';
    this.error = createBridgeError(code, message);
  }
}
