/**
 * SYSTEM 模块新增能力单元测试（深色模式/语言/屏幕/无障碍/设备信息/电量/事件）。
 *
 * 通过 mock react-native 的 Appearance / AccessibilityInfo / Dimensions /
 * I18nManager / NativeModules / PixelRatio 控制返回值。
 */
let mockDarkListener: ((e: { colorScheme: string | null }) => void) | null = null;

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 33 },
  Appearance: {
    getColorScheme: jest.fn(() => 'dark'),
    addChangeListener: jest.fn((cb: (e: { colorScheme: string | null }) => void) => {
      mockDarkListener = cb;
      return { remove: jest.fn() };
    }),
  },
  AccessibilityInfo: {
    isScreenReaderEnabled: jest.fn(async () => true),
    isReduceMotionEnabled: jest.fn(async () => false),
    isBoldTextEnabled: jest.fn(async () => false),
    isInvertColorsEnabled: jest.fn(async () => false),
  },
  Dimensions: {
    get: jest.fn(() => ({ width: 390, height: 844 })),
  },
  PixelRatio: {
    get: jest.fn(() => 3),
    getFontScale: jest.fn(() => 1.2),
  },
  I18nManager: {
    getConstants: jest.fn(() => ({ localeIdentifier: 'zh_CN' })),
  },
  NativeModules: {
    SettingsManager: { settings: { Locale: 'zh_CN' } },
  },
  Vibration: { vibrate: jest.fn() },
}));

import { BridgeServer } from '../../src/bridge/bridge-server';
import { registerSystemModule } from '../../src/bridge/modules/system';
import { Appearance } from 'react-native';
import type { DeviceInfoResult } from '../../src/bridge/modules/system';

function makeServer(): BridgeServer {
  return new BridgeServer({ timeoutMs: 1000 });
}

async function call(server: BridgeServer, action: string, params: unknown = {}) {
  return server.handle({
    type: 'request',
    id: `sys-${action}-${Math.random().toString(36).slice(2)}`,
    version: '1.0.0',
    module: 'system',
    action,
    params,
  });
}

const DEVICE_INFO: DeviceInfoResult = {
  brand: 'vivo',
  model: 'V2217A',
  systemVersion: '13',
  sdkInt: 33,
  batteryLevel: 61,
  isCharging: true,
  totalStorage: 250_000_000_000,
  freeStorage: 120_000_000_000,
  timezone: 'Asia/Shanghai',
};

describe('SYSTEM 新增能力', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认深色模式为 dark（clearAllMocks 不清 returnValue，需在此重置）
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('dark');
  });

  test('getDarkMode 返回当前深色模式', async () => {
    const server = makeServer();
    registerSystemModule(server);
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('dark');
    const res = await call(server, 'getDarkMode');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ mode: 'dark' });
  });

  test('getDarkMode 无明确模式时返回 system', async () => {
    const server = makeServer();
    registerSystemModule(server);
    (Appearance.getColorScheme as jest.Mock).mockReturnValue(null);
    const res = await call(server, 'getDarkMode');
    expect(res.data).toEqual({ mode: 'system' });
  });

  test('深色切换触发 system.darkmodechange 事件', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const events: unknown[] = [];
    server.eventBus.on('system.darkmodechange', d => events.push(d));
    expect(mockDarkListener).not.toBeNull();
    mockDarkListener!({ colorScheme: 'light' });
    expect(events).toEqual([{ mode: 'light' }]);
  });

  test('getLanguage 返回语言与区域', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await call(server, 'getLanguage');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ language: 'zh', locale: 'zh_CN' });
  });

  test('getScreenInfo 返回屏幕尺寸与缩放', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await call(server, 'getScreenInfo');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1.2,
    });
  });

  test('getAccessibility 返回无障碍状态', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await call(server, 'getAccessibility');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      screenReader: true,
      reduceMotion: false,
      boldText: false,
      invertColors: false,
    });
  });

  test('getInfo 无原生 adapter 时省略 device 字段', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await call(server, 'getInfo');
    expect(res.success).toBe(true);
    const d = res.data as Record<string, unknown>;
    expect(d.os).toBeDefined();
    expect(d.darkMode).toBe('dark');
    expect(d.language).toBe('zh');
    expect(d.screen).toEqual({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1.2,
    });
    expect('device' in d).toBe(false);
  });

  test('getInfo 含原生 adapter 时返回 device', async () => {
    const server = makeServer();
    registerSystemModule(server, { deviceInfo: async () => DEVICE_INFO });
    const res = await call(server, 'getInfo');
    expect(res.success).toBe(true);
    expect((res.data as Record<string, unknown>).device).toEqual(DEVICE_INFO);
  });

  test('getDeviceInfo 无 adapter 返回 DEVICE_UNSUPPORTED', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await call(server, 'getDeviceInfo');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  test('getDeviceInfo 有 adapter 返回设备信息', async () => {
    const server = makeServer();
    registerSystemModule(server, { deviceInfo: async () => DEVICE_INFO });
    const res = await call(server, 'getDeviceInfo');
    expect(res.success).toBe(true);
    expect(res.data).toEqual(DEVICE_INFO);
  });

  test('getBattery 无 adapter 返回 DEVICE_UNSUPPORTED', async () => {
    const server = makeServer();
    registerSystemModule(server);
    const res = await call(server, 'getBattery');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  test('getBattery 有 adapter 返回电量与充电状态', async () => {
    const server = makeServer();
    registerSystemModule(server, { deviceInfo: async () => DEVICE_INFO });
    const res = await call(server, 'getBattery');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ level: 61, isCharging: true });
  });

  test('getBattery 电量未知时 level 为 null', async () => {
    const server = makeServer();
    registerSystemModule(server, {
      deviceInfo: async () => ({ ...DEVICE_INFO, batteryLevel: -1 }),
    });
    const res = await call(server, 'getBattery');
    expect(res.data).toEqual({ level: null, isCharging: true });
  });
});
