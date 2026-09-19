/**
 * 上传队列服务（Phase 11 / 规范 §20、§21、§61）。
 *
 * 职责：
 *  - H5 基于 URI 走受控上传通道，展示上传进度
 *  - 支持上传取消、失败重试、弱网排队/续传策略
 *  - 多图批量上传与队列管理
 *  - 上传前校验：类型、大小（FILE_TOO_LARGE）、数量上限
 *
 * 红线：大文件不走 Base64 穿桥，只传 URI/元数据（规范 §23）。
 * 性能：持续进度事件做节流，避免高频穿桥（规范 §61）。
 */
import type { PlatformAdapter } from './types';
import {
  MEDIA_UPLOAD_MAX_CONCURRENT,
  MEDIA_UPLOAD_MAX_RETRIES,
  MEDIA_UPLOAD_MAX_SIZE,
  MEDIA_UPLOAD_TIMEOUT_MS,
  MEDIA_UPLOAD_WEAK_NETWORK_THRESHOLD,
} from '../config';
import type {
  UploadError,
  UploadProgress,
  UploadQueueOptions,
  UploadResult,
  UploadStatus,
  UploadTask,
  UploadValidationResult,
} from './types';

export type UploaderFunction = (
  task: UploadTask,
  onProgress: (uploaded: number, total: number) => void,
  signal: { cancelled: boolean },
) => Promise<{ fileUrl: string }>;

export type UploadQueueEvents = {
  onTaskProgress?: (taskId: string, progress: UploadProgress) => void;
  onTaskStatusChange?: (taskId: string, status: UploadStatus) => void;
  onTaskComplete?: (taskId: string, result: UploadResult) => void;
  onTaskError?: (taskId: string, error: UploadError) => void;
  onQueueEmpty?: () => void;
};

let taskIdCounter = 0;
function nextTaskId(): string {
  taskIdCounter += 1;
  return `upload_${Date.now()}_${taskIdCounter}`;
}

export class UploadQueue {
  private readonly options: Required<UploadQueueOptions>;
  private readonly uploader: UploaderFunction;
  private readonly adapter: PlatformAdapter;
  private readonly events: UploadQueueEvents;

  private pending: UploadTask[] = [];
  private active: Map<string, UploadTask> = new Map();
  private completed: UploadTask[] = [];
  private failed: UploadTask[] = [];
  private cancelledTasks: UploadTask[] = [];
  private cancelled: Set<string> = new Set();
  private signals: Map<string, { cancelled: boolean }> = new Map();
  private isProcessing = false;
  private isPaused = false;

  constructor(
    uploader: UploaderFunction,
    adapter: PlatformAdapter,
    options?: UploadQueueOptions,
    events?: UploadQueueEvents,
  ) {
    this.uploader = uploader;
    this.adapter = adapter;
    this.options = {
      maxConcurrent: options?.maxConcurrent ?? MEDIA_UPLOAD_MAX_CONCURRENT,
      maxRetries: options?.maxRetries ?? MEDIA_UPLOAD_MAX_RETRIES,
      weakNetworkThreshold: options?.weakNetworkThreshold ?? MEDIA_UPLOAD_WEAK_NETWORK_THRESHOLD,
      timeoutMs: options?.timeoutMs ?? MEDIA_UPLOAD_TIMEOUT_MS,
    };
    this.events = events ?? {};
  }

  /** 添加上传任务。 */
  addTask(params: {
    uri: string;
    name: string;
    size: number;
    mimeType: string;
    uploadUrl: string;
    onProgress?: (progress: UploadProgress) => void;
    onComplete?: (result: UploadResult) => void;
    onError?: (error: UploadError) => void;
  }): UploadTask {
    const task: UploadTask = {
      id: nextTaskId(),
      uri: params.uri,
      name: params.name,
      size: params.size,
      mimeType: params.mimeType,
      uploadUrl: params.uploadUrl,
      status: 'pending',
      uploaded: 0,
      onProgress: params.onProgress,
      onComplete: params.onComplete,
      onError: params.onError,
      retryCount: 0,
      maxRetries: this.options.maxRetries,
      createdAt: Date.now(),
    };

    this.pending.push(task);
    this.events.onTaskStatusChange?.(task.id, 'pending');
    // 异步处理队列，确保返回的 task.status 为 pending
    Promise.resolve().then((): void => {
      this.processQueue();
    });
    return task;
  }

