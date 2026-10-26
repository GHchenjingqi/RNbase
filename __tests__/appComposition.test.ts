/**
 * App 启动决策与 Bridge 组装单测。
 */
import { resolveH5Source } from '../src/app/resolve-h5-source';
import { createAppBridgeServer } from '../src/app/compose-bridge-server';

const BUILTIN = 'file:///android_asset/index.html';

function fakeRuntime(entry: string) {
  return { resolveEntry: async () => entry };
}

describe('resolveH5Source (rule 5/34)', () => {
  it('已激活的本地/远端子包优先于内置资源', async () => {
    const src = await resolveH5Source({
      runtime: fakeRuntime('https://cdn/x/index.html'),
      builtinEntry: BUILTIN,
    });
    expect(src).toEqual({ uri: 'https://cdn/x/index.html' });
  });

  it('没有激活版本时回落到平台内置资源入口', async () => {
    const src = await resolveH5Source({ runtime: fakeRuntime(''), builtinEntry: BUILTIN });
    expect(src).toEqual({ uri: BUILTIN });
  });

  it('两者都没有时返回 null，由组合根渲染配置缺失页', async () => {
    await expect(
      resolveH5Source({ runtime: fakeRuntime(''), builtinEntry: null }),
    ).resolves.toBeNull();
  });
});

describe('createAppBridgeServer', () => {
  it('wires permission module through composed server', async () => {
    const server = createAppBridgeServer();
    const res = await server.handle({
      type: 'request',
      id: 'a1',
      version: '1.0.0',
      module: 'permission',
      action: 'request',
      params: { permission: 'camera' },
    });
    expect(res).toBeDefined();
  });

  it('returns DEVICE_UNSUPPORTED for capability without adapter', async () => {
    const server = createAppBridgeServer();
    const res = await server.handle({
      type: 'request',
      id: 'a2',
      version: '1.0.0',
      module: 'scanner',
      action: 'scan',
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
  });

  it('supports injecting capability adapters', async () => {
    const server = createAppBridgeServer({
      scanner: { scan: async () => ({ code: 'X' }) },
    });
    const res = await server.handle({
      type: 'request',
      id: 'a3',
      version: '1.0.0',
      module: 'scanner',
      action: 'scan',
    });
    expect(res.data).toEqual({ code: 'X' });
  });
});
