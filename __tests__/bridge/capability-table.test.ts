/**
 * 表驱动能力模块测试：把 Bridge 真正注册出来的每一个 capability `module.action`
 * 都跑三种状态——
 *   1) 适配器缺失  -> DEVICE_UNSUPPORTED（规则 15/16：未接入不崩、不静默）
 *   2) 适配器就位  -> 调用到预期的那个适配器方法并成功返回
 *   3) 适配器抛错  -> 错误映射（BridgeException 透传码，裸 Error 收口成 UNKNOWN_ERROR）
 *
 * 方法清单不手写：由 server.listMethods() 反查，并用等值断言做漂移守卫
 * （新增/改名动作不进这张表就红，避免 capability 再退回"只测五个模块"的盲区）。
 */
import { createBridgeServer } from '../../src/bridge/index';
import { PermissionManager } from '../../src/permissions/permission-manager';
import { BridgeException } from '../../src/bridge/bridge-error';
import type { CapabilityAdapters } from '../../src/bridge/modules/capabilities/types';
import type { BridgeRequest } from '../../src/bridge/protocol';

/** 一张表 = 一个 Bridge 动作。 */
type Case = {
  /** 注册的模块名，同时也是 CapabilityAdapters 上的键（跨模块调用另用 via 覆写）。 */
  module: string;
  action: string;
  /** 让 handler 走通的最小合法参数；缺省表示该动作不吃参数。 */
  params?: unknown;
  /** 预期被调用的适配器方法名，缺省同 action；null 表示这条路径不会触达原生。 */
  calls?: string | null;
  /** 实际被调用的适配器键（如 file.pickImage 走的是 media）。 */
  via?: string;
  /** 适配器返回值覆写：handler 会拆解结果的少数几条路径需要。 */
  result?: Record<string, unknown>;
  /**
   * 该动作与"原生是否接入"无关，因此不参与缺失/抛错两态。
   * 目前只有 sensor.stop：它只清理本地订阅表，没订阅过就直接回 ok。
   */
  nativeFree?: boolean;
};

const FILE_URI = 'file:///data/user/0/com.qux.app/files/avatar.png';
const PICKED = { name: 'a.png', size: 12, mimeType: 'image/png', uri: FILE_URI };

