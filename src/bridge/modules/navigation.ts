/**
 * navigation 桥接模块：外部导航（打开浏览器/Deep Link/电话/短信/邮件）。
 *
 * 纯 RN 实现：Linking API。
 */
import { Linking, Platform } from 'react-native';
import type { BridgeServer } from '../bridge-server';
import { BridgeException } from '../bridge-error';

export function registerNavigationModule(server: BridgeServer): void {
  server.registerModule('navigation', {
    /**
     * 打开外部 URL（浏览器/电话/短信/邮件/Deep Link）。
     * H5 调用：RN.NAVIGATION.OPENURL({ url: 'https://...' })
     */
    async openUrl(params) {
      const p = params as { url?: string } | undefined;
      if (!p?.url) {
        throw new BridgeException('INVALID_PARAMS', 'url 不能为空');
      }
      const supported = await Linking.canOpenURL(p.url);
      if (!supported) {
        throw new BridgeException('DEVICE_UNSUPPORTED', `不支持的 URL: ${p.url}`);
      }
      await Linking.openURL(p.url);
      return { ok: true };
    },

    /** 检测是否可以打开某个 URL。 */
    async canOpenUrl(params) {
      const p = params as { url?: string } | undefined;
      if (!p?.url) {
        throw new BridgeException('INVALID_PARAMS', 'url 不能为空');
      }
      const supported = await Linking.canOpenURL(p.url);
      return { supported };
    },

    /** 拨打电话。 */
    async call(params) {
      const p = params as { phoneNumber?: string } | undefined;
      if (!p?.phoneNumber) {
        throw new BridgeException('INVALID_PARAMS', 'phoneNumber 不能为空');
      }
      const url = `tel:${p.phoneNumber}`;
      await Linking.openURL(url);
      return { ok: true };
    },

    /** 发送短信。 */
    async sms(params) {
      const p = params as { phoneNumber?: string; body?: string } | undefined;
      if (!p?.phoneNumber) {
        throw new BridgeException('INVALID_PARAMS', 'phoneNumber 不能为空');
      }
      const url =
        Platform.OS === 'ios'
          ? `sms:${p.phoneNumber}&body=${encodeURIComponent(p.body ?? '')}`
          : `sms:${p.phoneNumber}?body=${encodeURIComponent(p.body ?? '')}`;
      await Linking.openURL(url);
      return { ok: true };
    },

    /** 发送邮件。 */
    async email(params) {
      const p = params as
        | {
            to?: string[];
            subject?: string;
            body?: string;
            cc?: string[];
            bcc?: string[];
          }
        | undefined;
      if (!p?.to || p.to.length === 0) {
        throw new BridgeException('INVALID_PARAMS', 'to 不能为空');
      }
      const query = new URLSearchParams();
      if (p.subject) query.set('subject', p.subject);
      if (p.body) query.set('body', p.body);
      if (p.cc) query.set('cc', p.cc.join(','));
      if (p.bcc) query.set('bcc', p.bcc.join(','));
      const url = `mailto:${p.to.join(',')}?${query.toString()}`;
      await Linking.openURL(url);
      return { ok: true };
    },

    /** 获取 App 启动时的初始 URL（Deep Link 冷启动）。 */
    async getInitialUrl() {
      const url = await Linking.getInitialURL();
      return { url: url ?? null };
    },
  });
}
