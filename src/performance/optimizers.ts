/**
 * 高频事件节流器与批量请求合并器（Phase 14 / 规范 §61）。
 *
 * 职责：
 *  - Throttler：高频事件节流（位置等持续事件采用节流/批量），
 *    禁止每 10ms 级别的穿桥事件（规范 §61 红线）。
 *  - BatchRequester：减少 Bridge 往返，可合并的请求提供批量接口。
 */
import type { ThrottleOptions, BatchOptions } from './types';

// ==================== 节流器 ====================

export class Throttler<T = unknown> {
  private readonly options: Required<ThrottleOptions>;
  private readonly callback: (args: T) => void;
  private lastExecuteTime = 0;
  private firstCallTime = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastArgs: T | null = null;

  constructor(callback: (args: T) => void, options?: ThrottleOptions) {
    this.callback = callback;
    this.options = {
      minIntervalMs: options?.minIntervalMs ?? 100,
      maxWaitMs: options?.maxWaitMs ?? 1000,
      leading: options?.leading ?? false,
      trailing: options?.trailing ?? true,
    };
  }

  /** 触发节流调用。 */
  call(args: T): void {
    const now = Date.now();
    this.lastArgs = args;

    // 首次调用
    if (this.lastExecuteTime === 0) {
      this.firstCallTime = now;
      // 设置 maxWait 定时器
      if (this.options.maxWaitMs > 0 && !this.maxWaitTimer) {
        this.maxWaitTimer = setTimeout(() => {
          this.maxWaitTimer = null;
          if (this.lastArgs) {
            this.execute(this.lastArgs);
          }
        }, this.options.maxWaitMs);
      }

      if (this.options.leading) {
        // leading：首次立即执行
        this.execute(args);
      } else if (this.options.trailing) {
        // 非 leading：安排 trailing 执行
        this.timer = setTimeout(() => {
          this.timer = null;
          if (this.lastArgs) {
            this.execute(this.lastArgs);
          }
        }, this.options.minIntervalMs);
      }
      return;
    }

    const elapsed = now - this.lastExecuteTime;

    if (elapsed >= this.options.minIntervalMs) {
      this.execute(args);
    } else {
      // 安排 trailing 执行
      if (this.options.trailing && !this.timer) {
        const remaining = this.options.minIntervalMs - elapsed;
        this.timer = setTimeout(() => {
          this.timer = null;
          if (this.lastArgs) {
            this.execute(this.lastArgs);
          }
        }, remaining);
      }
    }
  }

  /** 立即执行（忽略节流）。 */
  flush(): void {
    if (this.lastArgs) {
      this.execute(this.lastArgs);
    }
  }

  /** 取消待执行的调用。 */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    this.lastArgs = null;
    this.firstCallTime = 0;
  }

  /** 销毁节流器。 */
  destroy(): void {
    this.cancel();
  }

  private execute(args: T): void {
    this.lastExecuteTime = Date.now();
    this.firstCallTime = 0;
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.callback(args);
  }
}

// ==================== 批量请求合并器 ====================

type PendingItem = {
  id: string;
  data: unknown;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class BatchRequester {
  private readonly options: Required<Omit<BatchOptions, 'handler'>> & {
    handler: BatchOptions['handler'];
  };
  private pending: Map<string, PendingItem> = new Map();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  constructor(options: BatchOptions) {
    this.options = {
      maxBatchSize: options.maxBatchSize ?? 10,
      maxWaitMs: options.maxWaitMs ?? 100,
      handler: options.handler,
    };
  }

  /** 添加单个请求，返回 Promise。 */
  request<T = unknown>(data: T): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const item: PendingItem = {
        id,
        data,
        resolve,
        reject,
        timer: setTimeout(() => this.timeoutItem(id), this.options.maxWaitMs * 10),
      };

      this.pending.set(id, item);

      // 达到批量大小，立即处理
      if (this.pending.size >= this.options.maxBatchSize) {
        this.processBatch();
      } else if (!this.batchTimer) {
        // 安排批量处理
        this.batchTimer = setTimeout(() => this.processBatch(), this.options.maxWaitMs);
      }
    });
  }

  /** 立即处理所有待处理请求。 */
  flush(): void {
    this.processBatch();
  }

  /** 获取待处理请求数。 */
  pendingCount(): number {
    return this.pending.size;
  }

  /** 销毁批量请求器。 */
  destroy(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('BatchRequester destroyed'));
    }
    this.pending.clear();
  }

  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.pending.size === 0) return;

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    this.isProcessing = true;

    // 取出一批
    const items = Array.from(this.pending.values()).slice(0, this.options.maxBatchSize);
    for (const item of items) {
      this.pending.delete(item.id);
      clearTimeout(item.timer);
    }

    try {
      const results = await this.options.handler(
        items.map(item => ({ id: item.id, data: item.data })),
      );

      // 映射结果
      const resultMap = new Map(results.map(r => [r.id, r.result]));
      for (const item of items) {
        const result = resultMap.get(item.id);
        if (result !== undefined) {
          item.resolve(result);
        } else {
          item.reject(new Error(`No result for item ${item.id}`));
        }
      }
    } catch (error) {
      for (const item of items) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.isProcessing = false;
      // 如果还有待处理的，继续处理
      if (this.pending.size > 0) {
        this.processBatch();
      }
    }
  }

  private timeoutItem(id: string): void {
    const item = this.pending.get(id);
    if (item) {
      this.pending.delete(id);
      item.reject(new Error('Batch request timeout'));
    }
  }
}
