/**
 * Phase 14：性能优化单元测试（规范 §61、§31、§23、§57）。
 */
import { PerformanceMonitor, DEFAULT_BASELINES } from '../../src/performance/performance-monitor';
import { Throttler, BatchRequester } from '../../src/performance/optimizers';
import { MemoryMonitor, TempFileCleaner } from '../../src/performance/memory-and-cleanup';

describe('P14.1 性能监控器', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  afterEach(() => {
    monitor.destroy();
  });

  test('start/end 计时指标', () => {
    const id = monitor.start('bridge_call', 'test_bridge');
    expect(id).toBeDefined();
    const metric = monitor.end(id);
    expect(metric).not.toBeNull();
    expect(metric?.type).toBe('bridge_call');
    expect(metric?.name).toBe('test_bridge');
    expect(metric?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('end 不存在的 ID 返回 null', () => {
    expect(monitor.end('nonexistent')).toBeNull();
  });

  test('record 直接记录指标', () => {
    const metric = monitor.record('app_cold_start', '冷启动', 1200);
    expect(metric.type).toBe('app_cold_start');
    expect(metric.durationMs).toBe(1200);
  });

  test('超过基线阈值触发告警', () => {
    const alerts: string[] = [];
    const m = new PerformanceMonitor({
      onAlert: alert => alerts.push(alert.message),
    });
    m.record('app_cold_start', 'App 冷启动', 5000); // 超过 3000ms 阈值
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toContain('超过阈值');
    m.destroy();
  });

  test('未超过基线阈值不触发告警', () => {
    const alerts: string[] = [];
    const m = new PerformanceMonitor({
      onAlert: alert => alerts.push(alert.message),
    });
    m.record('app_cold_start', 'App 冷启动', 1000); // 低于 3000ms 阈值
    expect(alerts).toHaveLength(0);
    m.destroy();
  });

  test('getMetrics 按类型过滤', () => {
    monitor.record('bridge_call', 'b1', 50);
    monitor.record('app_cold_start', 'a1', 1000);
    monitor.record('bridge_call', 'b2', 60);
    const bridgeMetrics = monitor.getMetrics('bridge_call');
    expect(bridgeMetrics).toHaveLength(2);
  });

  test('getMetrics 限制数量', () => {
    for (let i = 0; i < 10; i++) {
      monitor.record('bridge_call', `b${i}`, 50);
    }
    const metrics = monitor.getMetrics('bridge_call', 5);
    expect(metrics).toHaveLength(5);
  });

  test('getAlerts 返回告警列表', () => {
    monitor.record('app_cold_start', 'App 冷启动', 5000);
    const alerts = monitor.getAlerts();
    expect(alerts.length).toBeGreaterThan(0);
  });

  test('getBaselines 返回默认基线', () => {
    const baselines = monitor.getBaselines();
    expect(baselines.length).toBe(DEFAULT_BASELINES.length);
  });

  test('updateBaseline 更新基线', () => {
    monitor.updateBaseline({
      type: 'bridge_call',
      name: 'Bridge 调用',
      maxDurationMs: 1000,
    });
    const baselines = monitor.getBaselines();
    const bridge = baselines.find(b => b.type === 'bridge_call' && b.name === 'Bridge 调用');
    expect(bridge?.maxDurationMs).toBe(1000);
  });

  test('generateReport 生成性能报告', () => {
    monitor.record('bridge_call', 'Bridge 调用', 50);
    monitor.record('bridge_call', 'Bridge 调用', 100);
    monitor.record('app_cold_start', 'App 冷启动', 1200);
    const report = monitor.generateReport();
    expect(report.summary.totalMetrics).toBe(3);
    expect(report.metrics.length).toBeGreaterThan(0);
  });

  test('generateReport 统计 P50/P95/P99', () => {
    for (let i = 1; i <= 100; i++) {
      monitor.record('bridge_call', 'Bridge 调用', i);
    }
    const report = monitor.generateReport();
    const bridge = report.metrics.find(m => m.type === 'bridge_call');
    expect(bridge?.p50DurationMs).toBeDefined();
    expect(bridge?.p95DurationMs).toBeDefined();
    expect(bridge?.p99DurationMs).toBeDefined();
  });

  test('clear 清空所有指标和告警', () => {
    monitor.record('bridge_call', 'b1', 50);
    monitor.clear();
    expect(monitor.getMetrics()).toHaveLength(0);
    expect(monitor.getAlerts()).toHaveLength(0);
  });

  test('最大指标记录数限制', () => {
    const m = new PerformanceMonitor({ maxMetrics: 10 });
    for (let i = 0; i < 20; i++) {
      m.record('bridge_call', `b${i}`, 50);
    }
    expect(m.getMetrics()).toHaveLength(10);
    m.destroy();
  });

  test('onMetricComplete 回调', () => {
    const completed: string[] = [];
    const m = new PerformanceMonitor({
      onMetricComplete: metric => completed.push(metric.name),
    });
    m.record('bridge_call', 'test', 50);
    expect(completed).toContain('test');
    m.destroy();
  });
});

describe('P14.2 高频事件节流器', () => {
  test('节流调用不超过频率限制', async () => {
    const calls: number[] = [];
    const throttler = new Throttler<number>(n => calls.push(n), {
      minIntervalMs: 50,
    });

    for (let i = 0; i < 10; i++) {
      throttler.call(i);
    }

    // 立即执行的只有 1 次（首次）
    expect(calls.length).toBeLessThanOrEqual(2);

    // 等待 trailing 执行
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    throttler.destroy();
  });

  test('leading 首次立即执行', () => {
    const calls: number[] = [];
    const throttler = new Throttler<number>(n => calls.push(n), {
      leading: true,
      minIntervalMs: 100,
    });
    throttler.call(1);
    expect(calls).toContain(1);
    throttler.destroy();
  });

  test('trailing 最后一次执行', async () => {
    const calls: number[] = [];
    const throttler = new Throttler<number>(n => calls.push(n), {
      trailing: true,
      minIntervalMs: 50,
    });
    throttler.call(1);
    throttler.call(2);
    throttler.call(3);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(calls).toContain(3);
    throttler.destroy();
  });

  test('flush 立即执行', () => {
    const calls: number[] = [];
    const throttler = new Throttler<number>(n => calls.push(n), {
      minIntervalMs: 1000,
    });
    throttler.call(1);
    throttler.flush();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    throttler.destroy();
  });

  test('cancel 取消待执行', async () => {
    const calls: number[] = [];
    const throttler = new Throttler<number>(n => calls.push(n), {
      minIntervalMs: 50,
    });
    throttler.call(1);
    throttler.cancel();
    await new Promise(resolve => setTimeout(resolve, 100));
    // 只有首次立即执行的（如果没有 leading）
    expect(calls.length).toBe(0);
    throttler.destroy();
  });

  test('maxWaitMs 最大等待时间', async () => {
    const calls: number[] = [];
    const throttler = new Throttler<number>(n => calls.push(n), {
      minIntervalMs: 100,
      maxWaitMs: 50,
    });
    // 持续调用，maxWaitMs 后应该强制执行
    const interval = setInterval(() => throttler.call(Date.now()), 10);
    await new Promise(resolve => setTimeout(resolve, 150));
    clearInterval(interval);
    expect(calls.length).toBeGreaterThan(0);
    throttler.destroy();
  });
});

describe('P14.3 批量请求合并器', () => {
  test('多个请求合并为一批', async () => {
    const handler = jest.fn(async items => {
      return items.map(item => ({
        id: item.id,
        result: `result_${item.data}`,
      }));
    });
    const batch = new BatchRequester({
      handler,
      maxWaitMs: 50,
      maxBatchSize: 10,
    });

    const results = await Promise.all([batch.request('a'), batch.request('b'), batch.request('c')]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toHaveLength(3);
    expect(results).toEqual(['result_a', 'result_b', 'result_c']);
    batch.destroy();
  });

  test('超过 maxBatchSize 分批', async () => {
    const handler = jest.fn(async items => {
      return items.map(item => ({ id: item.id, result: item.data }));
    });
    const batch = new BatchRequester({
      handler,
      maxWaitMs: 50,
      maxBatchSize: 2,
    });

    const results = await Promise.all([batch.request('a'), batch.request('b'), batch.request('c')]);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(results).toEqual(['a', 'b', 'c']);
    batch.destroy();
  });

  test('flush 立即处理', async () => {
    const handler = jest.fn(async items => {
      return items.map(item => ({ id: item.id, result: item.data }));
    });
    const batch = new BatchRequester({ handler, maxWaitMs: 1000 });

    const promise = batch.request('a');
    batch.flush();
    const result = await promise;

    expect(result).toBe('a');
    expect(handler).toHaveBeenCalledTimes(1);
    batch.destroy();
  });

  test('handler 错误时所有请求 reject', async () => {
    const handler = jest.fn(async () => {
      throw new Error('batch error');
    });
    const batch = new BatchRequester({ handler, maxWaitMs: 50 });

    await expect(batch.request('a')).rejects.toThrow('batch error');
    batch.destroy();
  });

  test('pendingCount 返回待处理数', () => {
    const batch = new BatchRequester({
      handler: async items => items.map(i => ({ id: i.id, result: i.data })),
      maxWaitMs: 1000,
    });
    const p1 = batch.request('a');
    const p2 = batch.request('b');
    // 捕获未处理的 Promise rejection
    p1.catch(() => undefined);
    p2.catch(() => undefined);
    expect(batch.pendingCount()).toBe(2);
    batch.destroy();
  });

  test('destroy 时所有待处理请求 reject', async () => {
    const batch = new BatchRequester({
      handler: async items => items.map(i => ({ id: i.id, result: i.data })),
      maxWaitMs: 1000,
    });
    const promise = batch.request('a');
    batch.destroy();
    await expect(promise).rejects.toThrow('destroyed');
  });
});

describe('P14.4 内存监控器', () => {
  test('sample 采集内存快照', async () => {
    const monitor = new MemoryMonitor({
      getMemory: async () => ({ timestamp: Date.now(), usedMB: 100 }),
    });
    const snapshot = await monitor.sample();
    expect(snapshot.usedMB).toBe(100);
    expect(monitor.getSnapshots()).toHaveLength(1);
    monitor.destroy();
  });

  test('start/stop 定期采样', async () => {
    const monitor = new MemoryMonitor({
      sampleIntervalMs: 50,
      getMemory: async () => ({ timestamp: Date.now(), usedMB: 100 }),
    });
    monitor.start();
    await new Promise(resolve => setTimeout(resolve, 150));
    monitor.stop();
    expect(monitor.getSnapshots().length).toBeGreaterThanOrEqual(2);
    monitor.destroy();
  });

  test('超过警告阈值触发告警', async () => {
    const alerts: string[] = [];
    const monitor = new MemoryMonitor({
      thresholds: { warningMB: 150, criticalMB: 250 },
      getMemory: async () => ({ timestamp: Date.now(), usedMB: 200 }),
      onAlert: (_level, _snapshot, message) => alerts.push(message),
    });
    await monitor.sample();
    expect(alerts.some(a => a.includes('警告阈值'))).toBe(true);
    monitor.destroy();
  });

  test('超过严重阈值触发严重告警', async () => {
    const levels: string[] = [];
    const monitor = new MemoryMonitor({
      thresholds: { warningMB: 150, criticalMB: 250 },
      getMemory: async () => ({ timestamp: Date.now(), usedMB: 300 }),
      onAlert: level => levels.push(level),
    });
    await monitor.sample();
    expect(levels).toContain('critical');
    monitor.destroy();
  });

  test('detectLeak 检测持续增长', async () => {
    const monitor = new MemoryMonitor({
      thresholds: { growthWindowSec: 10, growthRatePercentPerMin: 5 },
    });
    // 模拟持续增长的快照
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      (
        monitor as unknown as {
          snapshots: Array<{ timestamp: number; usedMB: number }>;
        }
      ).snapshots.push({
        timestamp: now - (5 - i) * 1000,
        usedMB: 100 + i * 20,
      });
    }
    const leak = monitor.detectLeak();
    expect(leak.leaking).toBe(true);
    expect(leak.growthRate).toBeGreaterThan(5);
    monitor.destroy();
  });

  test('getCurrent 返回最新快照', async () => {
    const monitor = new MemoryMonitor({
      getMemory: async () => ({ timestamp: Date.now(), usedMB: 100 }),
    });
    expect(monitor.getCurrent()).toBeNull();
    await monitor.sample();
    expect(monitor.getCurrent()?.usedMB).toBe(100);
    monitor.destroy();
  });

  test('clear 清空快照', async () => {
    const monitor = new MemoryMonitor({
      getMemory: async () => ({ timestamp: Date.now(), usedMB: 100 }),
    });
    await monitor.sample();
    monitor.clear();
    expect(monitor.getSnapshots()).toHaveLength(0);
    monitor.destroy();
  });
});

describe('P14.5 临时文件清理器', () => {
  test('清理过期文件', async () => {
    const now = Date.now();
    const files = [
      { uri: 'file:///old1', size: 1000, createdAt: now - 48 * 60 * 60 * 1000 }, // 48 小时前
      { uri: 'file:///new1', size: 2000, createdAt: now - 1000 }, // 1 秒前
    ];
    const deleted: string[] = [];
    const cleaner = new TempFileCleaner({
      maxAgeMs: 24 * 60 * 60 * 1000,
      listFiles: async () => files,
      deleteFile: async uri => {
        deleted.push(uri);
        return true;
      },
    });

    const result = await cleaner.clean();
    expect(result.deletedCount).toBe(1);
    expect(deleted).toContain('file:///old1');
    expect(deleted).not.toContain('file:///new1');
    cleaner.destroy();
  });

  test('超过最大大小时清理最旧文件', async () => {
    const now = Date.now();
    const files = [
      { uri: 'file:///old', size: 80 * 1024 * 1024, createdAt: now - 1000 }, // 80MB
      { uri: 'file:///new', size: 30 * 1024 * 1024, createdAt: now }, // 30MB
    ];
    const deleted: string[] = [];
    const cleaner = new TempFileCleaner({
      maxSizeMB: 50,
      listFiles: async () => files,
      deleteFile: async uri => {
        deleted.push(uri);
        return true;
      },
    });

    await cleaner.clean();
    expect(deleted).toContain('file:///old');
    cleaner.destroy();
  });

  test('start/stop 定期清理', async () => {
    let cleanCount = 0;
    const cleaner = new TempFileCleaner({
      cleanIntervalMs: 50,
      listFiles: async () => [],
      deleteFile: async () => true,
      onClean: () => {
        cleanCount += 1;
      },
    });
    cleaner.start();
    await new Promise(resolve => setTimeout(resolve, 150));
    cleaner.stop();
    expect(cleanCount).toBeGreaterThanOrEqual(2);
    cleaner.destroy();
  });

  test('onClean 回调返回释放空间', async () => {
    const now = Date.now();
    const cleaner = new TempFileCleaner({
      maxAgeMs: 1000,
      listFiles: async () => [{ uri: 'file:///old', size: 5 * 1024 * 1024, createdAt: now - 5000 }],
      deleteFile: async () => true,
    });
    const result = await cleaner.clean();
    expect(result.freedSizeMB).toBeCloseTo(5, 1);
    cleaner.destroy();
  });

  test('删除失败不影响其他文件', async () => {
    const now = Date.now();
    const cleaner = new TempFileCleaner({
      maxAgeMs: 1000,
      listFiles: async () => [
        { uri: 'file:///fail', size: 1000, createdAt: now - 5000 },
        { uri: 'file:///ok', size: 2000, createdAt: now - 5000 },
      ],
      deleteFile: async uri => uri !== 'file:///fail',
    });
    const result = await cleaner.clean();
    expect(result.deletedCount).toBe(1);
    cleaner.destroy();
  });
});
