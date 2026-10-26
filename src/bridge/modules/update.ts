/**
 * update 桥接模块：安卓远程全量升级（下载 → 校验 → 拉起系统安装器）。
 *
 * 与 src/updater/*（H5 子包增量更新）是两条独立链路：这里换的是整个 App 安装包。
 * 仅安卓可落地：iOS 由 App Store 分发，没有自装通道，原生侧不实现，
 * 因此适配器缺失时统一返回 DEVICE_UNSUPPORTED（规则 15/16）。
 *
 * 为什么下载不是一次 await 到底的调用：H5 侧 Bridge 请求超时是 30s
 * （scripts/api.js TIMEOUT_MS），几十 MB 的包必然超时。所以拆成
 * startDownload（毫秒级返回，原生后台线程开工）+ getProgress（轮询）。
 * 轮询顺带解决另一个问题：用户把 App 切到后台时 H5 的定时器会停，
 * 但原生下载继续，回到前台再轮一次就能拿到 completed。
 *
 * H5 调用：
 *   RN.UPDATE.GETINFO()                       -> { versionCode, versionName, canRequestInstall, taskState, ... }
 *   RN.UPDATE.STARTDOWNLOAD({ url, version }) -> { started, taskState }
 *   RN.UPDATE.GETPROGRESS()                   -> { taskState, received, total, errorCode, apkPath }
 *   RN.UPDATE.CANCELDOWNLOAD()                -> { ok }
 *   RN.UPDATE.INSTALL()                       -> { launched, apkPath }
 *   RN.UPDATE.CANREQUESTINSTALL()             -> { granted }
 *   RN.UPDATE.OPENINSTALLSETTINGS()           -> { opened }
 *   RN.UPDATE.COPYTODOWNLOADS()               -> { ok, path }
 *   RN.UPDATE.CLEANUP()                       -> { ok, freedBytes }
 */
import { BridgeException } from '../bridge-error';
import type { BridgeServer } from '../bridge-server';

export type UpdateInfo = {
  platform: string;
  versionName: string;
  versionCode: number;
  apkInstall: boolean;
  canRequestInstall: boolean;
  updateDir: string;
  taskState: string;
  received: number;
  total: number;
  errorCode: string;
  errorMessage: string;
  sha256: string;
  apkPath: string;
  apkSize: number;
};

export type DownloadProgress = {
  taskState: string;
  received: number;
  total: number;
  errorCode: string;
  errorMessage: string;
  sha256: string;
  apkPath: string;
  apkSize: number;
};

export type StartDownloadOptions = {
  url: string;
  version: string;
  sha256?: string;
  size?: number;
};

export type UpdateAdapters = {
  getInfo?: () => Promise<UpdateInfo>;
  startDownload?: (
    options: StartDownloadOptions,
  ) => Promise<{ started: boolean; taskState: string }>;
  getProgress?: () => Promise<DownloadProgress>;
  cancelDownload?: () => Promise<{ ok: boolean }>;
  install?: () => Promise<{ launched: boolean; apkPath: string }>;
  canRequestInstall?: () => Promise<{ granted: boolean }>;
  openInstallSettings?: () => Promise<{ opened: boolean }>;
  copyToDownloads?: () => Promise<{ ok: boolean; path: string; displayName: string }>;
  cleanup?: () => Promise<{ ok: boolean; freedBytes: number }>;
};

function pick<T extends keyof UpdateAdapters>(
  adapters: UpdateAdapters,
  key: T,
): NonNullable<UpdateAdapters[T]> {
  const fn = adapters[key];
  if (!fn) {
    throw new BridgeException('DEVICE_UNSUPPORTED', '远程升级能力未接入（仅安卓支持）');
  }
  return fn as NonNullable<UpdateAdapters[T]>;
}

export function registerUpdateModule(server: BridgeServer, adapters: UpdateAdapters = {}): void {
  server.registerModule('update', {
    getInfo() {
      return pick(adapters, 'getInfo')();
    },

    async startDownload(params) {
      const p = params as StartDownloadOptions | undefined;
      const url = typeof p?.url === 'string' ? p.url.trim() : '';
      const version = typeof p?.version === 'string' ? p.version.trim() : '';
      if (!url.startsWith('https://')) {
        // 整包替换的下载源只认 https：明文 http 链路上任何人做一次中间人就能把包换成别的 apk，
        // 而用户看到的是「升级到新版本」的系统安装弹窗，没有任何补救机会。
        throw new BridgeException('INVALID_PARAMS', 'url 必须是 https 下载地址');
      }
      // version 决定落盘文件名（qux-<version>.apk），也是「同一目标版本不重复起任务」的依据
      if (!version) {
        throw new BridgeException('INVALID_PARAMS', 'version 不能为空');
      }
      const start = pick(adapters, 'startDownload');
      return start({
        url,
        version,
        sha256: p?.sha256 ?? '',
        size: Number.isFinite(p?.size) && p!.size! > 0 ? Math.trunc(p!.size!) : 0,
      });
    },

    getProgress() {
      return pick(adapters, 'getProgress')();
    },

    cancelDownload() {
      return pick(adapters, 'cancelDownload')();
    },

    /**
     * 拉起系统安装器。
     * 权限没给时原生回 INSTALL_PERMISSION_DENIED，H5 据此引导去系统授权页，
     * 不能当成「安装失败」报给用户。
     */
    install() {
      return pick(adapters, 'install')();
    },

    canRequestInstall() {
      return pick(adapters, 'canRequestInstall')();
    },

    openInstallSettings() {
      return pick(adapters, 'openInstallSettings')();
    },

    copyToDownloads() {
      return pick(adapters, 'copyToDownloads')();
    },

    /** 删除已下载的升级包（升级成功后旧包没用了，几十 MB 不能长期占存储）。 */
    cleanup() {
      return pick(adapters, 'cleanup')();
    },
  });
}
