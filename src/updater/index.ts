/**
 * H5 版本/加载策略聚合入口（规则 5/6/7/8）。
 *
 * H5Storage 抽象已迁移至独立 storage 模块，此处统一再导出以保持兼容。
 * Phase 7 新增：更新状态机、manifest 客户端、更新检查器、下载器、校验器、安装器、激活器、编排器。
 */
export * from './types';
export { InMemoryH5Storage } from '../storage';
export { H5VersionManager } from './h5-version-manager';
export type { VersionManagerOptions, VersionStatus } from './h5-version-manager';
export { H5Runtime } from './h5-runtime';

// Phase 7 动态更新组件
export { UpdateStateMachine } from './update-state';
export type { UpdateState, UpdateTrigger, StateChangeListener } from './update-state';
export { ManifestClient, createMockManifestClient } from './manifest-client';
export type { ManifestClientOptions, HttpFetcher } from './manifest-client';
export {
  checkForUpdate,
  compareVersion,
  checkAppVersionCompatibility,
  checkBridgeCompatibility,
  checkRollout,
} from './update-checker';
export type { UpdateCheckContext, UpdateCheckResult, RolloutRule } from './update-checker';
export { PackageDownloader, createMockDownloader } from './downloader';
export type {
  DownloaderOptions,
  NetworkPolicy,
  NetworkStatus,
  DownloadProgress,
  HttpDownloader,
} from './downloader';
export { verifyPackage, createMockHasher, createFailingHasher } from './verifier';
export type { VerifyOptions, VerifyResult, Sha256Hasher, SignatureVerifier } from './verifier';
export { PackageInstaller, createInMemoryFileSystem, createMockUnzipper } from './installer';
export type { InstallerOptions, InstallResult, FileSystem, Unzipper } from './installer';
export { VersionActivator, createInMemoryPointer } from './activator';
export type { ActivateResult, CurrentPointer } from './activator';
export { UpdateOrchestrator } from './update-orchestrator';
export type { UpdateOrchestratorOptions, CheckResult, UpdateResult } from './update-orchestrator';

// Phase 8 失败回滚组件
export { RollbackManager, createInMemoryPersistence } from './rollback-manager';
export type {
  RollbackState,
  LaunchStatus,
  BootFailureReason,
  RollbackResult,
  RollbackManagerOptions,
  RollbackPersistence,
} from './rollback-manager';
export { BootFailureDetector, createWebViewBootAdapter } from './boot-failure-detector';
export type { BootDetectorOptions, BootEvent } from './boot-failure-detector';
