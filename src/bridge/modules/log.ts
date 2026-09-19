/**
 * log 桥接模块（H5 事件日志）。
 *
 * 提供 H5 侧记录事件日志的能力，日志分类为 h5_event_log，按天分文件持久化。
 *
 * H5 调用：
 *   RN.LOG.INFO({ event: 'button_click', page: '/login', button: '登录', fn: 'handleLogin' })
 *   RN.LOG.ERROR({ event: 'api_error', page: '/login', message: '请求失败', data: { code: 500 } })
 *   RN.LOG.WARN({...})
 *   RN.LOG.DEBUG({...})
 *
 * 日志维度：时间（自动）、页面、按钮、触发函数、事件名、消息、附加数据。
 * 文件命名：h5_event_log_YYYY-MM-DD.log（按天自动切换）。
 */
import { BridgeException } from '../bridge-error';
import type { BridgeServer } from '../bridge-server';
import { LogManager } from '../../observability/log-manager';
import { createConsoleSink } from '../../observability/log-manager';
import {
  FileLogWriter,
  ConsoleFileSystemAdapter,
  MemoryFileSystemAdapter,
} from '../../observability/file-log-writer';
import type { LogLevel } from '../../observability/log-entry';
import { APP_VERSION, BRIDGE_VERSION, LOG_FILE_DIR, LOG_RETENTION_DAYS } from '../../config';

/** H5 侧日志请求参数。 */
export type LogParams = {
  /** 事件名称（如 button_click、page_view、api_error） */
  event?: string;
  /** 页面标识（如 /login、/profile） */
  page?: string;
  /** 按钮/元素标识（如 登录按钮、submit_btn） */
  button?: string;
  /** 触发的函数名（如 handleLogin、onSubmit） */
  fn?: string;
  /** 日志消息（可选） */
  message?: string;
  /** 附加数据（可选，会被脱敏） */
  data?: Record<string, unknown>;
};

/** 创建默认的 LogManager（带控制台输出 + 文件写入器）。 */
function createDefaultLogManager(): LogManager {
  // 开发环境用 ConsoleFileSystemAdapter（输出到 console）；
  // 生产环境应注入 react-native-fs 适配器实现真正的文件持久化。
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const fsAdapter = isDev ? new ConsoleFileSystemAdapter() : new MemoryFileSystemAdapter();

  const fileLogWriter = new FileLogWriter({
    adapter: fsAdapter,
    dir: LOG_FILE_DIR,
    category: 'h5_event_log',
    retentionDays: LOG_RETENTION_DAYS, // 保留天数走全局配置
  });

  return new LogManager({
    context: {
      appVersion: APP_VERSION,
      bridgeVersion: BRIDGE_VERSION,
      platform: typeof Platform !== 'undefined' ? (Platform as { OS: string }).OS : 'unknown',
    },
    sink: createConsoleSink(),
    fileLogWriter,
    minLevel: 'debug',
  });
}

// 延迟导入 Platform，避免非 RN 环境报错
let Platform: { OS: string } | null = null;
try {
  Platform = require('react-native').Platform;
} catch {
  Platform = null;
}

export function registerLogModule(server: BridgeServer, logManager?: LogManager): void {
  const manager = logManager ?? createDefaultLogManager();

  /** 通用日志记录处理函数。 */
  function logHandler(level: LogLevel) {
    return (params: unknown) => {
      const p = (params && typeof params === 'object' ? (params as LogParams) : {}) as LogParams;
      const event = p.event || 'h5_event';
      try {
        manager.h5Event(level, event, p.page, p.button, p.fn, {
          data: {
            ...(p.message ? { message: p.message } : {}),
            ...(p.data || {}),
          },
        });
        return { ok: true };
      } catch (err) {
        throw new BridgeException(
          'NATIVE_ERROR',
          err instanceof Error ? err.message : '日志记录失败',
        );
      }
    };
  }

  server.registerModule('log', {
    info: logHandler('info'),
    error: logHandler('error'),
    warn: logHandler('warn'),
    debug: logHandler('debug'),
  });
}
