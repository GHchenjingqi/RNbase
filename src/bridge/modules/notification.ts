/**
 * notification 桥接模块（Phase 5 / 规范 §12）。
 *
 * 提供推送 token 获取、角标设置、提示音播放、通知栏消息发送。
 * 推送通道（FCM/APNs/厂商推送）在 Phase 12 实现，
 * 此处提供协议层接口，未接入时返回 DEVICE_UNSUPPORTED。
 *
 * H5 调用：
 *   Native.notification.getToken() -> { token: string | null }
 *   Native.notification.setBadge({ count: 3 })
 *   Native.notification.playSound() -> { ok: boolean }
 *   Native.notification.sendNotification({ title, content, payload }) -> { ok, notificationId }
 *   Native.notification.getPendingNotification() -> { payload: string }   // 通知深链，取一次即清
 */
import { BridgeException } from '../bridge-error';
import type { BridgeServer } from '../bridge-server';

/** 深链负载上限（字符数）：它要进 PendingIntent 的 extra，超大值会让系统侧事务超限。 */
const MAX_PAYLOAD_LENGTH = 512;

/** 归一化深链负载：非字符串 / 空 / 超长一律收敛，超长直接丢弃（回空串=不深链）。 */
function normalizePayload(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.trim();
  if (!text || text.length > MAX_PAYLOAD_LENGTH) {
    return '';
  }
  return text;
}

export type NotificationAdapter = {
  getToken?: () => Promise<string | null>;
  setBadge?: (count: number) => Promise<boolean>;
  playSound?: () => Promise<{ ok: boolean }>;
  sendNotification?: (
    title: string,
    content: string,
    payload?: string,
  ) => Promise<{ ok: boolean; notificationId?: number }>;
  /**
   * 取走待消费的通知深链负载（安卓实现，取一次即清）。
   * 只有安卓原生有这个方法，适配器按存在与否注册；缺失时本模块报 DEVICE_UNSUPPORTED。
   */
  getPendingNotification?: () => Promise<{ payload?: string | null }>;
};

export function registerNotificationModule(
  server: BridgeServer,
  adapter: NotificationAdapter = {},
): void {
  server.registerModule('notification', {
    async getToken() {
      if (!adapter.getToken) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '推送能力未接入');
      }
      const token = await adapter.getToken();
      return { token };
    },

    async setBadge(params) {
      const p = params as { count?: number } | undefined;
      const count = p?.count ?? 0;
      if (count < 0) {
        throw new BridgeException('INVALID_PARAMS', 'count 不能为负数');
      }
      if (!adapter.setBadge) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '角标能力未接入');
      }
      const ok = await adapter.setBadge(count);
      return { ok };
    },

    async playSound() {
      if (!adapter.playSound) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '提示音能力未接入');
      }
      return adapter.playSound();
    },

    async sendNotification(params) {
      const p = params as { title?: string; content?: string; payload?: unknown } | undefined;
      const title = p?.title ?? '';
      const content = p?.content ?? '';
      if (!content) {
        throw new BridgeException('INVALID_PARAMS', 'content 不能为空');
      }
      if (!adapter.sendNotification) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '通知能力未接入');
      }
      return adapter.sendNotification(title, content, normalizePayload(p?.payload));
    },

    /**
     * 通知深链：取走原生暂存的负载（一次性，取走即清）。
     * 为什么让 H5 主动拉而不是原生把页面推进去：冷启动时 H5 还没起来，推过去必然丢。
     * 返回值固定为 { payload: string }，无负载时是空串，由 H5 自己判空与解析。
     */
    async getPendingNotification() {
      if (!adapter.getPendingNotification) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '通知深链能力未接入');
      }
      const res = await adapter.getPendingNotification();
      return { payload: normalizePayload(res?.payload) };
    },
  });
}
