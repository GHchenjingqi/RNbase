/**
 * Bridge 事件总线（对应 Phase 3 / 规范 §62）。
 *
 * 负责 RN→H5 的事件推送：
 *  - 网络状态变化（network.changed）
 *  - 应用生命周期（app.lifecycle: active/inactive/background/foreground）
 *  - 推送通知（notification.received）
 *  - 其他原生事件
 *
 * H5 侧通过 Native.on(event, handler) 订阅，返回 unsubscribe() 函数。
 * RN 侧通过 emit(event, data) 推送事件到所有订阅者。
 */
import type { BridgeEvent } from './protocol';

export type BridgeEventHandler = (data: unknown) => void;

export class BridgeEventBus {
  private readonly subscribers = new Map<string, Set<BridgeEventHandler>>();
  /** 全局事件监听器（用于 WebView postMessage 推送）。 */
  private globalListener: ((event: BridgeEvent) => void) | null = null;

  /**
   * 订阅事件。
   * @returns unsubscribe 函数，调用后取消订阅
   */
  on(event: string, handler: BridgeEventHandler): () => void {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event)!.add(handler);

    return () => {
      this.off(event, handler);
    };
  }

  /**
   * 取消订阅。
   */
  off(event: string, handler: BridgeEventHandler): void {
    const set = this.subscribers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.subscribers.delete(event);
      }
    }
  }

  /**
   * 一次性订阅（触发一次后自动取消）。
   */
  once(event: string, handler: BridgeEventHandler): () => void {
    const wrapper = (data: unknown) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * 推送事件到所有订阅者。
   * 同时通知全局监听器（用于 WebView 推送）。
   */
  emit(event: string, data: unknown = null): void {
    const bridgeEvent: BridgeEvent = {
      type: 'event',
      event,
      data,
      timestamp: Date.now(),
    };

    // 通知本地订阅者
    const handlers = this.subscribers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {
          // 单个 handler 异常不影响其他订阅者
        }
      }
    }

    // 通知全局监听器（WebView postMessage）
    if (this.globalListener) {
      try {
        this.globalListener(bridgeEvent);
      } catch {
        // 全局监听器异常不影响事件总线
      }
    }
  }

  /**
   * 设置全局事件监听器（由 WebViewBridge 注入，用于 postMessage 推送）。
   */
  setGlobalListener(listener: (event: BridgeEvent) => void): void {
    this.globalListener = listener;
  }

  /**
   * 清除全局监听器。
   */
  clearGlobalListener(): void {
    this.globalListener = null;
  }

  /**
   * 清除所有订阅者（H5 页面 reload / 切后台时调用）。
   */
  clear(): void {
    this.subscribers.clear();
  }

  /**
   * 获取指定事件的订阅者数量（用于测试/诊断）。
   */
  listenerCount(event: string): number {
    return this.subscribers.get(event)?.size ?? 0;
  }

  /**
   * 获取所有有订阅者的事件名（用于测试/诊断）。
   */
  eventNames(): string[] {
    return Array.from(this.subscribers.keys());
  }
}

/** 全局单例事件总线。 */
export const bridgeEventBus = new BridgeEventBus();
