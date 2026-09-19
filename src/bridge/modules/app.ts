/**
 * app 桥接模块（规则 16：能力检测 / 规则 50）。
 *
 * 暴露 App 基础信息与设备能力，供 H5 启动时做 capability 检测与降级。
 */
import { NativeModules, Platform } from 'react-native';
import type { BridgeServer } from '../bridge-server';
import {
  APP_VERSION,
  BRIDGE_VERSION,
  BRIDGE_PROTOCOL_VERSION,
  CLIENT_ID,
  TRUSTED_APP_IDS,
} from '../../config';
import { BRIDGE_EVENTS } from '../protocol';
import { bridgeEventBus } from '../event-bus';

export { APP_VERSION, BRIDGE_VERSION };

/** 按当前平台取登录 clientId（打包时区分安卓 / iOS）。 */
export function getClientId(): string {
  return Platform.OS === 'ios' ? CLIENT_ID.ios : CLIENT_ID.android;
}

type Capabilities = {
  bridgeVersion: string;
  platform: string;
  clientId: string;
  features: {
    camera: boolean;
    scanner: boolean;
    location: boolean;
    filePicker: boolean;
    share: boolean;
    nfc: boolean;
    notification: boolean;
  };
};

function getInfo() {
  return {
    appVersion: APP_VERSION,
    bridgeVersion: BRIDGE_VERSION,
    platform: Platform.OS,
    clientId: getClientId(),
  };
}

/** NFC 能力缓存：启动时异步检测原生模块，getCapabilities 同步返回缓存值。 */
let nfcAvailableCache = false;
let nfcDetected = false;

/** 异步检测设备 NFC 是否可用（原生模块存在时调用）。 */
function detectNfcAvailability(): void {
  if (nfcDetected) return;
  nfcDetected = true;
  const native = (NativeModules as Record<string, unknown>).ERPCapabilities as
    | { nfcAvailable?: () => Promise<{ available: boolean }> }
    | undefined;
  if (!native?.nfcAvailable) return;
  native.nfcAvailable()
    .then(r => {
      nfcAvailableCache = Boolean(r?.available);
    })
    .catch(() => {
      nfcAvailableCache = false;
    });
}

function getCapabilities(): Capabilities {
  return {
    bridgeVersion: BRIDGE_VERSION,
    platform: Platform.OS,
    clientId: getClientId(),
    features: {
      camera: true,
      scanner: true,
      location: true,
      filePicker: true,
      share: true,
      nfc: nfcAvailableCache,
      notification: true,
    },
  };
}

/** 能力 features 对象 → 可用能力名数组（过滤 false），用于握手回执与 bridge.ready 事件。 */
function featuresToArray(features: Capabilities['features']): string[] {
  return (Object.keys(features) as (keyof Capabilities['features'])[]).filter(
    k => features[k] === true,
  );
}

export type LifecycleHandlers = {
  /** H5 启动确认（规则 9）：用于标记当前 H5 版本 stable。 */
  onReady?: (info: {
    h5Version?: string;
    bridgeVersion?: string;
    appId?: string;
    protocolVersion?: string;
  }) => void;
  /** H5 生命周期事件（resume / pause 等）。 */
  onLifecycle?: (event: string) => void;
};

export function registerAppModule(server: BridgeServer, handlers: LifecycleHandlers = {}): void {
  // 启动时异步检测 NFC 能力（不阻塞模块注册）
  detectNfcAvailability();

  server.registerModule('app', {
    getInfo,
    getVersion: getInfo,
    getCapabilities,
    /** H5 登录用的 clientId（按平台返回：安卓 / iOS）。 */
    getClientId() {
      return { clientId: getClientId() };
    },
    ready(_params) {
      const p = _params as
        | {
            h5Version?: string;
            bridgeVersion?: string;
            appId?: string;
            protocolVersion?: string;
          }
        | undefined;
      // 安全校验（升级方案 §23）：TRUSTED_APP_IDS 配置后拒绝非白名单 appId；
      // 未配置（观察期）放行，但对非默认 appId 打警告日志。
      if (p?.appId && TRUSTED_APP_IDS.length > 0 && TRUSTED_APP_IDS.indexOf(p.appId) === -1) {
        return {
          ok: false,
          state: 'REJECTED',
          error: { code: 'SECURITY_BLOCKED', message: 'appId 不在信任列表' },
        };
      }
      if (p?.appId && TRUSTED_APP_IDS.length === 0 && p.appId !== 'base_h5') {
        console.warn(`[bridge] untrusted appId handshake: ${p.appId}`);
      }
      handlers.onReady?.({
        h5Version: p?.h5Version,
        bridgeVersion: p?.bridgeVersion,
        appId: p?.appId,
        protocolVersion: p?.protocolVersion,
      });
      const capabilities = featuresToArray(getCapabilities().features);
      // 握手完成回执：H5 侧 RN.READY 的响应以此为准（state:'READY' + capabilities）
      // 同时推送 bridge.ready 事件（RN→H5 事件通道兜底，双路径幂等由 H5 侧 SDK 保证）
      bridgeEventBus.emit(BRIDGE_EVENTS.READY, {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        bridgeVersion: BRIDGE_VERSION,
        appVersion: APP_VERSION,
        appId: 'app_base',
        capabilities,
        h5Version: p?.h5Version ?? null,
      });
      return {
        ok: true,
        state: 'READY',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        bridgeVersion: BRIDGE_VERSION,
        appVersion: APP_VERSION,
        appId: 'app_base',
        capabilities,
      };
    },
    lifecycle(_params) {
      const p = _params as { event?: string } | undefined;
      handlers.onLifecycle?.(p?.event ?? 'unknown');
      return { ok: true };
    },
  });
}
