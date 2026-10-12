/**
 * 五类日志采集器（Phase 13 / 规范 §27、§35）。
 *
 * 将 LogManager 集成到现有系统：
 *  - BridgeLogCollector：BridgeServer 请求/响应/事件/耗时/错误码
 *  - UpdateLogCollector：更新状态机流转、下载/校验/安装/回滚结果
 *  - WebViewLogCollector：WebView onError/onHttpError/白屏/READY 超时
 *  - H5ErrorCollector：H5 侧 window error / unhandledrejection（经 Bridge 上报）
 *  - AppLogCollector：启动状态机、生命周期、网络切换
 *
 * 所有采集器通过 LogManager 的便捷方法记录日志，自动脱敏。
 */
import type { LogManager } from './log-manager';
import type { LogEntry } from './log-entry';

// ==================== Bridge 日志采集器 ====================

export type BridgeLogCollectorOptions = {
  logManager: LogManager;
};

export class BridgeLogCollector {
  private readonly logManager: LogManager;

  constructor(options: BridgeLogCollectorOptions) {
    this.logManager = options.logManager;
  }

  /** 记录 Bridge 请求开始。 */
  onRequest(requestId: string, module: string, action: string, params?: unknown): void {
    this.logManager.bridge('debug', 'bridge_request', {
      requestId,
      module,
      action,
      data: params ? { params } : undefined,
    });
  }

  /** 记录 Bridge 响应成功。 */
  onResponse(requestId: string, module: string, action: string, durationMs: number): void {
    this.logManager.bridge('info', 'bridge_response', {
      requestId,
      module,
      action,
      durationMs,
    });
  }

  /** 记录 Bridge 响应错误。 */
  onError(
    requestId: string,
    module: string,
    action: string,
    errorCode: string,
    errorMessage?: string,
    durationMs?: number,
  ): void {
    this.logManager.bridge('error', 'bridge_error', {
      requestId,
      module,
      action,
      errorCode,
      errorMessage,
      durationMs,
    });
  }

  /** 记录 Bridge 事件（RN→H5）。 */
  onEvent(event: string, data?: unknown): void {
    this.logManager.bridge('debug', event, {
      data: data ? { data } : undefined,
    });
  }

  /** 记录 Bridge 超时。 */
  onTimeout(requestId: string, module: string, action: string, timeoutMs: number): void {
    this.logManager.bridge('warn', 'bridge_timeout', {
      requestId,
      module,
      action,
      durationMs: timeoutMs,
      errorCode: 'TIMEOUT',
    });
  }
}

// ==================== 更新日志采集器 ====================

export type UpdateLogCollectorOptions = {
  logManager: LogManager;
};

export class UpdateLogCollector {
  private readonly logManager: LogManager;

  constructor(options: UpdateLogCollectorOptions) {
    this.logManager = options.logManager;
  }

  /** 记录更新状态机流转。 */
  onStateChange(from: string, to: string, version?: string): void {
    this.logManager.update('info', 'update_state_change', {
      data: { from, to, version },
    });
  }

  /** 记录检查更新结果。 */
  onCheckResult(available: boolean, reason?: string, version?: string): void {
    this.logManager.update(available ? 'info' : 'debug', 'update_check', {
      data: { available, reason, version },
    });
  }

  /** 记录下载进度。 */
  onDownloadProgress(version: string, percent: number, downloaded: number, total: number): void {
    // 进度事件节流：只记录 10% 间隔
    if (percent % 10 !== 0 && percent !== 100) return;
    this.logManager.update('debug', 'update_download_progress', {
      data: { version, percent, downloaded, total },
    });
  }

  /** 记录下载完成。 */
  onDownloadComplete(version: string, durationMs: number, size: number): void {
    this.logManager.update('info', 'update_download_complete', {
      data: { version, size },
      durationMs,
    });
  }

  /** 记录下载失败。 */
  onDownloadFailed(version: string, error: string): void {
    this.logManager.update('error', 'update_download_failed', {
      errorCode: 'DOWNLOAD_FAILED',
      errorMessage: error,
      data: { version },
    });
  }

  /** 记录校验结果。 */
  onVerifyResult(version: string, success: boolean, error?: string): void {
    this.logManager.update(success ? 'info' : 'error', 'update_verify', {
      errorCode: success ? undefined : 'VERIFY_FAILED',
      errorMessage: error,
      data: { version, success },
    });
  }

  /** 记录安装结果。 */
  onInstallResult(version: string, success: boolean, error?: string): void {
    this.logManager.update(success ? 'info' : 'error', 'update_install', {
      errorCode: success ? undefined : 'INSTALL_FAILED',
      errorMessage: error,
      data: { version, success },
    });
  }

  /** 记录激活结果。 */
  onActivateResult(version: string, previousVersion: string | null, success: boolean): void {
    this.logManager.update(success ? 'info' : 'error', 'update_activate', {
      data: { version, previousVersion, success },
    });
  }

  /** 记录回滚。 */
  onRollback(
    fromVersion: string,
    toVersion: string | null,
    reason: string,
    fallbackUsed: boolean,
  ): void {
    this.logManager.update('warn', 'update_rollback', {
      errorCode: 'BOOT_FAILED',
      errorMessage: reason,
      data: { fromVersion, toVersion, fallbackUsed },
    });
  }

  /** 记录 READY 确认。 */
  onReadyConfirmed(version: string, durationMs: number): void {
    this.logManager.update('info', 'update_ready_confirmed', {
      data: { version },
      durationMs,
    });
  }
}

// ==================== WebView 日志采集器 ====================

export type WebViewLogCollectorOptions = {
  logManager: LogManager;
};

