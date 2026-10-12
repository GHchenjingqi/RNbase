/**
 * 演示用运行时（仅 App 组合层示例使用）。
 * 使用内存存储；无本地 H5 版本时由上层（resolveH5Source）回退到内置兜底页。
 * 版本管理器配置为“无需更新”的安全桩，便于离线演示 Bridge 全链路。
 */
import { H5Runtime, H5VersionManager } from '../updater';
import { InMemoryH5Storage } from '../storage';
import type { H5Manifest } from '../updater';

function demoManifest(): H5Manifest {
  return {
    version: '0.0.0',
    buildId: 'demo',
    entry: 'index.html',
    packageUrl: '',
    sha256: '',
    size: 0,
    publishedAt: new Date().toISOString(),
    minAppVersion: '0.0.1',
    bridgeVersion: '1.0.0',
  };
}

export function createDemoRuntime(): H5Runtime {
  const storage = new InMemoryH5Storage();
  const versionManager = new H5VersionManager({
    storage,
    manifestProvider: { fetchManifest: async () => demoManifest() },
    downloader: { download: async () => new Uint8Array() },
    verifier: { sha256: async () => '' },
    appVersion: '0.0.1',
    bridgeVersion: '1.0.0',
  });
  return new H5Runtime(storage, versionManager);
}
