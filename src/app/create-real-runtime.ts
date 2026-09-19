/**
 * 生产运行时装配：动态 H5 子包自动升级全链路（真实 IO）。
 *
 *  - manifest 拉取：ManifestClient 读 config.H5_MANIFEST_URL
 *  - 包下载：PackageDownloader + RN fetch（带重试/进度）
 *  - 校验：原生 ERPH5 SHA-256（Hermes 无 Web Crypto）
 *  - 落盘/激活/回滚：原生 ERPH5（filesDir/h5-versions/ + current.json 原子切换）
 *
 * 原生模块缺失时（测试/浏览器环境）降级为内存演示运行时，保证可启动。
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
  if (!NativeModules.ERPH5) {
    deviceLogger.warn('ERPH5 原生模块未注册，降级为内存演示运行时');
    return createDemoRuntime();
  }

  const storage = new NativeH5Storage();
  const manifestClient = new ManifestClient({ latestUrl: H5_MANIFEST_URL });
  const downloader = new PackageDownloader(nativeHttpDownloader);

  const versionManager = new H5VersionManager({
    storage,
    manifestProvider: { fetchManifest: () => manifestClient.fetchLatest() },
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
