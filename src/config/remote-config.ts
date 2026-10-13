/**
 * Feature Flag 远程配置（P3 通用基座能力）。
 *
 * 目的：为基座提供「不发版即可开/关某项能力」的运行时开关
 * （如性能基线启停、诊断入口可见性、更新检查频率调整等），业务开关由 H5 侧自建。
 *
 * 设计：
 *  - 复用更新器 manifest 通道的 HttpFetcher 契约（同一套 CDN/网关，不新增依赖）；
 *  - TTL 短缓存 + last-known-good：拉取失败时降级为上次成功值，再降级为本地默认值；
 *  - 值类型收敛为 boolean / number / string，避免配置面膨胀。
 */
import type { HttpFetcher } from '../updater/manifest-client';

/** 开关值类型（刻意收窄，防配置面失控）。 */
export type FlagValue = boolean | number | string;

/** 开关集合：`{ "flag.key": value }`，点号分命名空间。 */
export type RemoteFlags = Record<string, FlagValue>;

export type RemoteConfigOptions = {
  /** flags JSON 地址（约定与 manifest 同源：{base}/flags.json） */
  flagsUrl: string;
  /** HTTP 客户端，默认全局 fetch */
  fetcher?: HttpFetcher;
  /** 缓存时长（毫秒），默认 5 分钟；0 表示每次都拉 */
  cacheTtlMs?: number;
  /** 本地默认值（离线/拉取失败时的兜底） */
  defaults?: RemoteFlags;
};

export class RemoteConfig {
  private readonly flagsUrl: string;
  private readonly fetcher: HttpFetcher;
  private readonly cacheTtlMs: number;
  private readonly defaults: RemoteFlags;
  private cache: { flags: RemoteFlags; fetchedAt: number } | null = null;
  private lastKnownGood: RemoteFlags | null = null;

  constructor(options: RemoteConfigOptions) {
    this.flagsUrl = options.flagsUrl;
    this.fetcher = options.fetcher ?? RemoteConfig.defaultFetcher;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60_000;
    this.defaults = options.defaults ?? {};
  }

  /**
   * 拉取全部开关（带 TTL 缓存与逐级降级）。
   * 降级链：缓存/last-known-good → defaults，保证任何情况下都有可用配置。
   */
  async getFlags(): Promise<RemoteFlags> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.cacheTtlMs) {
      return this.cache.flags;
    }
    try {
      const res = await this.fetcher(this.flagsUrl, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) {
        throw new Error(`flags 拉取失败: HTTP ${res.status}`);
      }
      const data = (await res.json()) as unknown;
      const flags = this.validateFlags(data);
      this.lastKnownGood = flags;
      this.cache = { flags, fetchedAt: now };
      return flags;
    } catch {
      // 拉取失败：降级 last-known-good，再降级 defaults（不缓存失败结果，下次可重试）
      const fallback = this.lastKnownGood ?? this.defaults;
      return { ...this.defaults, ...fallback };
    }
  }

  /**
   * 读取单个开关。类型不匹配或不存在时返回 fallback。
   * async 统一走远端（与 getFlags 同缓存），便于调用方书写。
   */
  async getFlag<T extends FlagValue>(key: string, fallback: T): Promise<T> {
    const flags = await this.getFlags();
    const value = flags[key];
    if (typeof value === typeof fallback) {
      return value as T;
    }
    return fallback;
  }

  /** 清除缓存（测试 / 强制刷新）。 */
  clearCache(): void {
    this.cache = null;
  }

  /** last-known-good（测试/诊断用）。 */
  getLastKnownGood(): RemoteFlags | null {
    return this.lastKnownGood;
  }

  private validateFlags(data: unknown): RemoteFlags {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('flags 格式错误: 不是对象');
    }
    const out: RemoteFlags = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        out[key] = value;
      }
      // 非法类型直接丢弃，不让单个脏 key 污染整个配置
    }
    return out;
  }

  private static readonly defaultFetcher: HttpFetcher = async (url, init) => {
    const res = await fetch(url, { headers: init?.headers });
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text(),
    };
  };
}
