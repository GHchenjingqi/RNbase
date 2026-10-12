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
 *   Native.notification.sendNotification({ title, content }) -> { ok, notificationId }
 */
import { BridgeException } from '../bridge-error';
import type { BridgeServer } from '../bridge-server';

export type NotificationAdapter = {
  getToken?: () => Promise<string | null>;
  setBadge?: (count: number) => Promise<boolean>;
  playSound?: () => Promise<{ ok: boolean }>;
  sendNotification?: (
    title: string,
    content: string,
  ) => Promise<{ ok: boolean; notificationId?: number }>;
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
      const p = params as { title?: string; content?: string } | undefined;
      const title = p?.title ?? '';
      const content = p?.content ?? '';
      if (!content) {
        throw new BridgeException('INVALID_PARAMS', 'content 不能为空');
      }
      if (!adapter.sendNotification) {
        throw new BridgeException('DEVICE_UNSUPPORTED', '通知能力未接入');
      }
      return adapter.sendNotification(title, content);
    },
  });
}
