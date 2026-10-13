/**
 * P3-1：Feature Flag 远程配置单元测试（TTL 缓存 / 失败降级 / 类型过滤 / getFlag）。
 */
import { RemoteConfig, type RemoteFlags } from '../../src/config/remote-config';
import type { HttpFetcher } from '../../src/updater/manifest-client';

function makeFetcher(responses: Array<{ ok: boolean; status: number; body: unknown }>): {
  fetcher: HttpFetcher;
  calls: () => number;
} {
  let i = 0;
  const fetcher: HttpFetcher = async () => {
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: res.ok,
      status: res.status,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    };
  };
  return { fetcher, calls: () => i };
}

describe('P3-1 RemoteConfig', () => {
  test('正常拉取并解析合法 flag', async () => {
    const { fetcher } = makeFetcher([
      { ok: true, status: 200, body: { 'perf.enabled': true, 'update.throttle': 3600 } },
    ]);
    const rc = new RemoteConfig({ flagsUrl: 'https://cdn/flags.json', fetcher, cacheTtlMs: 0 });
    const flags = await rc.getFlags();
    expect(flags['perf.enabled']).toBe(true);
    expect(flags['update.throttle']).toBe(3600);
  });

  test('非 boolean/number/string 的脏 key 被丢弃，不污染配置', async () => {
    const { fetcher } = makeFetcher([
      { ok: true, status: 200, body: { good: 'ok', bad: { nested: 1 }, arr: [1] } },
    ]);
    const rc = new RemoteConfig({ flagsUrl: 'https://cdn/flags.json', fetcher, cacheTtlMs: 0 });
    const flags = await rc.getFlags();
    expect(flags).toEqual({ good: 'ok' });
  });

  test('拉取失败降级 defaults，且不缓存失败结果', async () => {
    const { fetcher, calls } = makeFetcher([{ ok: false, status: 500, body: null }]);
    const defaults: RemoteFlags = { 'perf.enabled': false };
    const rc = new RemoteConfig({
      flagsUrl: 'https://cdn/flags.json',
      fetcher,
      cacheTtlMs: 0,
      defaults,
    });
    const flags1 = await rc.getFlags();
    expect(flags1['perf.enabled']).toBe(false);
    const flags2 = await rc.getFlags();
    expect(flags2['perf.enabled']).toBe(false);
    // 失败不缓存：两次都真实发起请求
    expect(calls()).toBe(2);
  });

  test('last-known-good：一次成功后失败，回落上次成功值', async () => {
    let ok = true;
    const fetcher: HttpFetcher = async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ 'flag.a': 'v1' }),
      text: async () => '',
    });
    const rc = new RemoteConfig({ flagsUrl: 'https://cdn/flags.json', fetcher, cacheTtlMs: 0 });
    expect((await rc.getFlags())['flag.a']).toBe('v1');
    ok = false;
    expect((await rc.getFlags())['flag.a']).toBe('v1');
    expect(rc.getLastKnownGood()).toEqual({ 'flag.a': 'v1' });
  });

  test('TTL 缓存生效：窗口内不重复拉取', async () => {
    const { fetcher, calls } = makeFetcher([{ ok: true, status: 200, body: { a: 1 } }]);
    const rc = new RemoteConfig({
      flagsUrl: 'https://cdn/flags.json',
      fetcher,
      cacheTtlMs: 60_000,
    });
    await rc.getFlags();
    await rc.getFlags();
    expect(calls()).toBe(1);
    rc.clearCache();
    await rc.getFlags();
    expect(calls()).toBe(2);
  });

  test('getFlag：类型匹配返回远端值，否则返回 fallback', async () => {
    const { fetcher } = makeFetcher([
      { ok: true, status: 200, body: { 'str.flag': 'hello', 'num.flag': 42, 'bool.flag': true } },
    ]);
    const rc = new RemoteConfig({ flagsUrl: 'https://cdn/flags.json', fetcher, cacheTtlMs: 0 });
    expect(await rc.getFlag('str.flag', 'default')).toBe('hello');
    expect(await rc.getFlag('num.flag', 0)).toBe(42);
    expect(await rc.getFlag('bool.flag', false)).toBe(true);
    expect(await rc.getFlag('missing.flag', 'fb')).toBe('fb');
    // 类型不匹配：远端是 string，本地要 number → fallback
    expect(await rc.getFlag('str.flag', 0)).toBe(0);
  });

  test('非法 JSON（非对象）按失败降级', async () => {
    const { fetcher } = makeFetcher([{ ok: true, status: 200, body: 'not-an-object' }]);
    const rc = new RemoteConfig({
      flagsUrl: 'https://cdn/flags.json',
      fetcher,
      cacheTtlMs: 0,
      defaults: { d: true },
    });
    const flags = await rc.getFlags();
    expect(flags).toEqual({ d: true });
  });
});