export class WebViewLogCollector {
  private readonly logManager: LogManager;

  constructor(options: WebViewLogCollectorOptions) {
    this.logManager = options.logManager;
  }

  /** 记录 WebView 加载开始。 */
  onLoadStart(url: string): void {
    this.logManager.webview('debug', 'webview_load_start', {
      data: { url },
    });
  }

  /** 记录 WebView 加载完成。 */
  onLoadEnd(url: string, durationMs: number): void {
    this.logManager.webview('info', 'webview_load_end', {
      data: { url },
      durationMs,
    });
  }

  /** 记录 WebView 错误。 */
  onError(errorCode: string, description: string, url?: string): void {
    this.logManager.webview('error', 'webview_error', {
      errorCode,
      errorMessage: description,
      data: url ? { url } : undefined,
    });
  }

  /** 记录 WebView HTTP 错误。 */
  onHttpError(statusCode: number, description: string, url?: string): void {
    this.logManager.webview('warn', 'webview_http_error', {
      errorCode: `HTTP_${statusCode}`,
      errorMessage: description,
      data: url ? { url, statusCode } : { statusCode },
    });
  }

  /** 记录白屏检测。 */
  onWhiteScreenDetected(durationMs: number): void {
    this.logManager.webview('error', 'webview_white_screen', {
      errorCode: 'WHITE_SCREEN',
      errorMessage: 'WebView 加载后白屏',
      durationMs,
    });
  }

  /** 记录 READY 超时。 */
  onReadyTimeout(timeoutMs: number): void {
    this.logManager.webview('warn', 'webview_ready_timeout', {
      errorCode: 'H5_BOOT_TIMEOUT',
      errorMessage: `H5 READY 确认超时（${timeoutMs}ms）`,
      durationMs: timeoutMs,
    });
  }
}

// ==================== H5 错误采集器 ====================

export type H5ErrorCollectorOptions = {
  logManager: LogManager;
};

export class H5ErrorCollector {
  private readonly logManager: LogManager;

  constructor(options: H5ErrorCollectorOptions) {
    this.logManager = options.logManager;
  }

  /** 记录 H5 window error。 */
  onWindowError(message: string, source?: string, line?: number, column?: number): void {
    this.logManager.h5Error('error', 'h5_window_error', {
      errorCode: 'H5_RUNTIME_ERROR',
      errorMessage: message,
      data: { source, line, column },
    });
  }

  /** 记录 H5 unhandledrejection。 */
  onUnhandledRejection(reason: string): void {
    this.logManager.h5Error('error', 'h5_unhandled_rejection', {
      errorCode: 'H5_UNHANDLED_REJECTION',
      errorMessage: reason,
    });
  }

  /** 记录 H5 资源加载失败。 */
  onResourceLoadFailed(resourceType: string, url: string): void {
    this.logManager.h5Error('warn', 'h5_resource_load_failed', {
      errorCode: 'H5_RESOURCE_LOAD_FAILED',
      errorMessage: `${resourceType} 加载失败`,
      data: { resourceType, url },
    });
  }

  /** 记录 H5 自定义错误（业务上报）。 */
  onCustomError(errorCode: string, message: string, data?: Record<string, unknown>): void {
    this.logManager.h5Error('error', 'h5_custom_error', {
      errorCode,
      errorMessage: message,
      data,
    });
  }
}

// ==================== App 日志采集器 ====================

export type AppLogCollectorOptions = {
  logManager: LogManager;
};

export class AppLogCollector {
  private readonly logManager: LogManager;

  constructor(options: AppLogCollectorOptions) {
    this.logManager = options.logManager;
  }

  /** 记录 App 启动。 */
  onAppLaunch(coldStart: boolean): void {
    this.logManager.app('info', coldStart ? 'app_cold_start' : 'app_warm_start', {
      data: { coldStart },
    });
  }

  /** 记录启动状态机流转。 */
  onBootStateChange(from: string, to: string): void {
    this.logManager.app('debug', 'app_boot_state_change', {
      data: { from, to },
    });
  }

  /** 记录 App 生命周期。 */
  onLifecycle(event: 'foreground' | 'background' | 'active' | 'inactive'): void {
    this.logManager.app('info', `app_lifecycle_${event}`, {});
  }

  /** 记录网络切换。 */
  onNetworkChange(type: string, connected: boolean): void {
    this.logManager.app('info', 'app_network_change', {
      networkType: type,
      data: { connected },
    });
  }

  /** 记录 App 崩溃（JS 层）。 */
  onCrash(error: Error, isFatal: boolean): void {
    this.logManager.app('error', 'app_crash', {
      errorCode: isFatal ? 'FATAL_CRASH' : 'NON_FATAL_CRASH',
      errorMessage: error.message,
      data: { stack: error.stack },
    });
  }

  /** 记录权限请求结果。 */
  onPermissionResult(permission: string, granted: boolean): void {
    this.logManager.app('info', 'app_permission_result', {
      data: { permission, granted },
    });
  }
}

// ==================== 统一导出 ====================

export type AllCollectors = {
  bridge: BridgeLogCollector;
  update: UpdateLogCollector;
  webview: WebViewLogCollector;
  h5Error: H5ErrorCollector;
  app: AppLogCollector;
};

/** 创建全部五类采集器。 */
export function createAllCollectors(logManager: LogManager): AllCollectors {
  return {
    bridge: new BridgeLogCollector({ logManager }),
    update: new UpdateLogCollector({ logManager }),
    webview: new WebViewLogCollector({ logManager }),
    h5Error: new H5ErrorCollector({ logManager }),
    app: new AppLogCollector({ logManager }),
  };
}

export type { LogEntry };
