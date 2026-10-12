/**
 * 更新编排器（Phase 7 / 规范 §35-§39）。
 *
 * 协调 manifest-client / update-checker / downloader / verifier / installer / activator，
 * 实现完整的更新流程：检查 → 下载 → 校验 → 安装 → 激活 → 冒烟测试。
 *
 * 策略：
 *  - 检查节流（24h 默认，规范 §36）
 *  - 激活策略：下载后暂不激活，下次冷启动激活（规范 §38）
 *  - 强制更新：forceUpdate / minSupportedH5Version（规范 §39）
 *  - 灰度识别（规范 §30）
 */
import { ManifestClient } from './manifest-client';
import { checkForUpdate, compareVersion, type UpdateCheckContext } from './update-checker';
import { PackageDownloader, type HttpDownloader } from './downloader';
import { verifyPackage, type Sha256Hasher } from './verifier';
import { PackageInstaller, type FileSystem, type Unzipper } from './installer';
import { VersionActivator, type CurrentPointer } from './activator';
import { UpdateStateMachine, type UpdateState } from './update-state';
import type { H5Manifest, RolloutRule } from './types';
import { UPDATE_CHECK_THROTTLE_MS, UPDATE_DOWNLOAD_MAX_RETRIES } from '../config';

export type UpdateOrchestratorOptions = {
  manifestClient: ManifestClient;
  httpDownloader: HttpDownloader;
  hasher: Sha256Hasher;
  fileSystem: FileSystem;
  unzipper: Unzipper;
  currentPointer: CurrentPointer;
  /** 更新检查上下文 */
  context: UpdateCheckContext;
  /** 灰度规则 */
  rollout?: RolloutRule;
  /** 检查节流时间（毫秒），默认 24h */
  checkThrottleMs?: number;
  /** 下载选项 */
  downloadOptions?: {
    maxRetries?: number;
    onProgress?: (percent: number) => void;
  };
  /** 状态变化回调 */
  onStateChange?: (state: UpdateState, prev: UpdateState) => void;
};

export type CheckResult =
  | { available: true; manifest: H5Manifest }
  | { available: false; reason: string; manifest?: H5Manifest };

export type UpdateResult =
  | {
      success: true;
      version: string;
      previousVersion: string | null;
      activated: boolean;
    }
  | { success: false; reason: string; details?: string };

export class UpdateOrchestrator {
  private readonly options: Required<
    Omit<UpdateOrchestratorOptions, 'rollout' | 'downloadOptions' | 'onStateChange'>
  > & {
    rollout?: RolloutRule;
    downloadOptions?: UpdateOrchestratorOptions['downloadOptions'];
    onStateChange?: UpdateOrchestratorOptions['onStateChange'];
  };
  private readonly stateMachine: UpdateStateMachine;
  private lastCheckAt: number = 0;
  private pendingManifest: H5Manifest | null = null;

  constructor(options: UpdateOrchestratorOptions) {
    this.options = {
      manifestClient: options.manifestClient,
      httpDownloader: options.httpDownloader,
      hasher: options.hasher,
      fileSystem: options.fileSystem,
      unzipper: options.unzipper,
      currentPointer: options.currentPointer,
      context: options.context,
      checkThrottleMs: options.checkThrottleMs ?? UPDATE_CHECK_THROTTLE_MS,
      rollout: options.rollout,
      downloadOptions: options.downloadOptions,
      onStateChange: options.onStateChange,
    };
    this.stateMachine = new UpdateStateMachine();
    if (options.onStateChange) {
      this.stateMachine.subscribe(options.onStateChange);
    }
  }

  getState(): UpdateState {
    return this.stateMachine.getState();
  }

  /**
   * 检查更新（带节流）。
   * 强制更新可绕过节流。
   */
  async check(force = false): Promise<CheckResult> {
    const now = Date.now();
    if (!force && now - this.lastCheckAt < this.options.checkThrottleMs) {
      return { available: false, reason: 'throttled' };
    }

    this.stateMachine.transition('CHECK_START');
    this.lastCheckAt = now;

    try {
      const manifest = await this.options.manifestClient.fetchLatest();
      const result = checkForUpdate(manifest, this.options.context, this.options.rollout);

      if (result.available) {
        this.stateMachine.transition('UPDATE_AVAILABLE');
        this.pendingManifest = manifest;
        return { available: true, manifest };
      }

      if (result.reason === 'app_version_too_low' || result.reason === 'bridge_incompatible') {
        this.stateMachine.transition('INCOMPATIBLE');
      } else {
        this.stateMachine.transition('NO_UPDATE');
      }
      return { available: false, reason: result.reason, manifest };
    } catch {
      this.stateMachine.transition('NO_UPDATE');
      return {
        available: false,
        reason: 'check_failed',
        manifest: undefined,
      };
    }
  }

