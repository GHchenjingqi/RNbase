/**
 * Mock 传输适配器（Phase 4 / 规范 §42：浏览器开发模式）。
 *
 *  - createMockTransport(handler)：将发送的消息交给 handler 生成响应，
 *    可用于端到端测试（handler 接入真实 BridgeServer）。
 *  - createBrowserMockTransport(config?)：浏览器中无需启动 App 即可联调 H5，
 *    返回合理的假数据，支持场景配置（成功/拒绝/超时/能力缺失）。
 */
import type { BridgeModule, BridgeRequest, BridgeResponse } from '../../protocol';
import type { BridgeTransport } from '../types';
import { APP_VERSION } from '../../../config';

export type MockScenario =
  | 'success'
  | 'permission_denied'
  | 'timeout'
  | 'capability_missing'
  | 'error';

export type BrowserMockConfig = {
  /** 全局场景，默认 success。 */
  scenario?: MockScenario;
  /** 特定 module.action 的场景覆盖。 */
  overrides?: Record<string, MockScenario>;
  /** 模拟延迟（毫秒），默认 100。 */
  delayMs?: number;
  /** 能力清单，默认全部可用。 */
  capabilities?: Record<string, boolean>;
  /** 扫码结果。 */
  scanResult?: string;
  /** 定位结果。 */
  location?: { latitude: number; longitude: number; accuracy: number };
};

export function createMockTransport(
  handler: (rawRequest: string) => string | Promise<string>,
): BridgeTransport {
  let listener: ((raw: string) => void) | null = null;
  return {
    send(raw: string): void {
      Promise.resolve(handler(raw)).then(res => {
        if (listener) {
          listener(res);
        }
      });
    },
    subscribe(l: (raw: string) => void): () => void {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
}

function getScenario(req: BridgeRequest, config: BrowserMockConfig): MockScenario {
  const key = `${req.module}.${req.action}`;
  return config.overrides?.[key] ?? config.scenario ?? 'success';
}

function mockSuccessResponse(req: BridgeRequest, config: BrowserMockConfig): BridgeResponse {
  const data: Record<string, unknown> = {};
  const caps = config.capabilities ?? {
    camera: true,
    scanner: true,
    location: true,
    filePicker: true,
    share: true,
    nfc: false,
    bluetooth: false,
  };

  switch (req.module) {
    case 'app':
      if (req.action === 'getCapabilities') {
        data.bridgeVersion = '1.0.0';
        data.platform = 'web';
        data.features = caps;
      } else if (req.action === 'ready') {
        data.ok = true;
      } else if (req.action === 'close') {
        data.ok = true;
      } else {
        data.appVersion = APP_VERSION;
        data.bridgeVersion = '1.0.0';
        data.platform = 'web';
      }
      break;
    case 'auth':
      if (req.action === 'getToken') {
        data.token = 'mock-access-token';
      } else if (req.action === 'getUser') {
        data.user = { id: 'mock-user-001', name: 'Mock User', role: 'admin' };
      } else if (req.action === 'logout') {
        data.ok = true;
      }
      break;
    case 'network':
      data.connected = true;
      data.type = 'wifi';
      break;
    case 'camera':
      data.uri = 'file:///mock/photo.jpg';
      data.width = 1920;
      data.height = 1080;
      break;
    case 'scanner':
      data.code = config.scanResult ?? 'MOCK-SCAN-123456';
      data.format = 'QR_CODE';
      break;
    case 'media':
      if (req.action === 'pickImage') {
        data.uris = ['file:///mock/image1.jpg', 'file:///mock/image2.jpg'];
      } else if (req.action === 'saveImage') {
        data.ok = true;
      }
      break;
    case 'file':
      if (req.action === 'pick') {
        data.uris = ['file:///mock/doc.pdf'];
        data.names = ['document.pdf'];
        data.sizes = [102400];
      } else if (req.action === 'download') {
        data.uri = 'file:///mock/downloaded.pdf';
      } else if (req.action === 'open') {
        data.ok = true;
      }
      break;
    case 'location':
      data.latitude = config.location?.latitude ?? 34.0259;
      data.longitude = config.location?.longitude ?? 113.8416;
      data.accuracy = config.location?.accuracy ?? 10;
      break;
    case 'system':
      if (req.action === 'copy') {
        data.ok = true;
      } else if (req.action === 'share') {
        data.ok = true;
      }
      break;
    case 'notification':
      if (req.action === 'getToken') {
        data.token = 'mock-push-token';
      } else if (req.action === 'setBadge') {
        data.ok = true;
      }
      break;
    case 'permission':
      if (req.action === 'openSettings') {
        data.opened = true;
      } else {
        data.permission =
          (req.params as { permission?: string } | undefined)?.permission ?? 'unknown';
        data.status = 'granted';
        data.granted = true;
        data.canAskAgain = true;
      }
      break;
    default:
      break;
  }
  return {
    type: 'response',
    id: req.id,
    success: true,
    data,
    error: null,
  };
}

function mockErrorResponse(req: BridgeRequest, scenario: MockScenario): BridgeResponse {
  let code: 'PERMISSION_DENIED' | 'DEVICE_UNSUPPORTED' | 'NATIVE_ERROR' | 'UNKNOWN_ERROR' =
    'UNKNOWN_ERROR';
  let message = 'Mock error';
  switch (scenario) {
    case 'permission_denied':
      code = 'PERMISSION_DENIED';
      message = '权限被拒绝（Mock）';
      break;
    case 'capability_missing':
      code = 'DEVICE_UNSUPPORTED';
      message = '当前设备不支持该能力（Mock）';
      break;
    case 'error':
      code = 'NATIVE_ERROR';
      message = '原生调用异常（Mock）';
      break;
    default:
      break;
  }
  return {
    type: 'response',
    id: req.id,
    success: false,
    data: null,
    error: { code, message },
  };
}

export function createBrowserMockTransport(config: BrowserMockConfig = {}): BridgeTransport {
  const delay = config.delayMs ?? 100;
  return createMockTransport(raw => {
    return new Promise<string>(resolve => {
      const req = JSON.parse(raw) as BridgeRequest;
      const scenario = getScenario(req, config);

      if (scenario === 'timeout') {
        // 超时：不返回响应
        return;
      }

      setTimeout(() => {
        const res =
          scenario === 'success'
            ? mockSuccessResponse(req, config)
            : mockErrorResponse(req, scenario);
        resolve(JSON.stringify(res));
      }, delay);
    });
  });
}

export type { BridgeModule };
