/**
 * device / battery 的「接线」单测。
 *
 * 这张表要杀掉的缺陷：src/bridge/index.ts 里 registerDeviceModule / registerBatteryModule
 * 曾经只传了 server，没传 adapters。于是两个模块在协议里看得见、H5 调得动，但每台真机
 * 每个动作都回 DEVICE_UNSUPPORTED —— 而其中 getAppName / getBundleId / getBuildNumber 的
 * 真值一直都在 version.json 里，battery 的电量一直都在 BaseSystem.getDeviceInfo 里。
 * 更糟的是当时的表驱动测试把「恒失败」当成预期行为断言了一遍，缺陷被固化成契约。
 *
 * 所以这里断言的不是「失败态」，而是两条边界：
 *   1) 生产接线（createBridgeServer）下，凡是不依赖原生实现的 device 动作必须成功，
 *      且返回值就是 config 的真值（不在测试里写死具体 App 的名字/包名）。
 *   2) 还依赖原生实现的动作，用 KNOWN_NATIVE_GAPS 逐条登记。给基座补上原生能力时，
 *      必须同时把这条动作从缺口表里挪走，否则本测试先红——缺能力从此是可数的、有主人的，
 *      不会再静默膨胀。
 */
import { NativeModules } from 'react-native';
import { createBridgeServer } from '../../src/bridge/index';
import type { BridgeRequest } from '../../src/bridge/protocol';
import { APP_BUILD_NUMBER, APP_NAME, APP_PACKAGE } from '../../src/config';

/**
 * 仍未接入原生的动作（key = `module.action`）。
 *
 * 逐条原因：
 *   - device.getUniqueId / getFirstInstallTime / getLastUpdateTime：
 *     安卓已实现 BaseSystem.getInstallInfo；iOS / 鸿蒙没有对应原生方法。
 *     jest 环境里没有 NativeModules.BaseSystem，所以在这套测试里它们必然属于缺口。
 *   - battery.getInfo / getLevel / isCharging：同上，依赖 BaseSystem.getDeviceInfo。
 * 补实现的那一轮要在这里删掉对应行，并让下面的「缺口态」用例改到「走通态」那张表里去。
 */
const KNOWN_NATIVE_GAPS = [
  'battery.getInfo',
  'battery.getLevel',
  'battery.isCharging',
  'device.getFirstInstallTime',
  'device.getLastUpdateTime',
  'device.getUniqueId',
];

function req(module: string, action: string, params?: Record<string, unknown>): BridgeRequest {
  return {
    type: 'request',
    id: `${module}.${action}_${Math.random().toString(36).slice(2)}`,
    version: '1.0.0',
    module: module as BridgeRequest['module'],
    action,
    params,
  };
}

/** 桩出 BaseSystem 的两个原生方法；不传的那表示原生未实现。 */
function installBaseSystemStub(stub: { getDeviceInfo?: jest.Mock; getInstallInfo?: jest.Mock }) {
  (NativeModules as Record<string, unknown>).BaseSystem = stub;
}

describe('device / battery 生产接线', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).BaseSystem;
  });

  describe('原生未实现时（jest 默认态）', () => {
    const server = createBridgeServer();

    it('version.json 能直接给的三个动作必须成功，且给的是 config 真值', async () => {
      const name = await server.handle(req('device', 'getAppName'));
      const bundle = await server.handle(req('device', 'getBundleId'));
      const build = await server.handle(req('device', 'getBuildNumber'));
      // 断言值来自 config，而不是测试里抄的一份：具体 App 的品牌由 version.json 下发，
      // 基座测试写死它就把「基座不得带租户身份」这条踩在脚下了。
      expect(name.data).toEqual({ appName: APP_NAME });
      expect(bundle.data).toEqual({ bundleId: APP_PACKAGE });
      expect(build.data).toEqual({ buildNumber: APP_BUILD_NUMBER });
      for (const res of [name, bundle, build]) {
        expect(res.success).toBe(true);
        expect(res.error).toBeNull();
      }
    });

    it('未登记为原生动作的 device 动作不再静默失败', async () => {
      const registered = server
        .listMethods()
        .filter(m => m.startsWith('device.') || m.startsWith('battery.'))
        .sort();
      const gapsInRegistry = registered.filter(m => KNOWN_NATIVE_GAPS.includes(m));
      // 缺口表里的每一条都真的在册：写了却查不到，说明动作已改名或删除，表要收。
      expect(gapsInRegistry).toEqual([...KNOWN_NATIVE_GAPS].sort());
      for (const key of registered.filter(m => !KNOWN_NATIVE_GAPS.includes(m))) {
        const [module, action] = key.split('.');
        const res = await server.handle(req(module, action));
        expect({ key, code: res.error?.code }).toEqual({ key, code: undefined });
      }
    });

    it('登记在册的原生缺口统一报 DEVICE_UNSUPPORTED（而不是 UNKNOWN_ERROR）', async () => {
      for (const key of KNOWN_NATIVE_GAPS) {
        const [module, action] = key.split('.');
        const res = await server.handle(req(module, action));
        expect(res.success).toBe(false);
        expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
      }
    });
  });

  describe('BaseSystem 就位时（安卓真机链路）', () => {
    it('battery 三个动作取到原生电量，getInfo 带完整语义', async () => {
      installBaseSystemStub({
        getDeviceInfo: jest.fn(async () => ({ batteryLevel: 77, isCharging: true })),
      });
      const server = createBridgeServer();
      expect((await server.handle(req('battery', 'getInfo'))).data).toEqual({
        level: 77,
        isCharging: true,
      });
      expect((await server.handle(req('battery', 'getLevel'))).data).toEqual({ level: 77 });
      expect((await server.handle(req('battery', 'isCharging'))).data).toEqual({
        isCharging: true,
      });
    });

    it('原生读不到电量（-1）时 level 为 null，不夹成 0 造一个「电量耗尽」', async () => {
      installBaseSystemStub({
        getDeviceInfo: jest.fn(async () => ({ batteryLevel: -1, isCharging: false })),
      });
      const res = await createBridgeServer().handle(req('battery', 'getLevel'));
      expect(res.data).toEqual({ level: null });
    });

    it('getInstallInfo 就位时 device 的三个安装信息动作走通', async () => {
      installBaseSystemStub({
        getInstallInfo: jest.fn(async () => ({
          uniqueId: 'device-install-id',
          firstInstallTime: 1700000000000,
          lastUpdateTime: 1700000009000,
        })),
      });
      const server = createBridgeServer();
      expect((await server.handle(req('device', 'getUniqueId'))).data).toEqual({
        uniqueId: 'device-install-id',
      });
      expect((await server.handle(req('device', 'getFirstInstallTime'))).data).toEqual({
        firstInstallTime: 1700000000000,
      });
      expect((await server.handle(req('device', 'getLastUpdateTime'))).data).toEqual({
        lastUpdateTime: 1700000009000,
      });
    });

    it('只有 getInstallInfo、没有 getDeviceInfo 时按方法逐项挂载（不整模块连坐）', async () => {
      installBaseSystemStub({
        getInstallInfo: jest.fn(async () => ({
          uniqueId: 'id',
          firstInstallTime: 1,
          lastUpdateTime: 2,
        })),
      });
      const server = createBridgeServer();
      expect((await server.handle(req('device', 'getUniqueId'))).success).toBe(true);
      const battery = await server.handle(req('battery', 'getInfo'));
      expect(battery.error?.code).toBe('DEVICE_UNSUPPORTED');
    });
  });
});
