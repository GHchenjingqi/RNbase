/**
 * H5 READY 握手（规则 9）：app.ready / app.lifecycle 桥接测试。
 */
import { createBridgeServer } from '../src/bridge/index';

describe('lifecycle module (rule 9)', () => {
  it('app.ready invokes onReady and returns ok', async () => {
    const onReady = jest.fn();
    const server = createBridgeServer(undefined, {}, { onReady });
    const res = await server.handle({
      type: 'request',
      id: 'r1',
      version: '1.0.0',
      module: 'app',
      action: 'ready',
      params: { h5Version: '2026.08.31.001', bridgeVersion: '1.0.0' },
    });
    expect(res.success).toBe(true);
    expect(onReady).toHaveBeenCalledWith({
      h5Version: '2026.08.31.001',
      bridgeVersion: '1.0.0',
    });
  });

  it('app.lifecycle invokes onLifecycle', async () => {
    const onLifecycle = jest.fn();
    const server = createBridgeServer(undefined, {}, { onLifecycle });
    const res = await server.handle({
      type: 'request',
      id: 'r2',
      version: '1.0.0',
      module: 'app',
      action: 'lifecycle',
      params: { event: 'resume' },
    });
    expect(res.success).toBe(true);
    expect(onLifecycle).toHaveBeenCalledWith('resume');
  });
});
