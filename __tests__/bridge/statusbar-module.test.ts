/**
 * statusbar 模块 barStyle 仲裁单元测试。
 * H5 经 Bridge 接管 barStyle 后，组合根据此跳过系统深浅色覆盖。
 */
import { BridgeServer } from '../../src/bridge/bridge-server';
import {
  registerStatusBarModule,
  getH5BarStyleOverride,
  setH5BarStyleListener,
} from '../../src/bridge/modules/statusbar';
import type { BarStyle } from '../../src/bridge/modules/statusbar';

function makeServer(): BridgeServer {
  return new BridgeServer({ timeoutMs: 1000 });
}

let seq = 0;

function callSetBarStyle(server: BridgeServer, params: unknown) {
  // BridgeServer 有 RequestIdTracker 防重放：同一 server 内 id 必须唯一
  seq += 1;
  return server.handle({
    type: 'request',
    id: `t${seq}`,
    version: '1.0.0',
    module: 'statusBar',
    action: 'setBarStyle',
    params,
  });
}

describe('statusbar barStyle 仲裁', () => {
  test('未接管时 override 为 null', () => {
    expect(getH5BarStyleOverride()).toBeNull();
  });

  test('H5 setBarStyle 后记录接管值并通知监听者', async () => {
    const server = makeServer();
    registerStatusBarModule(server);
    const received: BarStyle[] = [];
    setH5BarStyleListener((style) => received.push(style));
    try {
      const res = await callSetBarStyle(server, { style: 'light-content' });
      expect(res.success).toBe(true);
      expect(getH5BarStyleOverride()).toBe('light-content');
      expect(received).toEqual(['light-content']);
    } finally {
      setH5BarStyleListener(null);
    }
  });

  test('缺省 style 记录为 default', async () => {
    const server = makeServer();
    registerStatusBarModule(server);
    try {
      await callSetBarStyle(server, undefined);
      expect(getH5BarStyleOverride()).toBe('default');
    } finally {
      setH5BarStyleListener(null);
    }
  });

  test('多次调用取最新值；清掉监听后不再通知', async () => {
    const server = makeServer();
    registerStatusBarModule(server);
    const received: BarStyle[] = [];
    setH5BarStyleListener((style) => received.push(style));
    await callSetBarStyle(server, { style: 'dark-content' });
    setH5BarStyleListener(null);
    await callSetBarStyle(server, { style: 'default' });
    expect(getH5BarStyleOverride()).toBe('default');
    expect(received).toEqual(['dark-content']);
  });
});
