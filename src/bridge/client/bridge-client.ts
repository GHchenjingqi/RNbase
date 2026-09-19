/**
 * Bridge 客户端（H5 侧），对应 Phase 4 / 规范 §13/§14/§62。
 *
 * Promise 化请求、请求编号、超时、重复 requestId 防护、事件订阅。
 *
 * 新增能力（Phase 4 完整实现）：
 *  - 事件订阅：on(event, handler) / off(event, handler) / once(event, handler)
 *  - 能力检测：getCapabilities() / supports(feature)
 *  - 环境自动探测：RN WebView → rnWebViewTransport；浏览器 → browserMockTransport
 */
import type { BridgeEvent, BridgeModule, BridgeRequest, BridgeResponse } from '../protocol';
import type { BridgeTransport } from './types';
import { BRIDGE_TIMEOUT_MS } from '../../config';

type Pending = {
  resolve: (data: unknown) => void;
  reject: (error: { code: string; message: string }) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type BridgeClientOptions = {
  timeoutMs?: number;
  bridgeVersion?: string;
};

export type EventHandler = (data: unknown) => void;

export class BridgeClient {
  private readonly transport: BridgeTransport;
  private readonly pending = new Map<string, Pending>();
  private readonly eventHandlers = new Map<string, Set<EventHandler>>();
  private readonly timeoutMs: number;
  private readonly bridgeVersion: string;
  private seq = 0;
  private unsubscribe: (() => void) | null = null;
  private capabilities: Record<string, boolean> | null = null;

  constructor(transport: BridgeTransport, options: BridgeClientOptions = {}) {
    this.transport = transport;
    this.timeoutMs = options.timeoutMs ?? BRIDGE_TIMEOUT_MS;
    this.bridgeVersion = options.bridgeVersion ?? '1.0.0';
    this.unsubscribe = transport.subscribe(raw => this.handleMessage(raw));
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
    }
    this.pending.clear();
    this.eventHandlers.clear();
  }

  request<D = unknown>(module: BridgeModule, action: string, params?: unknown): Promise<D> {
    const id = `req_${++this.seq}_${Date.now()}`;
    const req: BridgeRequest = {
      type: 'request',
      id,
      version: this.bridgeVersion,
      module,
      action,
      params,
    };

    return new Promise<D>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject({ code: 'TIMEOUT', message: 'Bridge 调用超时' });
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
      });

      try {
        this.transport.send(JSON.stringify(req));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject({ code: 'NATIVE_ERROR', message: '发送 Bridge 消息失败' });
      }
    });
  }

  /**
   * 订阅 RN→H5 事件（规范 §62）。
   * @returns unsubscribe 函数
   */
  on(event: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  /** 取消订阅事件。 */
  off(event: string, handler: EventHandler): void {
    const set = this.eventHandlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  /** 一次性订阅事件。 */
  once(event: string, handler: EventHandler): () => void {
    const wrapper: EventHandler = data => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * 获取设备能力清单（规范 §16）。
   * 首次调用时从 Native 获取并缓存。
   */
  async getCapabilities(): Promise<Record<string, boolean>> {
    if (this.capabilities) return this.capabilities;
    try {
      const result = await this.request<{ features?: Record<string, boolean> }>(
        'app',
        'getCapabilities',
      );
      this.capabilities = result.features ?? {};
      return this.capabilities;
    } catch {
      this.capabilities = {};
      return {};
    }
  }

  /**
   * 检测指定能力是否可用（规范 §16/§17）。
   * 能力缺失时业务应降级处理。
   */
  async supports(feature: string): Promise<boolean> {
    const caps = await this.getCapabilities();
    return caps[feature] === true;
  }

  /** 清除能力缓存（用于测试或能力变化时）。 */
  clearCapabilitiesCache(): void {
    this.capabilities = null;
  }

  private handleMessage(raw: string): void {
    let message: BridgeResponse | BridgeEvent;
    try {
      message = JSON.parse(raw) as BridgeResponse | BridgeEvent;
    } catch {
      return;
    }

    // 处理事件消息（RN→H5）
    if (message.type === 'event') {
      const evt = message as BridgeEvent;
      const handlers = this.eventHandlers.get(evt.event);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(evt.data);
          } catch {
            // 单个 handler 异常不影响其他订阅者
          }
        }
      }
      return;
    }

    // 处理响应消息
    const res = message as BridgeResponse;
    if (!res || res.type !== 'response' || typeof res.id !== 'string') {
      return;
    }
    const pending = this.pending.get(res.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(res.id);

    if (res.success) {
      pending.resolve(res.data);
    } else {
      const err = res.error ?? { code: 'UNKNOWN_ERROR', message: '未知错误' };
      pending.reject({ code: err.code, message: err.message });
    }
  }
}
