/**
 * 包下载器（Phase 7 / 规范 §37）。
 *
 * 支持：重试、进度回调、网络策略（Wi-Fi/蜂窝/充电/后台可配置）。
 * 接口驱动：HttpDownloader 可注入，便于单测与替换。
 */
import { UPDATE_DOWNLOAD_MAX_RETRIES, UPDATE_DOWNLOAD_RETRY_BASE_DELAY_MS } from '../config';

export type DownloadProgress = {
  downloaded: number;
  total: number;
  percent: number;
};

export type NetworkPolicy = {
  /** 允许在蜂窝网络下载，默认 false */
  allowCellular?: boolean;
  /** 允许在后台下载，默认 false */
  allowBackground?: boolean;
  /** 要求充电时下载，默认 false */
  requireCharging?: boolean;
};

export type NetworkStatus = {
  type: 'wifi' | 'cellular' | 'none';
  connected: boolean;
};

export type DownloaderOptions = {
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 重试基础延迟（毫秒），默认 1000，指数退避 */
  retryBaseDelayMs?: number;
  /** 网络策略 */
  networkPolicy?: NetworkPolicy;
  /** 当前网络状态提供者 */
  networkStatusProvider?: () => Promise<NetworkStatus>;
  /** 进度回调 */
  onProgress?: (progress: DownloadProgress) => void;
};

export type HttpDownloader = (
  url: string,
  onProgress?: (downloaded: number, total: number) => void,
) => Promise<Uint8Array>;

export class PackageDownloader {
  private readonly options: Required<
    Omit<DownloaderOptions, 'onProgress' | 'networkStatusProvider'>
  > & {
    onProgress?: DownloaderOptions['onProgress'];
    networkStatusProvider?: DownloaderOptions['networkStatusProvider'];
  };
  private readonly httpDownloader: HttpDownloader;

  constructor(httpDownloader: HttpDownloader, options: DownloaderOptions = {}) {
    this.httpDownloader = httpDownloader;
    this.options = {
      maxRetries: options.maxRetries ?? UPDATE_DOWNLOAD_MAX_RETRIES,
      retryBaseDelayMs: options.retryBaseDelayMs ?? UPDATE_DOWNLOAD_RETRY_BASE_DELAY_MS,
      networkPolicy: options.networkPolicy ?? {
        allowCellular: false,
        allowBackground: false,
        requireCharging: false,
      },
      onProgress: options.onProgress,
      networkStatusProvider: options.networkStatusProvider,
    };
  }

  /** 下载包，带重试与进度。 */
  async download(url: string): Promise<Uint8Array> {
    // 网络策略检查
    await this.checkNetworkPolicy();

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        const data = await this.httpDownloader(url, (downloaded, total) => {
          this.options.onProgress?.({
            downloaded,
            total,
            percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
          });
        });
        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.options.maxRetries) {
          const delay = this.options.retryBaseDelayMs * Math.pow(2, attempt);
          await sleep(delay);
        }
      }
    }
    throw lastError ?? new Error('下载失败');
  }

  private async checkNetworkPolicy(): Promise<void> {
    const policy = this.options.networkPolicy;
    if (!this.options.networkStatusProvider) return;

    const status = await this.options.networkStatusProvider();
    if (!status.connected) {
      throw new Error('网络未连接，无法下载');
    }
    if (status.type === 'cellular' && !policy.allowCellular) {
      throw new Error('当前为蜂窝网络，策略禁止下载（请连接 Wi-Fi）');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 创建 Mock 下载器（用于测试）。 */
export function createMockDownloader(
  data: Uint8Array,
  options?: { failAttempts?: number; delayMs?: number; totalSize?: number },
): HttpDownloader {
  let attempts = 0;
  const failAttempts = options?.failAttempts ?? 0;
  const delayMs = options?.delayMs ?? 0;
  const totalSize = options?.totalSize ?? data.length;

  return async (url, onProgress) => {
    attempts += 1;
    if (attempts <= failAttempts) {
      throw new Error(`Mock 下载失败 (attempt ${attempts})`);
    }
    // 模拟进度
    if (onProgress) {
      const steps = 5;
      for (let i = 1; i <= steps; i += 1) {
        if (delayMs > 0) await sleep(delayMs / steps);
        onProgress(Math.round((totalSize * i) / steps), totalSize);
      }
    }
    return data;
  };
}
