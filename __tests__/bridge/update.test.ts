/**
 * update 桥接模块 + 原生适配器单测（安卓远程全量升级）。
 *
 * 关注三件事：
 *   1. 原生缺失（iOS / 浏览器测试）时统一 DEVICE_UNSUPPORTED，不能影响 App 启动；
 *   2. 参数校验先于能力检测，非法 url / version 要报 INVALID_PARAMS；
 *   3. 原生 reject 的自定义码要映射成 BridgeErrorCode，不能被吞成 UNKNOWN_ERROR。
 */
import { NativeModules } from 'react-native';
import { BridgeServer } from '../../src/bridge/bridge-server';
import { BridgeException } from '../../src/bridge/bridge-error';
import { registerUpdateModule } from '../../src/bridge/modules/update';
import type { UpdateAdapters } from '../../src/bridge/modules/update';
import { resolveNativeUpdateAdapter } from '../../src/middleware/native/update-native-adapter';

let reqSeq = 0;

async function call(server: BridgeServer, action: string, params: unknown = {}) {
  reqSeq += 1;
  return server.handle({
    type: 'request',
    id: `update-${action}-${reqSeq}`,
    version: '1.0.0',
    module: 'update',
    action,
    params,
  });
}

function serverWith(adapters: UpdateAdapters): BridgeServer {
  const server = new BridgeServer({ timeoutMs: 1000 });
  registerUpdateModule(server, adapters);
  return server;
}

const UPDATE_ACTIONS = [
  'getInfo',
  'getProgress',
  'cancelDownload',
  'install',
  'canRequestInstall',
  'openInstallSettings',
  'copyToDownloads',
  'cleanup',
];

describe('update 桥接模块', () => {
  test('适配器缺失时所有动作回 DEVICE_UNSUPPORTED', async () => {
    const server = serverWith({});
    for (const action of UPDATE_ACTIONS) {
      const res = await call(server, action);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
    }
  });

  test('url / version 非法先报 INVALID_PARAMS，不落到能力检测', async () => {
    const server = serverWith({});
    const cases = [
      { url: '', version: '1.0.2' },
      { url: 'ftp://host/app.apk', version: '1.0.2' },
      { url: 'http://host/app.apk', version: '' },
      { url: 'http://host/app.apk', version: 2 },
    ];
    for (const params of cases) {
      const res = await call(server, 'startDownload', params);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_PARAMS');
    }
  });

  test('下载地址与版本号去空格、可选字段补默认值后透传给适配器', async () => {
    const startDownload = jest.fn(async () => ({ started: true, taskState: 'downloading' }));
    const res = await call(serverWith({ startDownload }), 'startDownload', {
      url: ' https://host/app.apk ',
      version: ' 1.0.2 ',
    });
    expect(res.success).toBe(true);
    expect(startDownload).toHaveBeenCalledWith({
      url: 'https://host/app.apk',
      version: '1.0.2',
      sha256: '',
      size: 0,
    });
  });

  test('size 非有限数或非正数一律收敛成 0', async () => {
    const startDownload = jest.fn(async () => ({ started: true, taskState: 'downloading' }));
    const server = serverWith({ startDownload });
    await call(server, 'startDownload', {
      url: 'https://host/app.apk',
      version: '1.0.2',
      size: '62914560',
    });
    await call(server, 'startDownload', {
      url: 'https://host/app.apk',
      version: '1.0.2',
      size: -1,
    });
    expect((startDownload.mock.calls[0][0] as { size: number }).size).toBe(0);
    expect((startDownload.mock.calls[1][0] as { size: number }).size).toBe(0);
  });

  test('适配器抛出的 BridgeException 原样透出', async () => {
    const server = serverWith({
      install: () =>
        Promise.reject(new BridgeException('PERMISSION_DENIED', '未授予「安装未知应用」权限')),
    });
    const res = await call(server, 'install');
    expect(res.error?.code).toBe('PERMISSION_DENIED');
    expect(res.error?.message).toContain('安装未知应用');
  });
});

describe('resolveNativeUpdateAdapter', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).ERPUpdate;
  });

  test('原生模块未链接时降级为空对象', () => {
    expect(resolveNativeUpdateAdapter()).toEqual({});
  });

  test('原生错误码映射成 BridgeErrorCode', async () => {
    (NativeModules as Record<string, unknown>).ERPUpdate = {
      install: jest.fn(async () => {
        throw { code: 'INSTALL_PERMISSION_DENIED', message: 'need REQUEST_INSTALL_PACKAGES' };
      }),
      cleanup: jest.fn(async () => {
        throw new Error('disk busy');
      }),
    };
    const adapters = resolveNativeUpdateAdapter();
    // BridgeException 的错误码挂在 error.code 上（不是实例的 code 字段）
    const installErr = await adapters.install!().catch(e => e as BridgeException);
    expect(installErr).toBeInstanceOf(BridgeException);
    expect(installErr.error.code).toBe('PERMISSION_DENIED');
    const cleanupErr = await adapters.cleanup!().catch(e => e as BridgeException);
    expect(cleanupErr.error.code).toBe('NATIVE_ERROR');
  });

  test('版本信息字段缺失时收口成默认值，不产生 NaN', async () => {
    (NativeModules as Record<string, unknown>).ERPUpdate = {
      getInfo: jest.fn(async () => ({ versionCode: undefined, taskState: '' })),
    };
    const info = await resolveNativeUpdateAdapter().getInfo!();
    expect(info).toMatchObject({
      platform: 'android',
      versionCode: 0,
      canRequestInstall: false,
      taskState: 'idle',
      received: 0,
      apkPath: '',
    });
  });

  test('canRequestInstall 对齐原生 canRequestInstallCheck', async () => {
    const canRequestInstallCheck = jest.fn(async () => ({ granted: true }));
    (NativeModules as Record<string, unknown>).ERPUpdate = { canRequestInstallCheck };
    await expect(resolveNativeUpdateAdapter().canRequestInstall!()).resolves.toEqual({
      granted: true,
    });
    expect(canRequestInstallCheck).toHaveBeenCalledTimes(1);
  });
});
