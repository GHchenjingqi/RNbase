/**
 * H5 子包版本管理器（规则 6/7/8/35）。
 *
 * 状态机：CHECKING -> AVAILABLE -> DOWNLOADING -> VERIFYING ->
 * INSTALLING -> READY_TO_ACTIVATE -> ACTIVATING -> SMOKE_TEST -> STABLE。
 *
 * 任一环节失败都回滚到上一个可用版本（规则 8）；SMOKE_TEST 期间 H5
 * 握手成功才算稳定（规则 9），由 markReady / markFailed 回报。
 *
 * 本类不做任何 IO：清单、下载、校验、存储全靠注入（规则 35），便于单测。
 */
import type {
  H5Manifest,
  H5Storage,
  ManifestProvider,
  PackageDownloader,
  UpdateState,
  Verifier,
} from './types';

export type VersionManagerOptions = {
  storage: H5Storage;
  /**
   * 清单来源；未配置 manifest 地址时由上层传 undefined —— 此时整个 OTA 链路视为关闭，
   * checkForUpdate 直接返回「无更新」，不做任何网络请求（见 config 的 H5_MANIFEST_URL）。
   */
  manifestProvider?: ManifestProvider;
  downloader: PackageDownloader;
  verifier: Verifier;
  appVersion: string;
  bridgeVersion: string;
  onStateChange?: (state: UpdateState, manager: H5VersionManager) => void;
};

export type VersionStatus = {
  state: UpdateState;
  currentVersion: string | null;
  previousVersion: string | null;
  pendingVersion: string | null;
};

export class H5VersionManager {
  private state: UpdateState = 'IDLE';
  private currentVersion: string | null = null;
  private previousVersion: string | null = null;
  private pendingVersion: string | null = null;
  private readonly opts: VersionManagerOptions;

  constructor(opts: VersionManagerOptions) {
    this.opts = opts;
  }

  getState(): UpdateState {
    return this.state;
  }

  getStatus(): VersionStatus {
    return {
      state: this.state,
      currentVersion: this.currentVersion,
      previousVersion: this.previousVersion,
      pendingVersion: this.pendingVersion,
    };
  }

  private setState(state: UpdateState): void {
    this.state = state;
    this.opts.onStateChange?.(state, this);
  }

  /** 按点分段比较版本号：a>b 返回 1，相等返回 0，a<b 返回 -1。 */
  static compareVersion(a: string, b: string): number {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      const x = pa[i] ?? 0;
      const y = pb[i] ?? 0;
      if (x !== y) {
        return x > y ? 1 : -1;
      }
    }
    return 0;
  }

  async checkForUpdate(): Promise<{
    available: boolean;
    manifest?: H5Manifest;
    reason?: string;
  }> {
    this.setState('CHECKING');
    if (!this.opts.manifestProvider) {
      this.setState('NO_UPDATE');
      return { available: false, reason: 'manifest_not_configured' };
    }
    const manifest = await this.opts.manifestProvider.fetchManifest();
    this.currentVersion = await this.opts.storage.getCurrentVersion();

    if (
      this.currentVersion &&
      H5VersionManager.compareVersion(manifest.version, this.currentVersion) <= 0
    ) {
      this.setState('NO_UPDATE');
      return { available: false, reason: 'already_latest' };
    }
    if (
      manifest.minAppVersion &&
      H5VersionManager.compareVersion(manifest.minAppVersion, this.opts.appVersion) > 0
    ) {
      this.setState('INCOMPATIBLE');
      return { available: false, reason: 'app_version_too_low' };
    }
    if (
      manifest.bridgeVersion &&
      H5VersionManager.compareVersion(manifest.bridgeVersion, this.opts.bridgeVersion) > 0
    ) {
      this.setState('INCOMPATIBLE');
      return { available: false, reason: 'bridge_incompatible' };
    }
    this.setState('AVAILABLE');
    return { available: true, manifest };
  }

  /** 完整更新流程：下载 -> 校验 -> 安装 -> 激活（规则 7/8）。 */
  async update(): Promise<void> {
    const { storage, downloader, verifier, manifestProvider } = this.opts;
    if (!manifestProvider) {
      // 调用方不该在没配清单时走到这里；真走到了就明确报错，不去 fetch 一个 undefined。
      throw new Error('未配置 H5 清单地址（version.json 的 manifestUrl），更新链路处于关闭状态');
    }
    const manifest = await manifestProvider.fetchManifest();
    this.previousVersion = await storage.getCurrentVersion();

    try {
      this.setState('DOWNLOADING');
      const data = await downloader.download(manifest.packageUrl);

      this.setState('VERIFYING');
      const hash = await verifier.sha256(data);
      if (hash !== manifest.sha256) {
        this.setState('VERIFY_FAILED');
        throw new Error('H5 包 sha256 校验失败');
      }

      this.setState('INSTALLING');
      await storage.install(manifest.version, data, manifest);

      this.setState('READY_TO_ACTIVATE');
      this.setState('ACTIVATING');
      await storage.activate(manifest.version);

      this.pendingVersion = manifest.version;
      this.setState('SMOKE_TEST');
    } catch (e) {
      await this.rollbackToPrevious();
      throw e;
    }
  }

  /** H5 握手成功：新版本转为稳定（规则 9）。 */
  async markReady(): Promise<void> {
    if (this.state !== 'SMOKE_TEST') {
      return;
    }
    this.currentVersion = this.pendingVersion;
    this.pendingVersion = null;
    this.setState('STABLE');
  }

  /** H5 握手失败（规则 9）：标记启动失败并回滚上一版本（规则 8）。 */
  async markFailed(): Promise<void> {
    if (this.state !== 'SMOKE_TEST') {
      return;
    }
    this.setState('BOOT_FAILED');
    await this.rollbackToPrevious();
  }

  private async rollbackToPrevious(): Promise<void> {
    this.setState('ROLLBACK');
    const { storage } = this.opts;
    if (this.previousVersion) {
      try {
        await storage.rollback(this.previousVersion);
        this.currentVersion = this.previousVersion;
      } catch {
        // 回滚本身也失败时无路可退：不向上抛（抛出去会把下载失败盖掉），
        // 留给下次启动按内置兜底版本（builtin-fallback）拉起。
      }
    }
    this.pendingVersion = null;
  }
}
