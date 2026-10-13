/**
 * P2-2：崩溃上报闭环单元测试（缓冲 / flush / 上报失败保留 / 自动冲刷 / HTTP 工厂）。
 */
import {
  reportCrash,
  recordCrash,
  getCrashBuffer,
  setCrashUploader,
  flushCrashReports,
  createHttpCrashUploader,
  type CrashUploader,
  type CrashRecord,
} from '../../src/diagnostics/crash-reporter';

function sampleRecord(overrides: Partial<CrashRecord> = {}): CrashRecord {
  return {
    ts: Date.now(),
    message: 'boom',
    stack: 'stack-trace',
    context: 'global',
    fatal: false,
    os: 'android',
    appVersion: '1.0.0',
    ...overrides,
  };
}

describe('P2-2 崩溃上报闭环', () => {
  // 每个用例前清空共享缓冲，避免跨用例污染
  beforeEach(async () => {
    setCrashUploader({ upload: async () => ({ ok: true }) });
    await flushCrashReports();
    setCrashUploader(null);
  });

  afterEach(() => setCrashUploader(null));

  test('recordCrash 入缓冲且 getCrashBuffer 返回隔离副本', () => {
    recordCrash(sampleRecord());
    const buf = getCrashBuffer();
    expect(buf.length).toBe(1);
    // 修改副本不影响内部缓冲
    buf.push(buf[0]);
    expect(getCrashBuffer().length).toBe(1);
  });

  test('flush 经上报器上报成功并清空缓冲', async () => {
    const uploaded: CrashRecord[][] = [];
    const uploader: CrashUploader = {
      upload: async (r) => {
        uploaded.push(r);
        return { ok: true };
      },
    };
    setCrashUploader(uploader);
    recordCrash(sampleRecord({ message: 'x' }));
    const n = await flushCrashReports();
    expect(n).toBe(1);
    expect(uploaded[0].length).toBe(1);
    expect(getCrashBuffer().length).toBe(0);
  });

  test('上报失败保留缓冲以便重试', async () => {
    const uploader: CrashUploader = { upload: async () => ({ ok: false }) };
    setCrashUploader(uploader);
    recordCrash(sampleRecord({ message: 'y' }));
    const n = await flushCrashReports();
    expect(n).toBe(0);
    expect(getCrashBuffer().length).toBe(1);
  });

  test('reportCrash 自动触发异步冲刷', async () => {
    const uploaded: CrashRecord[][] = [];
    const uploader: CrashUploader = {
      upload: async (r) => {
        uploaded.push(r);
        return { ok: true };
      },
    };
    setCrashUploader(uploader);
    reportCrash(new Error('crash-on-render'), 'render');
    // 等待 reportCrash 内自动 flush 的微任务
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushCrashReports();
    expect(uploaded.length).toBeGreaterThanOrEqual(1);
    expect(getCrashBuffer().length).toBe(0);
  });

  test('createHttpCrashUploader 调用 fetch 且透传 ok', async () => {
    const g = globalThis as unknown as {
      fetch?: (url: string, init: { method?: string; body?: string }) => Promise<{ ok: boolean }>;
    };
    const orig = g.fetch;
    let captured: { url: string; init: { method?: string; body?: string } } | null = null;
    g.fetch = async (url, init) => {
      captured = { url, init };
      return { ok: true };
    };
    try {
      const up = createHttpCrashUploader('https://gw.example.com/crashes');
      const res = await up.upload([sampleRecord({ message: 'net' })]);
      expect(res.ok).toBe(true);
      expect(captured?.url).toBe('https://gw.example.com/crashes');
      expect(captured?.init.method).toBe('POST');
      expect(captured?.init.body).toContain('"crashes"');
    } finally {
      g.fetch = orig;
    }
  });
});