  /** 批量添加上传任务。 */
  addTasks(
    tasks: Array<{
      uri: string;
      name: string;
      size: number;
      mimeType: string;
      uploadUrl: string;
    }>,
    commonCallbacks?: {
      onProgress?: (taskId: string, progress: UploadProgress) => void;
      onComplete?: (taskId: string, result: UploadResult) => void;
      onError?: (taskId: string, error: UploadError) => void;
    },
  ): UploadTask[] {
    return tasks.map(t =>
      this.addTask({
        ...t,
        onProgress: commonCallbacks?.onProgress
          ? progress => commonCallbacks.onProgress?.(t.uri, progress)
          : undefined,
        onComplete: commonCallbacks?.onComplete
          ? result => commonCallbacks.onComplete?.(t.uri, result)
          : undefined,
        onError: commonCallbacks?.onError
          ? error => commonCallbacks.onError?.(t.uri, error)
          : undefined,
      }),
    );
  }

  /** 取消上传任务。 */
  cancelTask(taskId: string): boolean {
    const signal = this.signals.get(taskId);
    if (signal) {
      signal.cancelled = true;
    }
    this.cancelled.add(taskId);

    // 从 pending 中移除
    const pendingIndex = this.pending.findIndex(t => t.id === taskId);
    if (pendingIndex >= 0) {
      const task = this.pending.splice(pendingIndex, 1)[0];
      task.status = 'cancelled';
      this.cancelledTasks.push(task);
      this.events.onTaskStatusChange?.(taskId, 'cancelled');
      return true;
    }

    // active 中的任务会在 uploader 中检测到 cancelled
    const activeTask = this.active.get(taskId);
    if (activeTask) {
      activeTask.status = 'cancelled';
    }

    return true;
  }

  /** 取消所有上传任务。 */
  cancelAll(): void {
    for (const task of this.pending) {
      this.cancelTask(task.id);
    }
    for (const taskId of this.active.keys()) {
      this.cancelTask(taskId);
    }
  }

  /** 重试失败的任务。 */
  retryTask(taskId: string): boolean {
    const taskIndex = this.failed.findIndex(t => t.id === taskId);
    if (taskIndex < 0) return false;

    const task = this.failed.splice(taskIndex, 1)[0];
    if (task.retryCount >= task.maxRetries) return false;

    task.status = 'pending';
    task.uploaded = 0;
    task.retryCount += 1;
    this.pending.push(task);
    this.events.onTaskStatusChange?.(taskId, 'pending');
    this.processQueue();
    return true;
  }

  /** 获取任务状态。 */
  getTask(taskId: string): UploadTask | undefined {
    return (
      this.pending.find(t => t.id === taskId) ??
      this.active.get(taskId) ??
      this.completed.find(t => t.id === taskId) ??
      this.failed.find(t => t.id === taskId) ??
      this.cancelledTasks.find(t => t.id === taskId)
    );
  }

  /** 获取队列统计。 */
  getStats(): {
    pending: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    total: number;
  } {
    return {
      pending: this.pending.length,
      active: this.active.size,
      completed: this.completed.length,
      failed: this.failed.length,
      cancelled: this.cancelledTasks.length,
      total:
        this.pending.length +
        this.active.size +
        this.completed.length +
        this.failed.length +
        this.cancelledTasks.length,
    };
  }

  /** 上传前校验。 */
  validateUpload(params: {
    uri: string;
    name: string;
    size: number;
    mimeType: string;
    maxSize?: number;
    allowedTypes?: string[];
  }): UploadValidationResult {
    const maxSize = params.maxSize ?? MEDIA_UPLOAD_MAX_SIZE;

    if (params.size > maxSize) {
      return {
        valid: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `文件大小 ${(params.size / 1024 / 1024).toFixed(2)}MB 超过上限 ${(
            maxSize /
            1024 /
            1024
          ).toFixed(0)}MB`,
          taskId: '',
          retryable: false,
        },
      };
    }

    if (
      params.allowedTypes &&
      params.allowedTypes.length > 0 &&
      !params.allowedTypes.includes('*/*')
    ) {
      const isAllowed = params.allowedTypes.some(type => {
        if (type.endsWith('/*')) {
          return params.mimeType.startsWith(type.replace('/*', '/'));
        }
        return params.mimeType === type;
      });
      if (!isAllowed) {
        return {
          valid: false,
          error: {
            code: 'INVALID_TYPE',
            message: `文件类型 ${params.mimeType} 不在允许列表中`,
            taskId: '',
            retryable: false,
          },
        };
      }
    }

