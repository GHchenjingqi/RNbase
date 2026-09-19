/**
 * 内存监控器与临时文件清理器（Phase 14 / 规范 §23、§52、§53）。
 *
 * 职责：
 *  - MemoryMonitor：监控内存使用，检测内存泄漏（持续增长），告警
 *  - TempFileCleaner：临时文件及时清理，避免沙盒体积持续膨胀
 */
import type { MemorySnapshot, MemoryThresholds } from './types';

// ==================== 内存监控器 ====================

export type MemoryMonitorOptions = {
  /** 内存阈值 */
  thresholds?: MemoryThresholds;
  /** 采样间隔（毫秒），默认 5000ms */
  sampleIntervalMs?: number;
  /** 最大快照数，默认 100 */
  maxSnapshots?: number;
  /** 内存获取函数（可选，默认使用 performance.memory 或估算） */
  getMemory?: () => Promise<MemorySnapshot>;
  /** 告警回调 */
  onAlert?: (level: 'warning' | 'critical', snapshot: MemorySnapshot, message: string) => void;
};

export class MemoryMonitor {
  private readonly options: Required<Omit<MemoryMonitorOptions, 'getMemory' | 'onAlert'>> & {
    getMemory?: () => Promise<MemorySnapshot>;
    onAlert?: MemoryMonitorOptions['onAlert'];
  };
  private snapshots: MemorySnapshot[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(options?: MemoryMonitorOptions) {
    this.options = {
      thresholds: {
        warningMB: options?.thresholds?.warningMB ?? 200,
        criticalMB: options?.thresholds?.criticalMB ?? 300,
        growthWindowSec: options?.thresholds?.growthWindowSec ?? 30,
        growthRatePercentPerMin: options?.thresholds?.growthRatePercentPerMin ?? 10,
      },
      sampleIntervalMs: options?.sampleIntervalMs ?? 5000,
      maxSnapshots: options?.maxSnapshots ?? 100,
      getMemory: options?.getMemory,
      onAlert: options?.onAlert,
    };
  }

  /** 开始监控。 */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.sample().catch(() => undefined);
    }, this.options.sampleIntervalMs);
  }

  /** 停止监控。 */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 手动采样一次。 */
  async sample(): Promise<MemorySnapshot> {
    const snapshot = await this.getCurrentMemory();
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.options.maxSnapshots) {
      this.snapshots.shift();
    }
    this.checkAlerts(snapshot);
    return snapshot;
  }

  /** 获取当前内存使用。 */
  async getCurrentMemory(): Promise<MemorySnapshot> {
    if (this.options.getMemory) {
      return this.options.getMemory();
    }

    // 默认实现：使用 performance.memory（Chrome）或估算
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      usedMB: 0,
    };

    // 浏览器环境
    const perf = (
      globalThis as unknown as {
        performance?: {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
        };
      }
    ).performance;
    if (perf && perf.memory) {
      const mem = perf.memory;
      snapshot.jsHeapUsedMB = mem.usedJSHeapSize / 1024 / 1024;
      snapshot.jsHeapSizeMB = mem.totalJSHeapSize / 1024 / 1024;
      snapshot.usedMB = snapshot.jsHeapUsedMB;
    }

    return snapshot;
  }

  /** 获取内存快照历史。 */
  getSnapshots(limit?: number): MemorySnapshot[] {
    if (limit) {
      return this.snapshots.slice(-limit);
    }
    return [...this.snapshots];
  }

  /** 获取当前内存使用。 */
  getCurrent(): MemorySnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /** 检测内存泄漏（持续增长）。 */
  detectLeak(): { leaking: boolean; growthRate?: number; message?: string } {
    const windowMs = this.options.thresholds.growthWindowSec! * 1000;
    const now = Date.now();
    const windowSnapshots = this.snapshots.filter(s => now - s.timestamp <= windowMs);

    if (windowSnapshots.length < 3) {
      return { leaking: false };
    }

    const first = windowSnapshots[0];
    const last = windowSnapshots[windowSnapshots.length - 1];
    const elapsedMin = (last.timestamp - first.timestamp) / 60000;

    if (elapsedMin <= 0) {
      return { leaking: false };
    }

    const growthRate = (((last.usedMB - first.usedMB) / first.usedMB) * 100) / elapsedMin;

    if (growthRate > this.options.thresholds.growthRatePercentPerMin!) {
      return {
        leaking: true,
        growthRate,
        message: `内存以 ${growthRate.toFixed(1)}%/分钟 持续增长，可能存在内存泄漏`,
      };
    }

    return { leaking: false, growthRate };
  }

  /** 清空快照。 */
  clear(): void {
    this.snapshots = [];
  }

  /** 销毁监控器。 */
  destroy(): void {
    this.stop();
    this.clear();
  }

  private checkAlerts(snapshot: MemorySnapshot): void {
    const { warningMB, criticalMB } = this.options.thresholds;

    if (snapshot.usedMB >= criticalMB!) {
      this.options.onAlert?.(
        'critical',
        snapshot,
        `内存使用 ${snapshot.usedMB.toFixed(1)}MB 超过严重阈值 ${criticalMB}MB`,
      );
    } else if (snapshot.usedMB >= warningMB!) {
      this.options.onAlert?.(
        'warning',
        snapshot,
        `内存使用 ${snapshot.usedMB.toFixed(1)}MB 超过警告阈值 ${warningMB}MB`,
      );
    }

    // 检测内存泄漏
    const leak = this.detectLeak();
    if (leak.leaking && leak.message) {
      this.options.onAlert?.('warning', snapshot, leak.message);
    }
  }
}

