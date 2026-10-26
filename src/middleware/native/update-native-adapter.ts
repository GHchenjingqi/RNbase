/**
 * 原生升级模块适配器（RN 侧，规则 13/51）。
 *
 * 对接 NativeModules.BaseUpdate。非安卓平台（iOS / 浏览器测试）没有该原生模块，
 * 这里安全降级为空对象，让 bridge 层回 DEVICE_UNSUPPORTED，不影响 App 启动。
 *
 * 延迟读取 NativeModules，便于测试时注入 mock。
 */
import { NativeModules } from 'react-native';
import { BridgeException } from '../../bridge/bridge-error';
import type { BridgeErrorCode } from '../../bridge/protocol';
import type { StartDownloadOptions, UpdateAdapters } from '../../bridge/modules/update';

export interface BaseUpdateNative {
  getInfo(): Promise<Record<string, unknown>>;
  startDownload(opts: {
    url: string;
    version: string;
    sha256?: string;
    size?: number;
  }): Promise<{ started: boolean; taskState: string }>;
  getProgress(): Promise<Record<string, unknown>>;
  cancelDownload(): Promise<{ ok: boolean }>;
  install(): Promise<{ launched: boolean; apkPath: string }>;
  canRequestInstallCheck(): Promise<{ granted: boolean }>;
  openInstallSettings(): Promise<{ opened: boolean }>;
  copyToDownloads(): Promise<{ ok: boolean; path: string; displayName: string }>;
  cleanup(): Promise<{ ok: boolean; freedBytes: number }>;
}

/**
 * 原生错误码 → Bridge 错误码。
 * BridgeErrorCode 是封闭联合（protocol.ts），原生自定义码不能直接透传，
 * 因此把原生原始文案拼进 message，H5 侧按 code 决定交互、按 message 展示原因。
 */
const NATIVE_CODE_TO_BRIDGE: Record<string, BridgeErrorCode> = {
  INVALID_PARAMS: 'INVALID_PARAMS',
  INSTALL_PERMISSION_DENIED: 'PERMISSION_DENIED',
  APK_MISSING: 'FILE_NOT_FOUND',
  NO_INSTALLER: 'NATIVE_ERROR',
  INSTALL_FAILED: 'SECURITY_BLOCKED',
  SETTINGS_UNAVAILABLE: 'NATIVE_ERROR',
  COPY_FAILED: 'NATIVE_ERROR',
  UNSUPPORTED: 'DEVICE_UNSUPPORTED',
};

function nativeErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(e);
}

/** 原生 reject 的 code：新架构挂在 error.code，老架构只有拼在 message 里的文案。 */
function nativeErrorCode(e: unknown): string {
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
  }
  return '';
}

function wrapNativeError(e: unknown, defaultMsg: string): never {
  const rawCode = nativeErrorCode(e);
  const rawMessage = nativeErrorMessage(e) || defaultMsg;
  const code = NATIVE_CODE_TO_BRIDGE[rawCode] ?? 'NATIVE_ERROR';
  throw new BridgeException(code, rawMessage);
}

/** 原生返回的数值字段统一收口成 number（缺失/异常回 0，避免 H5 出现 NaN 进度）。 */
function numOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function boolOf(value: unknown): boolean {
  return value === true;
}

function normalizeInfo(raw: Record<string, unknown>) {
  return {
    platform: strOf(raw.platform) || 'android',
    versionName: strOf(raw.versionName),
    versionCode: numOf(raw.versionCode),
    apkInstall: boolOf(raw.apkInstall),
    canRequestInstall: boolOf(raw.canRequestInstall),
    updateDir: strOf(raw.updateDir),
    taskState: strOf(raw.taskState) || 'idle',
    received: numOf(raw.received),
    total: numOf(raw.total),
    errorCode: strOf(raw.errorCode),
    errorMessage: strOf(raw.errorMessage),
    sha256: strOf(raw.sha256),
    apkPath: strOf(raw.apkPath),
    apkSize: numOf(raw.apkSize),
  };
}

function normalizeProgress(raw: Record<string, unknown>) {
  return {
    taskState: strOf(raw.taskState) || 'idle',
    received: numOf(raw.received),
    total: numOf(raw.total),
    errorCode: strOf(raw.errorCode),
    errorMessage: strOf(raw.errorMessage),
    sha256: strOf(raw.sha256),
    apkPath: strOf(raw.apkPath),
    apkSize: numOf(raw.apkSize),
  };
}

/** 解析原生升级适配器；原生模块缺失时返回空对象（非安卓按能力缺失处理）。 */
export function resolveNativeUpdateAdapter(): UpdateAdapters {
  const nativeModule = (NativeModules as Record<string, unknown>).BaseUpdate as
    | BaseUpdateNative
    | undefined;

  if (!nativeModule) {
    return {};
  }

  return {
    getInfo: () =>
      nativeModule
        .getInfo()
        .then(normalizeInfo)
        .catch(e => wrapNativeError(e, '读取版本信息失败')),
    startDownload: (options: StartDownloadOptions) =>
      nativeModule.startDownload(options).catch(e => wrapNativeError(e, '启动下载失败')),
    getProgress: () =>
      nativeModule
        .getProgress()
        .then(normalizeProgress)
        .catch(e => wrapNativeError(e, '读取下载进度失败')),
    cancelDownload: () =>
      nativeModule.cancelDownload().catch(e => wrapNativeError(e, '取消下载失败')),
    install: () => nativeModule.install().catch(e => wrapNativeError(e, '拉起安装失败')),
    canRequestInstall: () =>
      nativeModule.canRequestInstallCheck().catch(e => wrapNativeError(e, '读取安装权限失败')),
    openInstallSettings: () =>
      nativeModule.openInstallSettings().catch(e => wrapNativeError(e, '打不开系统授权页')),
    copyToDownloads: () =>
      nativeModule.copyToDownloads().catch(e => wrapNativeError(e, '导出到下载目录失败')),
    cleanup: () => nativeModule.cleanup().catch(e => wrapNativeError(e, '清理升级包失败')),
  };
}