const CASES: Case[] = [
  // ── scanner / camera / location / inAppReview：无参直通 ──
  { module: 'scanner', action: 'scan' },
  { module: 'camera', action: 'takePhoto' },
  { module: 'location', action: 'getCurrentPosition' },
  { module: 'inAppReview', action: 'requestReview' },

  // ── media / file ──
  { module: 'media', action: 'pickImage' },
  { module: 'media', action: 'saveImage', params: { uri: FILE_URI } },
  { module: 'file', action: 'pick', params: { accept: ['image/png'] } },
  {
    module: 'file',
    action: 'readAsBase64',
    params: { uri: FILE_URI },
    result: { base64: 'aGk=', mimeType: 'image/png', name: 'a.png', size: 2 },
  },
  // file.pickImage 是跨模块复用 media.pickImage 的例子，且要求结果里至少有一张图
  {
    module: 'file',
    action: 'pickImage',
    via: 'media',
    calls: 'pickImage',
    result: { files: [PICKED] },
  },
  { module: 'file', action: 'download', params: { url: 'https://example.com/f.bin' } },
  { module: 'file', action: 'open', params: { uri: FILE_URI } },

  // ── clipboard / brightness / flashlight ──
  { module: 'clipboard', action: 'getString' },
  { module: 'clipboard', action: 'setString', params: { text: 'hello' } },
  { module: 'clipboard', action: 'hasString' },
  { module: 'brightness', action: 'getBrightness' },
  { module: 'brightness', action: 'setBrightness', params: { brightness: 0.5 } },
  { module: 'brightness', action: 'getSystemBrightness' },
  { module: 'flashlight', action: 'isAvailable' },
  { module: 'flashlight', action: 'toggle', params: { enabled: true } },

  // ── sensor ──
  { module: 'sensor', action: 'isAvailable', params: { type: 'accelerometer' } },
  { module: 'sensor', action: 'start', params: { type: 'accelerometer' } },
  // stop 只清理本地订阅表：没订阅过就不碰适配器，只要求成功
  {
    module: 'sensor',
    action: 'stop',
    params: { subscriptionId: 'sub-1' },
    calls: null,
    nativeFree: true,
  },
  { module: 'sensor', action: 'getStepCount' },

  // ── biometric / contacts / calendar ──
  { module: 'biometric', action: 'isAvailable' },
  { module: 'biometric', action: 'authenticate', params: { promptMessage: '验证' } },
  { module: 'contacts', action: 'getAll', params: { pageSize: 20 } },
  // pick 允许"没选中"，但那是取消而不是失败，所以给一个真联系人
  {
    module: 'contacts',
    action: 'pick',
    calls: 'pick',
    result: { id: 'c1', name: '张三', phones: ['13800000000'] },
  },
  { module: 'contacts', action: 'add', params: { name: '张三', phones: ['13800000000'] } },
  { module: 'calendar', action: 'getCalendars' },
  { module: 'calendar', action: 'getEvents', params: { startDate: 1, endDate: 2 } },
  { module: 'calendar', action: 'addEvent', params: { title: '晨会', startDate: 1, endDate: 2 } },
  { module: 'calendar', action: 'removeEvent', params: { id: 'e1' } },

  // ── nfc / bluetooth ──
  { module: 'nfc', action: 'isAvailable' },
  { module: 'nfc', action: 'readTag', params: { timeout: 5000 } },
  { module: 'nfc', action: 'writeNdef', params: { records: [{ type: 'text', data: 'hi' }] } },
  { module: 'bluetooth', action: 'isAvailable' },
  { module: 'bluetooth', action: 'enable' },
  { module: 'bluetooth', action: 'startScan', params: { timeout: 3000 } },
  { module: 'bluetooth', action: 'stopScan' },
  { module: 'bluetooth', action: 'connect', params: { deviceId: 'd1' } },
  { module: 'bluetooth', action: 'disconnect', params: { deviceId: 'd1' } },
  {
    module: 'bluetooth',
    action: 'write',
    params: { deviceId: 'd1', serviceUuid: 's1', characteristicUuid: 'c1', data: 'aa' },
  },
  {
    module: 'bluetooth',
    action: 'read',
    params: { deviceId: 'd1', serviceUuid: 's1', characteristicUuid: 'c1' },
  },

  // ── audio / storage / networkInfo ──
  { module: 'audio', action: 'startRecording', params: { format: 'aac' } },
  { module: 'audio', action: 'stopRecording' },
  { module: 'audio', action: 'play', params: { uri: 'file:///a.mp3' } },
  { module: 'audio', action: 'pause' },
  { module: 'audio', action: 'stop' },
  { module: 'storage', action: 'getDiskInfo' },
  { module: 'storage', action: 'clearCache' },
  { module: 'storage', action: 'getAppDir' },
  { module: 'networkInfo', action: 'getWifiInfo' },
  { module: 'networkInfo', action: 'getCellularInfo' },
  { module: 'networkInfo', action: 'getIpAddress', params: { type: 'ipv4' } },

  // ── qr / image / haptics / speech ──
  { module: 'qr', action: 'generate', params: { text: 'https://qoder.com' } },
  { module: 'image', action: 'compress', params: { uri: FILE_URI, quality: 80 } },
  {
    module: 'image',
    action: 'crop',
    params: { uri: FILE_URI, x: 0, y: 0, width: 100, height: 100 },
  },
  { module: 'image', action: 'getSize', params: { uri: FILE_URI } },
  { module: 'haptics', action: 'impact', params: { style: 'light' } },
  { module: 'haptics', action: 'notification', params: { type: 'success' } },
  { module: 'haptics', action: 'selection' },
  { module: 'speech', action: 'speak', params: { text: '你好' } },
  { module: 'speech', action: 'stop' },
  { module: 'speech', action: 'isSpeaking' },
  { module: 'speech', action: 'getAvailableLanguages' },

  // ── appManager / backgroundTask / voice ──
  { module: 'appManager', action: 'isInstalled', params: { packageName: 'com.qux.app' } },
  { module: 'appManager', action: 'openApp', params: { packageName: 'com.qux.app' } },
  { module: 'appManager', action: 'openAppStore', params: { appId: '123' } },
  { module: 'appManager', action: 'openAppSettings' },
  { module: 'appManager', action: 'openSystemSettings', params: { action: 'wifi' } },
  { module: 'appManager', action: 'getInstalledApps' },
  { module: 'backgroundTask', action: 'start', params: { taskKey: 'sync' } },
  { module: 'backgroundTask', action: 'stop', params: { taskId: 1 } },
  { module: 'backgroundTask', action: 'isRunning', params: { taskKey: 'sync' } },
  { module: 'voice', action: 'getStatus' },
  { module: 'voice', action: 'prepareModel' },
  { module: 'voice', action: 'startRecording', params: { sessionId: 'v1' } },
  { module: 'voice', action: 'stopAndRecognize', params: { sessionId: 'v1' } },
  { module: 'voice', action: 'cancelRecording', params: { sessionId: 'v1' } },
];

const keyOf = (module: string, action: string) => `${module}.${action}`;

/** 表里出现过的能力模块；listMethods() 过滤出来的能力动作必须与之完全一致。 */
const CAPABILITY_MODULES = [...new Set(CASES.map((c) => c.module))].sort();

function req(module: string, action: string, params?: unknown): BridgeRequest {
  return {
    type: 'request',
    id: `${keyOf(module, action)}_${Math.random().toString(36).slice(2)}`,
    version: '1.0.0',
    module: module as BridgeRequest['module'],
    action,
    params,
  };
}

