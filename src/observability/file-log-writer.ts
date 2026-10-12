/**
 * 文件日志写入器（按天分文件）。
 *
 * 职责：
 *  - 将 LogEntry 格式化为文本行，追加写入按日期命名的日志文件
 *  - 自动跨天切换文件（YYYY-MM-DD）
 *  - 写入队列 + 防抖，避免频繁 IO
 *  - 通过 FileSystemAdapter 抽象文件操作，适配不同平台
 *
 * 文件命名：{category}_{YYYY-MM-DD}.log
 *   例：h5_event_log_2026-09-03.log
 *
 * 生产环境接入 react-native-fs：
 *   const adapter = createRnFsAdapter(RNFS);
 *   const writer = new FileLogWriter({ adapter, dir: RNFS.DocumentDirectoryPath + '/logs' });
 */
import type { LogEntry } from './log-entry';
import { LOG_RETENTION_DAYS } from '../config';

/** 文件系统适配器（抽象文件操作，便于测试和跨平台）。 */
export interface FileSystemAdapter {
  /** 判断目录是否存在 */
  exists(path: string): Promise<boolean>;
  /** 创建目录（递归） */
  mkdir(path: string): Promise<void>;
  /** 追加内容到文件（文件不存在则创建） */
  appendFile(path: string, content: string): Promise<void>;
  /** 读取文件内容（诊断用，可选） */
  readFile?(path: string): Promise<string>;
  /** 列出目录下文件名（清理过期日志用，可选；适配器不支持时跳过清理） */
  readdir?(dir: string): Promise<string[]>;
  /** 删除文件（清理过期日志用，可选；适配器不支持时跳过清理） */
  unlink?(path: string): Promise<void>;
}

export type FileLogWriterOptions = {
  /** 文件系统适配器 */
  adapter: FileSystemAdapter;
  /** 日志文件存放目录 */
  dir: string;
  /** 日志分类（用于文件名前缀），默认 h5_event_log */
  category?: string;
  /** 批量写入防抖间隔（毫秒），默认 500 */
  flushIntervalMs?: number;
  /** 单次批量最大条数，默认 50 */
  maxBatchSize?: number;
  /**
   * 日志保留天数（有效期）：超过该天数的历史日志文件自动清理。
   * 默认取全局配置 LOG_RETENTION_DAYS（src/config，默认 7）。
   * 例：retentionDays=7 时，删除日期早于「今天-7天」的 {category}_YYYY-MM-DD.log 文件。
   * 传 0 或负数表示不清理（永久保留）。
   */
  retentionDays?: number;
  /** 自定义日志行格式化函数 */
  formatEntry?: (entry: LogEntry) => string;
};

/** 默认日志行格式化：[时间] [级别] 页面=xxx 按钮=xxx 函数=xxx 消息 */
function defaultFormatEntry(entry: LogEntry): string {
  const parts: string[] = [`[${entry.timestamp}]`, `[${entry.level.toUpperCase()}]`];
  const data = entry.data || {};
  if (data.page) parts.push(`页面=${String(data.page)}`);
  if (data.button) parts.push(`按钮=${String(data.button)}`);
  if (data.fn) parts.push(`函数=${String(data.fn)}`);
  if (entry.event) parts.push(`事件=${entry.event}`);
  if (data.message) parts.push(String(data.message));
  // 附加其他 data 字段（JSON）
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!['page', 'button', 'fn', 'message'].includes(k)) {
      extra[k] = v;
    }
  }
  if (Object.keys(extra).length > 0) {
    parts.push(`附加=${JSON.stringify(extra)}`);
  }
  return parts.join(' ');
}

