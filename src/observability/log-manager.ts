/**
 * 日志管理器（Phase 13 / 规范 §27、§35）。
 *
 * 职责：
 *  - 统一收集五类日志
 *  - 本地环形缓冲（限制内存占用）
 *  - 批量/节流上报（避免高频穿桥或网络请求）
 *  - 弱网缓存 + 恢复后补报
 *  - 日志脱敏（所有条目入库前脱敏）
 *  - 诊断查询（最近错误、更新历史等）
 *
 * 上报通道可注入，便于单测与替换为真实上报接口。
 */
import type { LogCategory, LogContext, LogEntry, LogLevel } from './log-entry';
import { createLogEntry } from './log-entry';
import { redactLogEntry } from './redact';
import type { FileLogWriter } from './file-log-writer';

export type LogSink = (entry: LogEntry) => void;

export type LogReporter = (entries: LogEntry[]) => Promise<boolean>;

export type LogManagerOptions = {
  /** 日志上下文（自动填充到每条日志） */
  context: LogContext;
  /** 环形缓冲最大条数，默认 1000 */
  maxBufferSize?: number;
  /** 批量上报阈值（达到此数量触发上报），默认 20 */
  batchSize?: number;
  /** 上报间隔（毫秒），默认 5000 */
  flushIntervalMs?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 上报通道（可选，未设置时仅本地缓冲） */
  reporter?: LogReporter;
  /** 本地日志输出（可选，默认 console.log） */
  sink?: LogSink;
  /** 文件日志写入器（可选，h5_event_log 分类同时写入按天文件） */
  fileLogWriter?: FileLogWriter;
  /** 最低日志级别（低于此级别的日志不记录），默认 debug */
  minLevel?: LogLevel;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class LogManager {
  private readonly options: Required<
    Omit<LogManagerOptions, 'reporter' | 'sink' | 'fileLogWriter'>
  > & {
    reporter?: LogReporter;
    sink?: LogSink;
    fileLogWriter?: FileLogWriter;
  };
  private buffer: LogEntry[] = [];
  private pendingQueue: LogEntry[] = []; // 待上报队列（弱网缓存）
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;
  private retryCount = 0;

  constructor(options: LogManagerOptions) {
    this.options = {
      context: options.context,
      maxBufferSize: options.maxBufferSize ?? 1000,
      batchSize: options.batchSize ?? 20,
      flushIntervalMs: options.flushIntervalMs ?? 5000,
      maxRetries: options.maxRetries ?? 3,
      reporter: options.reporter,
      sink: options.sink,
      fileLogWriter: options.fileLogWriter,
      minLevel: options.minLevel ?? 'debug',
    };
    this.startFlushTimer();
  }

  /** 记录一条日志。 */
  log(category: LogCategory, level: LogLevel, event: string, extra?: Partial<LogEntry>): LogEntry {
    // 级别过滤
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.options.minLevel]) {
      return {} as LogEntry;
    }

    const entry = createLogEntry(category, level, event, this.options.context, extra);
    const safeEntry = redactLogEntry(entry);

    // 本地输出
    this.options.sink?.(safeEntry);

    // h5_event_log 分类同时写入按天文件
    if (category === 'h5_event_log' && this.options.fileLogWriter) {
      this.options.fileLogWriter.write(safeEntry);
    }

    // 加入缓冲
    this.buffer.push(safeEntry);
    if (this.buffer.length > this.options.maxBufferSize) {
      this.buffer.shift(); // 环形缓冲：移除最旧的
    }

    // 加入待上报队列
    this.pendingQueue.push(safeEntry);

    // 达到批量阈值触发上报
    if (this.pendingQueue.length >= this.options.batchSize) {
      this.flush().catch(() => undefined);
    }

    return safeEntry;
  }

  /** 便捷方法：记录 App 日志。 */
  app(level: LogLevel, event: string, extra?: Partial<LogEntry>): LogEntry {
    return this.log('app', level, event, extra);
  }

  /** 便捷方法：记录 Bridge 日志。 */
  bridge(level: LogLevel, event: string, extra?: Partial<LogEntry>): LogEntry {
    return this.log('bridge', level, event, extra);
  }

  /** 便捷方法：记录 H5 错误。 */
  h5Error(level: LogLevel, event: string, extra?: Partial<LogEntry>): LogEntry {
    return this.log('h5_error', level, event, extra);
  }

  /**
   * 便捷方法：记录 H5 事件日志（按钮点击等）。
   *
   * @param level 日志级别
   * @param event 事件名称（如 button_click）
   * @param page 页面标识（如 /login、/profile）
   * @param button 按钮标识（如 登录按钮、submit_btn）
   * @param fn 触发的函数名（如 handleLogin、onSubmit）
   * @param extra 附加数据
   */
  h5Event(
    level: LogLevel,
    event: string,
    page?: string,
    button?: string,
    fn?: string,
    extra?: Partial<LogEntry>,
  ): LogEntry {
    return this.log('h5_event_log', level, event, {
      ...extra,
      data: {
        ...(extra?.data || {}),
        ...(page ? { page } : {}),
        ...(button ? { button } : {}),
        ...(fn ? { fn } : {}),
      },
    });
  }

  /** 便捷方法：记录更新日志。 */
  update(level: LogLevel, event: string, extra?: Partial<LogEntry>): LogEntry {
    return this.log('update', level, event, extra);
  }

  /** 便捷方法：记录 WebView 错误。 */
  webview(level: LogLevel, event: string, extra?: Partial<LogEntry>): LogEntry {
    return this.log('webview', level, event, extra);
  }

  /** 手动触发上报。 */
  async flush(): Promise<boolean> {
    if (this.isFlushing || this.pendingQueue.length === 0) {
      return this.pendingQueue.length === 0;
    }
    if (!this.options.reporter) {
      this.pendingQueue = []; // 无上报道通道，清空队列
      return true;
    }

    this.isFlushing = true;
    const batch = this.pendingQueue.splice(0, this.options.batchSize);

    try {
      const success = await this.options.reporter(batch);
      if (success) {
        this.retryCount = 0;
        // 继续上报剩余
        if (this.pendingQueue.length > 0) {
          return this.flush();
        }
        return true;
      }
      // 上报失败，放回队列头部
      this.pendingQueue.unshift(...batch);
      this.retryCount += 1;
      if (this.retryCount >= this.options.maxRetries) {
        // 超过最大重试，丢弃最旧的一批
        this.pendingQueue.splice(0, batch.length);
        this.retryCount = 0;
      }
      return false;
    } catch {
      this.pendingQueue.unshift(...batch);
      return false;
    } finally {
      this.isFlushing = false;
    }
  }

  /** 获取缓冲中的日志（诊断用）。 */
  getBuffer(category?: LogCategory, limit?: number): LogEntry[] {
    let result = this.buffer;
    if (category) {
      result = result.filter(e => e.category === category);
    }
    if (limit) {
      result = result.slice(-limit);
    }
    return [...result];
  }

  /** 获取最近的错误日志。 */
  getRecentErrors(limit = 20): LogEntry[] {
    return this.buffer
      .filter(e => e.level === 'error' || e.level === 'warn')
      .slice(-limit)
      .reverse();
  }

  /** 获取更新历史日志。 */
  getUpdateHistory(limit = 50): LogEntry[] {
    return this.buffer
      .filter(e => e.category === 'update')
      .slice(-limit)
      .reverse();
  }

  /** 按 requestId 追踪日志（Bridge 请求全链路）。 */
  getByRequestId(requestId: string): LogEntry[] {
    return this.buffer.filter(e => e.requestId === requestId);
  }

  /** 清空缓冲（测试用）。 */
  clear(): void {
    this.buffer = [];
    this.pendingQueue = [];
    this.retryCount = 0;
  }

  /** 销毁日志管理器（停止定时器）。 */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush().catch(() => undefined);
  }

  /** 更新日志上下文（如 H5 版本变化时）。 */
  updateContext(partial: Partial<LogContext>): void {
    this.options.context = { ...this.options.context, ...partial };
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => undefined);
    }, this.options.flushIntervalMs);
    // Node.js 环境下允许进程退出时不等待定时器
    const timer = this.flushTimer as unknown as { unref?: () => void };
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }
}

/** 创建控制台输出 sink（开发用）。 */
export function createConsoleSink(): LogSink {
  return entry => {
    const prefix = `[${entry.category.toUpperCase()}] [${entry.level.toUpperCase()}]`;
    if (entry.level === 'error') {
      console.error(prefix, entry.event, entry);
    } else if (entry.level === 'warn') {
      console.warn(prefix, entry.event, entry);
    } else {
      console.log(prefix, entry.event, entry);
    }
  };
}
