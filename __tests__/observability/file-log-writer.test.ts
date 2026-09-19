/**
 * FileLogWriter 单元测试：批量写入、按天分文件、retentionDays 过期清理。
 */
import { FileLogWriter, MemoryFileSystemAdapter } from '../../src/observability/file-log-writer';
import type { LogEntry } from '../../src/observability/log-entry';

const baseEntry: LogEntry = {
  id: 'log_1',
  timestamp: new Date().toISOString(),
  category: 'h5_event_log',
  level: 'info',
  event: 'button_click',
  data: { page: '/login', button: '登录', fn: 'handleLogin' },
};

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return { ...baseEntry, ...overrides };
}

/** 格式化日期为 YYYY-MM-DD。 */
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 返回 N 天前的日期。 */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

describe('FileLogWriter 基础写入', () => {
  test('写入日志追加到按天文件', async () => {
    const adapter = new MemoryFileSystemAdapter();
    const writer = new FileLogWriter({
      adapter,
      dir: 'logs',
      category: 'h5_event_log',
    });

    writer.write(makeEntry());
    writer.write(makeEntry({ event: 'click2' }));
    await writer.flush();

    const files = adapter.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^logs\/h5_event_log_\d{4}-\d{2}-\d{2}\.log$/);

    const content = await adapter.readFile(files[0]);
    expect(content).toContain('button_click');
    expect(content).toContain('click2');
    await writer.destroy();
  });

  test('缓冲未满时 flush 后清空缓冲', async () => {
    const adapter = new MemoryFileSystemAdapter();
    const writer = new FileLogWriter({ adapter, dir: 'logs' });

    writer.write(makeEntry());
    expect(writer.bufferSize()).toBe(1);
    const ok = await writer.flush();
    expect(ok).toBe(true);
    expect(writer.bufferSize()).toBe(0);
    await writer.destroy();
  });
});

describe('FileLogWriter retentionDays 过期清理', () => {
  test('默认 7 天：删除 8 天前文件，保留 6 天前/今天/无关文件', async () => {
    const adapter = new MemoryFileSystemAdapter();
    const dir = 'logs';
    await adapter.mkdir(dir);
    await adapter.appendFile(`${dir}/h5_event_log_${fmtDate(daysAgo(8))}.log`, 'old-8d\n');
    await adapter.appendFile(`${dir}/h5_event_log_${fmtDate(daysAgo(6))}.log`, 'old-6d\n');
    await adapter.appendFile(`${dir}/h5_event_log_${fmtDate(daysAgo(0))}.log`, 'today\n');
    await adapter.appendFile(`${dir}/other.log`, 'unrelated\n');

    const writer = new FileLogWriter({
      adapter,
      dir,
      category: 'h5_event_log',
    });
    writer.write(makeEntry());
    await writer.flush();

    const files = adapter.listFiles();
    expect(files.some(f => f.includes(fmtDate(daysAgo(8))))).toBe(false); // 8天前被删
    expect(files.some(f => f.includes(fmtDate(daysAgo(6))))).toBe(true); // 6天前保留
    expect(files.some(f => f.includes(fmtDate(daysAgo(0))))).toBe(true); // 今天保留
    expect(files.some(f => f.endsWith('other.log'))).toBe(true); // 无关文件保留
    await writer.destroy();
  });

  test('自定义 retentionDays=3：删除 4 天前文件，保留 2 天前文件', async () => {
    const adapter = new MemoryFileSystemAdapter();
    const dir = 'logs';
    await adapter.mkdir(dir);
    await adapter.appendFile(`${dir}/h5_event_log_${fmtDate(daysAgo(4))}.log`, 'old\n');
    await adapter.appendFile(`${dir}/h5_event_log_${fmtDate(daysAgo(2))}.log`, 'keep\n');

    const writer = new FileLogWriter({
      adapter,
      dir,
      category: 'h5_event_log',
      retentionDays: 3,
    });
    writer.write(makeEntry());
    await writer.flush();

    const files = adapter.listFiles();
    expect(files.some(f => f.includes(fmtDate(daysAgo(4))))).toBe(false);
    expect(files.some(f => f.includes(fmtDate(daysAgo(2))))).toBe(true);
    await writer.destroy();
  });

  test('retentionDays=0 表示不清理', async () => {
    const adapter = new MemoryFileSystemAdapter();
    const dir = 'logs';
    await adapter.mkdir(dir);
    await adapter.appendFile(`${dir}/h5_event_log_${fmtDate(daysAgo(30))}.log`, 'old\n');

    const writer = new FileLogWriter({
      adapter,
      dir,
      category: 'h5_event_log',
      retentionDays: 0,
    });
    writer.write(makeEntry());
    await writer.flush();

    expect(adapter.listFiles().some(f => f.includes(fmtDate(daysAgo(30))))).toBe(true);
    await writer.destroy();
  });

  test('适配器不支持 readdir/unlink 时跳过清理（不报错）', async () => {
    // 无 readdir/unlink 的简易适配器
    const minimalAdapter = {
      exists: async () => true,
      mkdir: async () => undefined,
      appendFile: async () => undefined,
    };
    const writer = new FileLogWriter({
      adapter: minimalAdapter as never,
      dir: 'logs',
    });
    writer.write(makeEntry());
    await expect(writer.flush()).resolves.toBe(true);
    await writer.destroy();
  });

  test('同一天多次 flush 只清理一次', async () => {
    const adapter = new MemoryFileSystemAdapter();
    const dir = 'logs';
    await adapter.mkdir(dir);

    const writer = new FileLogWriter({
      adapter,
      dir,
      category: 'h5_event_log',
      retentionDays: 7,
    });
    const spy = jest.spyOn(
      writer as unknown as { cleanupExpired: () => Promise<string[]> },
      'cleanupExpired',
    );

    writer.write(makeEntry());
    await writer.flush(); // 第一次触发清理
    writer.write(makeEntry({ event: 'e2' }));
    await writer.flush(); // 同一天，不再触发
    await writer.destroy();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
