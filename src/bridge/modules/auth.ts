/**
 * auth 桥接模块（Phase 5 / 规范 §12）。
 *
 * 提供登录态获取与登出能力。安全存储细节（加密/Keychain/Keystore）在 Phase 9 实现，
 * 此处提供协议层接口与内存态存储，保证 H5 可调用。
 *
 * H5 调用：
 *   Native.auth.getToken() -> { token: string | null }
 *   Native.auth.getUser()  -> { user: Record | null }
 *   Native.auth.logout()   -> { ok: boolean }
 */
import { BridgeException } from '../bridge-error';
import type { BridgeServer } from '../bridge-server';

export type AuthStore = {
  getToken: () => string | null;
  getUser: () => Record<string, unknown> | null;
  logout: () => Promise<void> | void;
};

/** 默认内存态存储（Phase 9 替换为安全存储）。 */
export function createMemoryAuthStore(): AuthStore {
  let token: string | null = null;
  let user: Record<string, unknown> | null = null;
  return {
    getToken: () => token,
    getUser: () => user,
    logout: () => {
      token = null;
      user = null;
    },
  };
}

export function registerAuthModule(
  server: BridgeServer,
  store: AuthStore = createMemoryAuthStore(),
): void {
  server.registerModule('auth', {
    getToken() {
      return { token: store.getToken() };
    },

    getUser() {
      return { user: store.getUser() };
    },

    async logout() {
      try {
        await store.logout();
        // 登出后推送事件，H5 可监听跳转登录页
        server.emitEvent('auth.logout', { timestamp: Date.now() });
        return { ok: true };
      } catch (err) {
        throw new BridgeException('NATIVE_ERROR', err instanceof Error ? err.message : '登出失败');
      }
    },
  });
}