/** 表 -> 适配器桩：每个被点名的方法都是异步桩，返回值默认 { ok: true }。 */
function stubAdapters(behavior: 'return' | 'throw'): {
  adapters: CapabilityAdapters;
  invoked: string[];
} {
  const invoked: string[] = [];
  // 同一个适配器方法可能被多个动作复用（media.pickImage 同时服务 media/file）：
  // 带 result 覆写的那一行优先，否则通用桩返回值会把 file.pickImage 顶成 USER_CANCELLED。
  const shape: Record<
    string,
    Record<string, { result: Record<string, unknown>; pinned: boolean }>
  > = {};
  for (const c of CASES) {
    const adapterKey = c.via ?? c.module;
    const methodName = c.calls ?? c.action;
    if (!methodName) continue;
    const bucket = (shape[adapterKey] = shape[adapterKey] ?? {});
    const existing = bucket[methodName];
    const next = { result: c.result ?? { ok: true }, pinned: Boolean(c.result) };
    if (!existing || (!existing.pinned && next.pinned)) bucket[methodName] = next;
  }
  const adapters: Record<string, Record<string, unknown>> = {};
  for (const [adapterKey, methods] of Object.entries(shape)) {
    adapters[adapterKey] = {};
    for (const [methodName, stub] of Object.entries(methods)) {
      adapters[adapterKey][methodName] = async () => {
        invoked.push(keyOf(adapterKey, methodName));
        if (behavior === 'throw') {
          throw new BridgeException('NATIVE_ERROR', `${adapterKey}.${methodName} 原生失败`);
        }
        return stub.result;
      };
    }
  }
  return { adapters: adapters as CapabilityAdapters, invoked };
}

/** 抛错态用裸 Error 的另一套桩：验证原生异常不会把内部信息原样透给 H5。 */
function throwingAdapters(): CapabilityAdapters {
  const { adapters } = stubAdapters('throw');
  const patched: Record<string, Record<string, unknown>> = {};
  for (const [k, methods] of Object.entries(adapters as Record<string, Record<string, unknown>>)) {
    patched[k] = {};
    for (const name of Object.keys(methods)) {
      patched[k][name] = async () => {
        throw new Error('native exploded: /data/internal/path');
      };
    }
  }
  return patched as unknown as CapabilityAdapters;
}

const baselineServer = createBridgeServer(new PermissionManager());

describe('capability 表驱动：清单完整性', () => {
  it('表覆盖了 Bridge 注册出来的全部能力动作（新增动作必须先进表）', () => {
    const registered = baselineServer
      .listMethods()
      .filter((m) => CAPABILITY_MODULES.includes(m.split('.')[0]))
      .sort();
    const table = CASES.map((c) => keyOf(c.module, c.action)).sort();
    expect(table).toEqual(registered);
  });

  it('表里没有多余的动作（改名/删除要同步收行）', () => {
    for (const c of CASES) {
      expect(baselineServer.has(c.module as BridgeRequest['module'], c.action)).toBe(true);
    }
  });
});

describe('capability 表驱动：适配器缺失 -> DEVICE_UNSUPPORTED', () => {
  test.each(CASES.filter((c) => !c.nativeFree))(
    '$module.$action',
    async ({ module, action, params }) => {
      const server = createBridgeServer(new PermissionManager(), {});
      const res = await server.handle(req(module, action, params));
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
    }
  );
});

describe('capability 表驱动：适配器就位 -> 走通并命中预期方法', () => {
  test.each(CASES)('$module.$action', async ({ module, action, params, calls, via }) => {
    const { adapters, invoked } = stubAdapters('return');
    const server = createBridgeServer(new PermissionManager(), adapters);
    const res = await server.handle(req(module, action, params));
    expect(res.error).toBeNull();
    expect(res.success).toBe(true);
    if (calls === null) return;
    expect(invoked).toContain(keyOf(via ?? module, calls ?? action));
  });
});

describe('capability 表驱动：适配器抛错 -> 错误收口', () => {
  it('裸 Error 归一为 UNKNOWN_ERROR，且不外泄原生信息', async () => {
    const adapters = throwingAdapters();
    for (const c of CASES.filter((x) => x.calls !== null)) {
      const server = createBridgeServer(new PermissionManager(), adapters);
      const res = await server.handle(req(c.module, c.action, c.params));
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('UNKNOWN_ERROR');
      expect(JSON.stringify(res.error ?? '')).not.toMatch('/data/internal/path');
    }
  });

  it('BridgeException 的业务码原样透传', async () => {
    const { adapters } = stubAdapters('throw');
    const server = createBridgeServer(new PermissionManager(), adapters);
    const res = await server.handle(req('camera', 'takePhoto'));
    expect(res.error?.code).toBe('NATIVE_ERROR');
  });
});
