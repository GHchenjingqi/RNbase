/**
 * 统一日志模型（Phase 13 / 规范 §27）。
 *
 * 五类日志统一字段：
 *   timestamp、appVersion、bridgeVersion、h5Version、platform、
 *   requestId、event、errorCode、duration（+ module/action/networkType 按需）
 *
 * 日志分类：app / bridge / h5_error / h5_event_log / update / webview
 */

export type LogCategory = 'app' | 'bridge' | 'h5_error' | 'h5_event_log' | 'update' | 'webview';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 统一日志条目（规范 §27 允许字段）。 */
export type LogEntry = {
  /** 日志唯一 ID（用于追踪） */
  id: string;
  /** 时间戳（ISO 8601） */
  timestamp: string;
  /** 日志分类 */
  category: LogCategory;
  /** 日志级别 */
  level: LogLevel;
  /** 事件名称 */
  event: string;
  /** App 版本 */
  appVersion?: string;
  /** Bridge 版本 */
  bridgeVersion?: string;
  /** H5 版本 */
  h5Version?: string;
  /** 平台：android / ios / web */
  platform?: string;
  /** 请求 ID（贯穿 Bridge 请求） */
  requestId?: string;
  /** Bridge 模块 */
  module?: string;
  /** Bridge 动作 */
  action?: string;
  /** 错误码（规范 §15 错误码表） */
  errorCode?: string;
  /** 错误信息（已脱敏） */
  errorMessage?: string;
  /** 网络类型：wifi / cellular / none */
  networkType?: string;
  /** 耗时（毫秒） */
  durationMs?: number;
  /** 附加数据（已脱敏） */
  data?: Record<string, unknown>;
};

/** 日志上下文（创建日志时自动填充）。 */
export type LogContext = {
  appVersion: string;
  bridgeVersion: string;
  h5Version?: string;
  platform: string;
  networkType?: string;
};

/** 日志条目创建器。 */
export function createLogEntry(
  category: LogCategory,
  level: LogLevel,
  event: string,
  context: LogContext,
  extra?: Partial<LogEntry>,
): LogEntry {
  return {
    id: generateLogId(),
    timestamp: new Date().toISOString(),
    category,
    level,
    event,
    appVersion: context.appVersion,
    bridgeVersion: context.bridgeVersion,
    h5Version: context.h5Version,
    platform: context.platform,
    networkType: context.networkType,
    ...extra,
  };
}

let logIdCounter = 0;
function generateLogId(): string {
  logIdCounter += 1;
  return `log_${Date.now()}_${logIdCounter}`;
}

/** 重置日志 ID 计数器（测试用）。 */
export function resetLogIdCounter(): void {
  logIdCounter = 0;
}
