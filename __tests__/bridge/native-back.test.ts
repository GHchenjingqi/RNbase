/**
 * 硬件返回键链路单测：native.back 事件名 + app.nativeBackResult 回执的处理者契约。
 *
 * 决策交给 H5、兜底留在容器（见 src/webview/WebViewBridge.tsx 的 BackHandler effect）。
 * 这里锁住两端契约：事件名不能改（H5 按名字订阅）；回执缺省必须算「已处理」，
 * 否则 H5 少传一个字段就会让容器把页面退掉。
 */
import { BridgeServer } from '../../src/bridge/bridge-server';
import { BRIDGE_EVENTS } from '../../src/bridge/protocol';
import { registerAppModule, setNativeBackResultHandler } from '../../src/bridge/modules/app';

let reqSeq = 0;

function makeServer(): BridgeServer {
  const server = new BridgeServer({ timeoutMs: 1000 });
  registerAppModule(server);
  return server;
}

async function call(server: BridgeServer, action: string, params: unknown) {
  reqSeq += 1;
  return server.handle({
    type: 'request',
    id: `app-${action}-${reqSeq}`,
    version: '1.0.0',
    module: 'app',
    action,
    params,
  });
}

describe('app.nativeBackResult 回执', () => {
  afterEach(() => {
    setNativeBackResultHandler(null);
  });

  test('事件名钉死为 native.back / keyboard.change', () => {
    expect(BRIDGE_EVENTS.NATIVE_BACK).toBe('native.back');
    expect(BRIDGE_EVENTS.KEYBOARD_CHANGE).toBe('keyboard.change');
  });

  test('consumed 原样透给容器（true 不兜底、false 触发兜底）', async () => {
    const seen: boolean[] = [];
    setNativeBackResultHandler(consumed => seen.push(consumed));
    const server = makeServer();
    await call(server, 'nativeBackResult', { consumed: true });
    await call(server, 'nativeBackResult', { consumed: false });
    expect(seen).toEqual([true, false]);
  });

  test('H5 漏传 consumed 时按已处理收（不能让容器乱退页面）', async () => {
    const seen: boolean[] = [];
    setNativeBackResultHandler(consumed => seen.push(consumed));
    const server = makeServer();
    await call(server, 'nativeBackResult', {});
    await call(server, 'nativeBackResult', undefined);
    expect(seen).toEqual([true, true]);
  });

  test('未注册处理者（WebView 已卸载）时回执不报错', async () => {
    const res = await call(makeServer(), 'nativeBackResult', { consumed: false });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ok: true });
  });

  test('getCapabilities 暴露 clipboard / openApp 两项', async () => {
    const res = await call(makeServer(), 'getCapabilities', {});
    const features = (res.data as { features: Record<string, boolean> }).features;
    expect(Object.keys(features)).toEqual(
      expect.arrayContaining(['clipboard', 'openApp', 'nfc', 'share']),
    );
  });
});
