/**
 * 设备能力调用日志（规则 27）。
 *
 * 记录每次 Bridge 设备能力调用（module.action / 脱敏参数 / 结果 / 耗时 / 错误），
 * 便于追溯问题。支持日志级别控制：
 *
 *   级别（数值）: debug(10) < info(20) = success(20) < warn(30) < error(40)
 *   默认阈值   : info —— 记录 info / success / warn / error，忽略 debug
 *   调高为 error —— 仅记录 error
 *
 * 落盘：通过原生日志模块 ERPLog 追加写入 <filesDir>/logs/device-YYYY-MM-DD.log，
 * 按日期分包（同一天一个文件）。原生模块未接入时降级到 console，不影响主流程。
 */
import { NativeModules } from 'react-native';
import { LOG_LEVEL } from '../config';
import { createLogger } from './logger';
import type { BridgeError } from '../bridge/protocol';

export type DeviceLogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

/** 级别优先级（数值越大越重要）。success 与 info 同级。 */
export const LEVEL_ORDER: Record<DeviceLogLevel, number> = {
  debug: 10,
  info: 20,
  success: 20,
  warn: 30,
  error: 40,
};

/** 一次 Bridge 调用的可观测信息（由 BridgeServer.onCall 钩子提供）。 */
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

export type LogWriter = (level: DeviceLogLevel, line: string) => void;

type ERPLogNative = {
  write: (level: string, message: string) => void;
};

const { redact } = createLogger();

function getNativeWriter(): ERPLogNative | undefined {
  return (NativeModules as Record<string, unknown>).ERPLog as ERPLogNative | undefined;
}

export function createDeviceLogger(initialLevel: DeviceLogLevel = LOG_LEVEL, writer?: LogWriter) {
  let threshold: DeviceLogLevel = initialLevel;

  const emit: LogWriter =
    writer ??
    ((level, line) => {
      const native = getNativeWriter();
      if (native?.write) {
        try {
          native.write(level.toUpperCase(), line);
        } catch {
          // 日志失败绝不影响业务
        }
      } else {
        console.log(`[device:${level}] ${line}`);
      }
    });

  function log(level: DeviceLogLevel, line: string): void {
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[threshold]) {
      emit(level, line);
    }
  }

  return {
    setLevel(level: DeviceLogLevel): void {
      threshold = level;
    },
    getLevel(): DeviceLogLevel {
      return threshold;
    },
    isEnabled(level: DeviceLogLevel): boolean {
      return LEVEL_ORDER[level] >= LEVEL_ORDER[threshold];
    },
    log,
    debug: (line: string) => log('debug', line),
    info: (line: string) => log('info', line),
    success: (line: string) => log('success', line),
    warn: (line: string) => log('warn', line),
    error: (line: string) => log('error', line),
  };
}

export const deviceLogger = createDeviceLogger();

/** 依据调用结果推断日志级别：成功→success；方法不存在→warn；其余失败→error。 */
export function levelForCall(info: BridgeCallInfo): DeviceLogLevel {
  if (info.success) return 'success';
  if (info.error?.code === 'METHOD_NOT_FOUND') return 'warn';
  return 'error';
}

/** 格式化一条调用日志（参数/结果均脱敏）。 */
export function formatCallLine(info: BridgeCallInfo): string {
  const params = JSON.stringify(redact(info.params ?? null));
  const result = info.success ? JSON.stringify(redact(info.result ?? null)) : '-';
  const error = info.error ? `${info.error.code}:${info.error.message}` : '-';
  return `${info.requestId} ${info.module}.${info.action} params=${params} result=${result} error=${error} durationMs=${info.durationMs}`;
}

/** 将一次 Bridge 调用写入设备日志（受当前级别阈值控制）。 */
export function logDeviceCall(info: BridgeCallInfo): void {
  deviceLogger.log(levelForCall(info), formatCallLine(info));
}