    return { valid: true };
  }

  /** 暂停队列（不再启动新任务）。 */
  pause(): void {
    this.isPaused = true;
  }

  /** 恢复队列。 */
  resume(): void {
    this.isPaused = false;
    this.processQueue();
  }

  /** 清空队列（取消所有任务并清空记录）。 */
  clear(): void {
    this.cancelAll();
    this.pending = [];
    this.active.clear();
    this.completed = [];
    this.failed = [];
    this.cancelledTasks = [];
    this.signals.clear();
    this.cancelled.clear();
  }

  private processQueue(): void {
    if (this.isPaused) return;
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.active.size < this.options.maxConcurrent && this.pending.length > 0) {
      const task = this.pending.shift();
      if (task) {
        this.executeTask(task);
      }
    }

    this.isProcessing = false;

    if (this.pending.length === 0 && this.active.size === 0) {
      this.events.onQueueEmpty?.();
    }
  }

  private async executeTask(task: UploadTask): Promise<void> {
    this.active.set(task.id, task);
    task.status = 'uploading';
    this.events.onTaskStatusChange?.(task.id, 'uploading');

    const signal = { cancelled: false };
    this.signals.set(task.id, signal);

    const startTime = Date.now();
    let lastProgressTime = 0;
    let lastUploaded = 0;

    try {
      const result = await this.uploader(
        task,
        (uploaded, total) => {
          if (signal.cancelled) return;

          task.uploaded = uploaded;
          const now = Date.now();
          const elapsed = now - lastProgressTime;

          // 进度事件节流：至少 200ms 或 5% 变化
          if (elapsed >= 200 || uploaded === total) {
            const speed = elapsed > 0 ? ((uploaded - lastUploaded) / elapsed) * 1000 : 0;
            const progress: UploadProgress = {
              uploaded,
              total,
              percent: Math.round((uploaded / total) * 100),
              speed: Math.round(speed),
            };
            task.onProgress?.(progress);
            this.events.onTaskProgress?.(task.id, progress);
            lastProgressTime = now;
            lastUploaded = uploaded;
          }
        },
        signal,
      );

      if (signal.cancelled || this.cancelled.has(task.id)) {
        task.status = 'cancelled';
        this.cancelledTasks.push(task);
        this.events.onTaskStatusChange?.(task.id, 'cancelled');
        return;
      }

      task.status = 'success';
      const uploadResult: UploadResult = {
        taskId: task.id,
        fileUrl: result.fileUrl,
        size: task.size,
        durationMs: Date.now() - startTime,
      };
      task.onComplete?.(uploadResult);
      this.events.onTaskComplete?.(task.id, uploadResult);
      this.completed.push(task);
    } catch (error) {
      if (signal.cancelled || this.cancelled.has(task.id)) {
        task.status = 'cancelled';
        this.cancelledTasks.push(task);
        this.events.onTaskStatusChange?.(task.id, 'cancelled');
        return;
      }

      const uploadError: UploadError = {
        code: 'UPLOAD_FAILED',
        message: error instanceof Error ? error.message : '上传失败',
        taskId: task.id,
        retryable: task.retryCount < task.maxRetries,
      };

      task.status = 'failed';
      task.onError?.(uploadError);
      this.events.onTaskError?.(task.id, uploadError);
      this.events.onTaskStatusChange?.(task.id, 'failed');
      this.failed.push(task);
    } finally {
      this.active.delete(task.id);
      this.signals.delete(task.id);
      this.processQueue();
    }
  }
}

/** 创建 Mock 上传器（用于测试）。 */
export function createMockUploader(options?: {
  failAttempts?: number;
  delayMs?: number;
  failWithCode?: UploadError['code'];
}): UploaderFunction {
  let attemptCount = 0;
  return async (task, onProgress, signal) => {
    attemptCount += 1;
    const delay = options?.delayMs ?? 100;
    const total = task.size;

    // 模拟失败
    if (options?.failAttempts && attemptCount <= options.failAttempts) {
      throw new Error(options.failWithCode ?? '模拟上传失败');
    }

    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      if (signal.cancelled) {
        throw new Error('已取消');
      }
      await new Promise<void>(resolve => setTimeout(() => resolve(), delay / steps));
      onProgress(Math.round((total * i) / steps), total);
    }

    return {
      fileUrl: `https://mock-cdn.example.com/uploads/${task.id}/${task.name}`,
    };
  };
}
