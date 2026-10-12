/**
 * Manifest 客户端（Phase 7 / 规范 §28、§56）。
 *
 * 拉取 latest manifest / 版本 manifest，支持短缓存。
 * manifest/index.html 走 no-cache，带 hash 资源走 immutable（规范 §56）。
 *
 * 接口驱动：HttpFetcher 可注入，便于单测与替换为 RN fetch / 自定义客户端。
 */
import type { H5Manifest } from './types';

export type HttpFetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export type ManifestClientOptions = {
  /** latest manifest URL，规范 §28 目录结构下通常为 {base}/manifest.json */
  latestUrl: string;
  /** 版本 manifest URL 模板，{version} 会被替换 */
  versionUrlTemplate?: string;
  /** HTTP 客户端，默认用全局 fetch */
  fetcher?: HttpFetcher;
  /** 短缓存时间（毫秒），默认 60s；0 表示不缓存 */
  cacheTtlMs?: number;
};

type CacheEntry = {
  manifest: H5Manifest;
  fetchedAt: number;
};

export class ManifestClient {
  private readonly options: Required<Omit<ManifestClientOptions, 'fetcher'>> & {
    fetcher?: HttpFetcher;
  };
  private cache: CacheEntry | null = null;

  constructor(options: ManifestClientOptions) {
    this.options = {
      latestUrl: options.latestUrl,
      versionUrlTemplate: options.versionUrlTemplate ?? '{base}/releases/{version}/manifest.json',
      fetcher: options.fetcher,
      cacheTtlMs: options.cacheTtlMs ?? 60_000,
    };
  }

  /** 拉取 latest manifest（带短缓存）。 */
  async fetchLatest(): Promise<H5Manifest> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.options.cacheTtlMs) {
      return this.cache.manifest;
    }
    const manifest = await this.fetchUrl(this.options.latestUrl);
    this.cache = { manifest, fetchedAt: now };
    return manifest;
  }

  /** 拉取指定版本的 manifest（不缓存）。 */
  async fetchVersion(version: string): Promise<H5Manifest> {
    const base = this.options.latestUrl.replace(/\/manifest\.json$/, '');
    const url = this.options.versionUrlTemplate
      .replace('{base}', base)
      .replace('{version}', version);
    return this.fetchUrl(url);
  }

  /** 清除缓存（强制更新时调用）。 */
  clearCache(): void {
    this.cache = null;
  }

  private async fetchUrl(url: string): Promise<H5Manifest> {
    const fetcher = this.options.fetcher ?? this.defaultFetcher;
    const res = await fetcher(url, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) {
      throw new Error(`Manifest 拉取失败: ${url} -> HTTP ${res.status}`);
    }
    const data = await res.json();
    return this.validateManifest(data);
  }

  private validateManifest(data: unknown): H5Manifest {
    if (!data || typeof data !== 'object') {
      throw new Error('Manifest 格式错误: 不是对象');
    }
    const m = data as Record<string, unknown>;
    const required = ['version', 'entry', 'packageUrl', 'sha256', 'size', 'publishedAt'];
    for (const key of required) {
      if (m[key] === undefined || m[key] === null) {
        throw new Error(`Manifest 缺少必填字段: ${key}`);
      }
    }
    return data as H5Manifest;
  }

  private readonly defaultFetcher: HttpFetcher = async (url, init) => {
    const res = await fetch(url, { headers: init?.headers });
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text(),
    };
  };
}

/** 创建 Mock ManifestClient（用于测试与浏览器开发）。 */
export function createMockManifestClient(
  manifests: H5Manifest | H5Manifest[],
  options?: { cacheTtlMs?: number },
): ManifestClient {
  const list = Array.isArray(manifests) ? manifests : [manifests];
  const latest = list[list.length - 1];
  const fetcher: HttpFetcher = async url => {
    // 模拟 latest URL 返回最新版本
    if (url.endsWith('/manifest.json') && !url.includes('/releases/')) {
      return {
        ok: true,
        status: 200,
        json: async () => latest,
        text: async () => JSON.stringify(latest),
      };
    }
    // 模拟版本 URL
    const versionMatch = url.match(/\/releases\/([^/]+)\/manifest\.json/);
    if (versionMatch) {
      const found = list.find(m => m.version === versionMatch[1]);
      if (found) {
        return {
          ok: true,
          status: 200,
          json: async () => found,
          text: async () => JSON.stringify(found),
        };
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'Not Found',
    };
  };
  return new ManifestClient({
    latestUrl: 'https://mock-cdn.example.com/h5/manifest.json',
    fetcher,
    cacheTtlMs: options?.cacheTtlMs ?? 0,
  });
}
