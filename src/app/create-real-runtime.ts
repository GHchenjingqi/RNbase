/**
 * 生产运行时装配：动态 H5 子包自动升级全链路（真实 IO）。
 *
 *  - manifest 拉取：ManifestClient 读 config.H5_MANIFEST_URL
 *  - 包下载：PackageDownloader + RN fetch（带重试/进度）
 *  - 校验：原生 BaseH5 SHA-256（Hermes 无 Web Crypto）
 *  - 落盘/激活/回滚：原生 BaseH5（filesDir/h5-versions/ + current.json 原子切换）
 *
 * 原生模块缺失时（测试/浏览器环境）降级为内存演示运行时，保证可启动。
 * 鸿蒙同理：BaseH5 只在安卓原生侧实现（RNOH 未移植），所以「H5 子包整包远程升级」
 * 目前是安卓专属能力，鸿蒙走下面这条降级分支，不会崩。
 */
import { NativeModules } from 'react-native';
import { H5Runtime, H5VersionManager, ManifestClient, PackageDownloader } from '../updater';
import { NativeH5Storage } from '../storage/native-h5-storage';
import { nativeHttpDownloader } from '../updater/native-http';
import { nativeSha256Hasher } from '../updater/native-sha256';
import { H5_MANIFEST_URL, APP_VERSION, BRIDGE_VERSION } from '../config';
import { createDemoRuntime } from './create-demo-runtime';
import { deviceLogger } from '../diagnostics/device-logger';

export function createRealRuntime(): H5Runtime {
  if (!NativeModules.BaseH5) {
    deviceLogger.warn('BaseH5 原生模块未注册，降级为内存演示运行时');
    return createDemoRuntime();
  }

  const storage = new NativeH5Storage();
  // 没配 manifest 地址就不建清单客户端：整条 OTA 链路关闭（规则 6/28）。
  // 过去这里固定用一个不存在的占位域名，每次启动白跑一次请求再当成「无更新」。
  const manifestClient = H5_MANIFEST_URL
    ? new ManifestClient({ latestUrl: H5_MANIFEST_URL })
    : null;
  const downloader = new PackageDownloader(nativeHttpDownloader);

  const versionManager = new H5VersionManager({
    storage,
    manifestProvider: manifestClient
      ? { fetchManifest: () => manifestClient.fetchLatest() }
      : undefined,
    downloader,
    verifier: { sha256: nativeSha256Hasher },
    appVersion: APP_VERSION,
    bridgeVersion: BRIDGE_VERSION,
    onStateChange: state => {
      deviceLogger.info(`h5.update.state=${state}`);
    },
  });

  return new H5Runtime(storage, versionManager);
}