  /**
   * 执行完整更新流程：下载 → 校验 → 安装。
   * 激活由 activate() 单独调用（冷启动激活，规范 §38）。
   */
  async update(): Promise<UpdateResult> {
    if (!this.pendingManifest) {
      // 尝试自动检查
      const checkResult = await this.check(true);
      if (!checkResult.available) {
        return { success: false, reason: 'no_update_available' };
      }
      this.pendingManifest = checkResult.manifest;
    }

    const manifest = this.pendingManifest;
    const previousVersion = await this.options.currentPointer.getCurrent();

    try {
      // 1. 下载
      this.stateMachine.transition('DOWNLOAD_START');
      const downloader = new PackageDownloader(this.options.httpDownloader, {
        maxRetries: this.options.downloadOptions?.maxRetries ?? UPDATE_DOWNLOAD_MAX_RETRIES,
        onProgress: p => this.options.downloadOptions?.onProgress?.(p.percent),
      });
      const packageData = await downloader.download(manifest.packageUrl);
      this.stateMachine.transition('DOWNLOAD_COMPLETE');

      // 2. 校验
      this.stateMachine.transition('VERIFY_START');
      const verifyResult = await verifyPackage(packageData, {
        expectedSha256: manifest.sha256,
        expectedSize: manifest.size,
        hasher: this.options.hasher,
      });
      if (!verifyResult.ok) {
        this.stateMachine.transition('VERIFY_FAILED');
        await this.options.fileSystem.clearStaging(manifest.version);
        return {
          success: false,
          reason: verifyResult.reason,
          details: verifyResult.details,
        };
      }
      this.stateMachine.transition('VERIFY_COMPLETE');

      // 3. 安装
      this.stateMachine.transition('INSTALL_START');
      const installer = new PackageInstaller({
        fileSystem: this.options.fileSystem,
        unzipper: this.options.unzipper,
      });
      const installResult = await installer.install(packageData, manifest);
      if (!installResult.ok) {
        this.stateMachine.transition('INSTALL_FAILED');
        return {
          success: false,
          reason: installResult.reason,
          details: installResult.details,
        };
      }
      this.stateMachine.transition('INSTALL_COMPLETE');
      this.stateMachine.transition('READY_TO_ACTIVATE');

      // 标记版本为已安装
      await this.options.currentPointer.markInstalled(manifest.version);

      return {
        success: true,
        version: manifest.version,
        previousVersion,
        activated: false,
      };
    } catch (err) {
      const state = this.stateMachine.getState();
      if (state === 'DOWNLOADING') {
        this.stateMachine.transition('DOWNLOAD_FAILED');
      }
      return {
        success: false,
        reason: 'update_failed',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 激活已安装的版本（冷启动时调用，规范 §38）。
   * 激活后进入 SMOKE_TEST，等待 READY 确认。
   */
  async activate(version?: string): Promise<UpdateResult> {
    const targetVersion = version ?? this.pendingManifest?.version;
    if (!targetVersion) {
      return { success: false, reason: 'no_pending_version' };
    }

    this.stateMachine.transition('ACTIVATE_START');
    const activator = new VersionActivator(this.options.currentPointer);
    const result = await activator.activate(targetVersion);

    if (!result.ok) {
      return { success: false, reason: result.reason, details: result.details };
    }

    this.stateMachine.transition('ACTIVATE_COMPLETE');
    this.pendingManifest = null;

    return {
      success: true,
      version: targetVersion,
      previousVersion: result.previousVersion,
      activated: true,
    };
  }

  /** 标记新版本启动成功（READY 确认），进入 STABLE。 */
  markReady(): boolean {
    return this.stateMachine.transition('READY_CONFIRMED');
  }

  /** 标记新版本启动失败，进入 BOOT_FAILED（后续由 RollbackManager 处理）。 */
  markBootFailed(): boolean {
    return this.stateMachine.transition('BOOT_FAILED');
  }

  /** 检查是否需要强制更新（规范 §39）。 */
  isForceUpdateRequired(manifest?: H5Manifest): boolean {
    const m = manifest ?? this.pendingManifest;
    if (!m) return false;
    if (m.forceUpdate) return true;
    // minSupportedH5Version：当前版本低于最低支持版本时强制更新
    if (m.minAppVersion && this.options.context.currentH5Version) {
      return compareVersion(this.options.context.currentH5Version, m.minAppVersion) < 0;
    }
    return false;
  }

  /** 重置状态机（用于错误恢复后重新检查）。 */
  reset(): void {
    this.stateMachine.transition('RESET');
    this.pendingManifest = null;
  }
}
