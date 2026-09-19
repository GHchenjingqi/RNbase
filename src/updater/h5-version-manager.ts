/**
 * H5 ???????? 6/7/8/35??
 *
 * ?????CHECKING -> AVAILABLE -> DOWNLOADING -> VERIFYING ->
 * INSTALLING -> READY_TO_ACTIVATE -> ACTIVATING -> SMOKE_TEST -> STABLE?
 *
 * ???????????????????? 8??SMOKE_TEST ??? H5
 * ??????? 9??? markReady / markFailed ???
 *
 * ?? IO ??????????????? 35??
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
  manifestProvider: ManifestProvider;
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

  /** ????????a>b ?? 1??? 0?a<b ?? -1? */
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

  /** ????????????????????? 7/8?? */
  async update(): Promise<void> {
    const { storage, downloader, verifier, manifestProvider } = this.opts;
    const manifest = await manifestProvider.fetchManifest();
    this.previousVersion = await storage.getCurrentVersion();

    try {
      this.setState('DOWNLOADING');
      const data = await downloader.download(manifest.packageUrl);

      this.setState('VERIFYING');
      const hash = await verifier.sha256(data);
      if (hash !== manifest.sha256) {
        this.setState('VERIFY_FAILED');
        throw new Error('H5 ? sha256 ????');
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

  /** H5 ????????? 9?? */
  async markReady(): Promise<void> {
    if (this.state !== 'SMOKE_TEST') {
      return;
    }
    this.currentVersion = this.pendingVersion;
    this.pendingVersion = null;
    this.setState('STABLE');
  }

  /** H5 ??????? 9???????????? 8?? */
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
        // ????????????????
      }
    }
    this.pendingVersion = null;
  }
}
