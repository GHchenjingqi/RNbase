/**
 * App 启动决策与 Bridge 组装单测。
 */
import { resolveH5Source } from '../src/app/resolve-h5-source';
import { createAppBridgeServer } from '../src/app/compose-bridge-server';

const FALLBACK = '<html>fallback</html>';

function fakeRuntime(entry: string) {
  return { resolveEntry: async () => entry };
}

describe('resolveH5Source (rule 5/34)', () => {
  it('prefers a resolved local/remote entry', async () => {
    const src = await resolveH5Source(fakeRuntime('https://cdn/x/index.html'), FALLBACK);
    expect(src).toEqual({ uri: 'https://cdn/x/index.html' });
  });

  it('falls back to built-in H5 when no entry', async () => {
    const src = await resolveH5Source(fakeRuntime(''), FALLBACK);
    expect(src).toEqual({ html: FALLBACK });
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
