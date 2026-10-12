/**
 * 启动失败检测器（Phase 8 / 规范 §8、§9）。
 *
 * 职责：
 *  - 监听 WebView load error / JS crash / handshake 失败 / READY 超时
 *  - 检测到启动失败时触发 RollbackManager.handleBootFailure()
 *  - 提供启动确认（markReady）接口
 *
 * 与 WebView 解耦：通过事件回调注入，便于单测。
 */
import type { BootFailureReason, RollbackManager } from './rollback-manager';
import { UPDATE_READY_TIMEOUT_MS } from '../config';

export type BootDetectorOptions = {
  rollbackManager: RollbackManager;
  /** READY 超时时间（毫秒），默认 15000 */
  readyTimeoutMs?: number;
  /** 启动失败回调（在回滚前调用，可用于日志/上报） */
  onFailure?: (reason: BootFailureReason, details?: string) => void;
  /** 启动成功回调 */
  onSuccess?: () => void;
};

export type BootEvent =
  | { type: 'webview_load_error'; details?: string }
  | { type: 'js_crash'; details?: string }
  | { type: 'handshake_failed'; details?: string }
  | { type: 'ready' }
  | { type: 'webview_loaded' };

export class BootFailureDetector {
  private readonly options: Required<Omit<BootDetectorOptions, 'onFailure' | 'onSuccess'>> & {
    onFailure?: BootDetectorOptions['onFailure'];
    onSuccess?: BootDetectorOptions['onSuccess'];
  };
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private resolved = false;
  private webViewLoaded = false;

  constructor(options: BootDetectorOptions) {
    this.options = {
      rollbackManager: options.rollbackManager,
      readyTimeoutMs: options.readyTimeoutMs ?? UPDATE_READY_TIMEOUT_MS,
      onFailure: options.onFailure,
      onSuccess: options.onSuccess,
    };
  }

  /**
   * 开始监控启动过程。
   * 在新版本激活后、WebView 加载前调用。
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.resolved = false;
    this.webViewLoaded = false;

    // 启动 READY 超时计时器
    this.readyTimer = setTimeout(() => {
      if (!this.resolved) {
        this.handleFailure('ready_timeout', 'H5 READY 确认超时');
      }
    }, this.options.readyTimeoutMs);
  }

  /**
   * 处理启动事件。
   * WebView 层调用此方法上报事件。
   */
  async handleEvent(event: BootEvent): Promise<void> {
    if (!this.started || this.resolved) return;

    switch (event.type) {
      case 'webview_loaded':
        this.webViewLoaded = true;
        break;
      case 'webview_load_error':
        await this.handleFailure('webview_load_error', event.details);
        break;
      case 'js_crash':
        await this.handleFailure('js_crash', event.details);
        break;
      case 'handshake_failed':
        await this.handleFailure('handshake_failed', event.details);
        break;
      case 'ready':
        await this.handleReady();
        break;
    }
  }

  /**
   * 手动标记启动成功（READY 确认）。
   * 与 handleEvent({type: 'ready'}) 等价。
   */
  async markReady(): Promise<void> {
    await this.handleReady();
  }

  /**
   * 手动触发启动失败（用于测试或外部检测）。
   */
  async triggerFailure(reason: BootFailureReason, details?: string): Promise<void> {
    await this.handleFailure(reason, details);
  }

  /** 停止监控（启动成功或回滚完成后调用）。 */
  stop(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.started = false;
  }

  /** 是否已解析（成功或失败）。 */
  isResolved(): boolean {
    return this.resolved;
  }

  /** WebView 是否已加载。 */
  isWebViewLoaded(): boolean {
    return this.webViewLoaded;
  }

  private async handleReady(): Promise<void> {
    if (this.resolved) return;
    this.resolved = true;
    this.stop();
    await this.options.rollbackManager.markReady();
    this.options.onSuccess?.();
  }

  private async handleFailure(reason: BootFailureReason, details?: string): Promise<void> {
    if (this.resolved) return;
    this.resolved = true;
    this.stop();
    this.options.onFailure?.(reason, details);
    await this.options.rollbackManager.handleBootFailure(reason);
  }
}

/**
 * 创建 WebView 事件适配器（将 react-native-webview 的事件转换为 BootEvent）。
 * 用于在 WebViewBridge 中集成。
 */
export function createWebViewBootAdapter(detector: BootFailureDetector) {
  return {
    onLoadEnd: () => detector.handleEvent({ type: 'webview_loaded' }),
    onError: (syntheticEvent: { nativeEvent: { description?: string } }) =>
      detector.handleEvent({
        type: 'webview_load_error',
        details: syntheticEvent.nativeEvent.description,
      }),
    onHttpError: (syntheticEvent: {
      nativeEvent: { statusCode?: number; description?: string };
    }) => {
      // 只有主页加载失败才视为启动失败，资源加载失败不触发回滚
      if (syntheticEvent.nativeEvent.statusCode && syntheticEvent.nativeEvent.statusCode >= 500) {
        detector.handleEvent({
          type: 'webview_load_error',
          details: `HTTP ${syntheticEvent.nativeEvent.statusCode}: ${syntheticEvent.nativeEvent.description}`,
        });
      }
    },
    onMessage: (event: { nativeEvent: { data: string } }) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'event' && data.event === 'app.ready') {
          detector.handleEvent({ type: 'ready' });
        }
      } catch {
        // 非 JSON 消息忽略
      }
    },
  };
}