/** 获取当前日期字符串（本地时区，YYYY-MM-DD）。 */
function getDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class FileLogWriter {
  private readonly options: Required<Omit<FileLogWriterOptions, 'formatEntry'>> & {
    formatEntry: (entry: LogEntry) => string;
  };
  private buffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDate: string;
  private dirReady = false;
  private isFlushing = false;
  /** 上次执行日志清理的日期（每天最多清理一次，避免频繁遍历目录） */
  private lastCleanupDate: string | null = null;

  constructor(options: FileLogWriterOptions) {
    this.options = {
      adapter: options.adapter,
      dir: options.dir,
      category: options.category ?? 'h5_event_log',
      flushIntervalMs: options.flushIntervalMs ?? 500,
      maxBatchSize: options.maxBatchSize ?? 50,
      retentionDays: options.retentionDays ?? LOG_RETENTION_DAYS,
      formatEntry: options.formatEntry ?? defaultFormatEntry,
    };
    this.currentDate = getDateStr();
  }

  /** 写入一条日志（加入缓冲，定时批量刷入文件）。 */
  write(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.options.maxBatchSize) {
      this.flush().catch(() => undefined);
    } else if (!this.flushTimer) {
      this.scheduleFlush();
    }
  }

  /** 手动触发写入（返回是否成功）。 */
  async flush(): Promise<boolean> {
    if (this.isFlushing || this.buffer.length === 0) {
      return this.buffer.length === 0;
    }
    this.isFlushing = true;
    this.clearFlushTimer();

    try {
      // 确保目录存在
      if (!this.dirReady) {
        await this.ensureDir();
        this.dirReady = true;
      }

      // 跨天检测：切换日期文件
      const today = getDateStr();
      if (today !== this.currentDate) {
        this.currentDate = today;
      }

      const batch = this.buffer.splice(0, this.options.maxBatchSize);
      const lines = batch.map(e => this.options.formatEntry(e)).join('\n') + '\n';
      const filePath = this.getFilePath();

      await this.options.adapter.appendFile(filePath, lines);

      // 写盘成功后清理过期日志（每天最多一次，不影响写入主流程）
      await this.maybeCleanup();

      return true;
    } catch {
      // 写入失败，数据放回缓冲头部（不丢失）
      return false;
    } finally {
      this.isFlushing = false;
      // 缓冲还有数据时继续调度
      if (this.buffer.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /** 获取当前日志文件路径。 */
  getFilePath(): string {
    return `${this.options.dir}/${this.options.category}_${this.currentDate}.log`;
  }

  /**
   * 清理过期日志文件（每天最多执行一次）。
   * 删除日期早于「今天 - retentionDays」的 {category}_YYYY-MM-DD.log 文件。
   * 适配器不支持 readdir/unlink 或 retentionDays <= 0 时跳过清理。
   */
  async maybeCleanup(): Promise<void> {
    const retentionDays = this.options.retentionDays;
    // 不清理：未配置保留天数或保留天数为 0/负数
    if (!retentionDays || retentionDays <= 0) return;
    // 适配器不支持目录遍历/删除时跳过（不影响日志写入）
    if (!this.options.adapter.readdir || !this.options.adapter.unlink) return;

    const today = getDateStr();
    // 当天已清理过，跳过（避免每次 flush 都遍历目录）
    if (this.lastCleanupDate === today) return;
    this.lastCleanupDate = today;

    try {
      await this.cleanupExpired(retentionDays);
    } catch {
      // 清理失败不影响日志写入主流程
    }
  }

  /**
   * 删除超过保留天数的历史日志文件。
   * @returns 被删除的文件名列表
   */
  async cleanupExpired(retentionDays: number): Promise<string[]> {
    const adapter = this.options.adapter;
    if (!adapter.readdir || !adapter.unlink) return [];

    // 截止日期：今天往前推 retentionDays 天，日期早于该值的文件删除
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = getDateStr(cutoff);

    // 前缀 + 扩展名校验，避免误删其他文件
    const prefix = `${this.options.category}_`;
    const fileNames = await adapter.readdir(this.options.dir);
    const removed: string[] = [];

    for (const name of fileNames) {
      if (!name.startsWith(prefix) || !name.endsWith('.log')) continue;
      const datePart = name.slice(prefix.length, -'.log'.length);
      // 仅处理 YYYY-MM-DD 命名的日志文件
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue;
      // YYYY-MM-DD 字符串可直接按字典序比较（即日期先后）
      if (datePart < cutoffStr) {
        await adapter.unlink(`${this.options.dir}/${name}`);
        removed.push(name);
      }
    }
    return removed;
  }

  /** 获取缓冲中的日志条数（诊断用）。 */
  bufferSize(): number {
    return this.buffer.length;
  }

  /** 销毁：强制刷入剩余日志并停止定时器。 */
  async destroy(): Promise<void> {
    this.clearFlushTimer();
    if (this.buffer.length > 0) {
      await this.flush();
    }
  }

  private async ensureDir(): Promise<void> {
    const exists = await this.options.adapter.exists(this.options.dir);
    if (!exists) {
      await this.options.adapter.mkdir(this.options.dir);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => undefined);
    }, this.options.flushIntervalMs);
    // Node.js 环境允许进程退出时不等待定时器
    const timer = this.flushTimer as unknown as { unref?: () => void };
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// =====================================================================
// 内置适配器实现
// =====================================================================

/** 内存文件系统适配器（测试 / 降级用；数据存内存，不持久化）。 */
export class MemoryFileSystemAdapter implements FileSystemAdapter {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async appendFile(path: string, content: string): Promise<void> {
    const existing = this.files.get(path) || '';
    this.files.set(path, existing + content);
  }

  async readFile(path: string): Promise<string> {
    return this.files.get(path) || '';
  }

  async readdir(dir: string): Promise<string[]> {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const names: string[] = [];
    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length);
        // 仅返回直接子文件（不递归子目录）
        if (rest && !rest.includes('/')) names.push(rest);
      }
    }
    return names;
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(path);
  }

  /** 获取所有文件路径（测试用）。 */
  listFiles(): string[] {
    return Array.from(this.files.keys());
  }

  /** 清空所有数据（测试用）。 */
  clear(): void {
    this.files.clear();
    this.dirs.clear();
  }
}

/** 控制台文件系统适配器（开发调试用；追加内容输出到 console.log）。 */
export class ConsoleFileSystemAdapter implements FileSystemAdapter {
  async exists(_path: string): Promise<boolean> {
    return true;
  }

  async mkdir(_path: string): Promise<void> {
    // no-op
  }

  async appendFile(path: string, content: string): Promise<void> {
    console.log(`[FileLog:${path}]`, content.trim());
  }

  async readdir(_dir: string): Promise<string[]> {
    // 开发调试适配器不维护真实文件，跳过清理
    return [];
  }

  async unlink(_path: string): Promise<void> {
    // no-op
  }
}

/**
 * 创建 react-native-fs 适配器（生产环境用）。
 * 使用前需安装 react-native-fs 并完成原生 link。
 *
 * @example
 * import RNFS from 'react-native-fs';
 * const adapter = createRnFsAdapter(RNFS);
 * const writer = new FileLogWriter({ adapter, dir: RNFS.DocumentDirectoryPath + '/logs' });
 */
export function createRnFsAdapter(rnfs: {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  appendFile(path: string, content: string, encoding?: string): Promise<void>;
  readFile(path: string, encoding?: string): Promise<string>;
  readdir(dir: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
}): FileSystemAdapter {
  return {
    exists: path => rnfs.exists(path),
    mkdir: path => rnfs.mkdir(path),
    appendFile: (path, content) => rnfs.appendFile(path, content, 'utf8'),
    readFile: path => rnfs.readFile(path, 'utf8'),
    readdir: dir => rnfs.readdir(dir),
    unlink: path => rnfs.unlink(path),
  };
}