// ==================== 临时文件清理器 ====================

export type TempFileCleanerOptions = {
  /** 临时文件最大存活时间（毫秒），默认 24 小时 */
  maxAgeMs?: number;
  /** 临时目录最大大小（MB），默认 100MB */
  maxSizeMB?: number;
  /** 清理间隔（毫秒），默认 1 小时 */
  cleanIntervalMs?: number;
  /** 获取临时文件列表函数 */
  listFiles: () => Promise<Array<{ uri: string; size: number; createdAt: number }>>;
  /** 删除文件函数 */
  deleteFile: (uri: string) => Promise<boolean>;
  /** 清理回调 */
  onClean?: (deletedCount: number, freedSizeMB: number) => void;
};

export class TempFileCleaner {
  private readonly options: Required<Omit<TempFileCleanerOptions, 'onClean'>> & {
    onClean?: TempFileCleanerOptions['onClean'];
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(options: TempFileCleanerOptions) {
    this.options = {
      maxAgeMs: options.maxAgeMs ?? 24 * 60 * 60 * 1000,
      maxSizeMB: options.maxSizeMB ?? 100,
      cleanIntervalMs: options.cleanIntervalMs ?? 60 * 60 * 1000,
      listFiles: options.listFiles,
      deleteFile: options.deleteFile,
      onClean: options.onClean,
    };
  }

  /** 开始定期清理。 */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.clean().catch(() => undefined);
    }, this.options.cleanIntervalMs);
  }

  /** 停止定期清理。 */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 执行一次清理。 */
  async clean(): Promise<{ deletedCount: number; freedSizeMB: number }> {
    const files = await this.options.listFiles();
    const now = Date.now();
    let deletedCount = 0;
    let freedSize = 0;

    // 按创建时间排序（最旧的在前）
    const sorted = [...files].sort((a, b) => a.createdAt - b.createdAt);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    for (const file of sorted) {
      const age = now - file.createdAt;
      const shouldDeleteByAge = age > this.options.maxAgeMs;
      const shouldDeleteBySize = totalSize - freedSize > this.options.maxSizeMB * 1024 * 1024;

      if (shouldDeleteByAge || shouldDeleteBySize) {
        try {
          const deleted = await this.options.deleteFile(file.uri);
          if (deleted) {
            deletedCount += 1;
            freedSize += file.size;
          }
        } catch {
          // 忽略删除失败
        }
      }
    }

    const freedSizeMB = freedSize / 1024 / 1024;
    this.options.onClean?.(deletedCount, freedSizeMB);
    return { deletedCount, freedSizeMB };
  }

  /** 销毁清理器。 */
  destroy(): void {
    this.stop();
  }
}
