/**
 * Phase 6：H5 Runtime 单元测试（规范 §5/§6/§7/§8/§9/§34）。
 */
import { H5VersionManager } from '../../src/updater/h5-version-manager';
import { H5Runtime } from '../../src/updater/h5-runtime';
import { BootStateMachine } from '../../src/app/boot-state-machine';
import { InMemoryH5Storage } from '../../src/storage/in-memory-h5-storage';
import type {
  H5Manifest,
  ManifestProvider,
  PackageDownloader,
  Verifier,
} from '../../src/updater/types';

function makeManifest(overrides: Partial<H5Manifest> = {}): H5Manifest {
  return {
    version: '1.0.0',
    buildId: 'build-001',
    entry: 'index.html',
    packageUrl: 'https://example.com/h5.zip',
    sha256: 'abc123',
    size: 1024,
    publishedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockDeps(manifest: H5Manifest = makeManifest()) {
  const storage = new InMemoryH5Storage();
  const manifestProvider: ManifestProvider = {
    fetchManifest: async () => manifest,
  };
  const downloader: PackageDownloader = {
    download: async () => new Uint8Array([1, 2, 3]),
  };
  const verifier: Verifier = {
    sha256: async () => manifest.sha256,
  };
  return { storage, manifestProvider, downloader, verifier };
}

describe('H5VersionManager 版本比较', () => {
  test('compareVersion a>b 返回 1', () => {
    expect(H5VersionManager.compareVersion('2.0.0', '1.0.0')).toBe(1);
  });

  test('compareVersion a=b 返回 0', () => {
    expect(H5VersionManager.compareVersion('1.2.3', '1.2.3')).toBe(0);
  });

  test('compareVersion a<b 返回 -1', () => {
    expect(H5VersionManager.compareVersion('1.0.0', '2.0.0')).toBe(-1);
  });

  test('compareVersion 支持不同位数', () => {
    expect(H5VersionManager.compareVersion('1.10', '1.9')).toBe(1);
    expect(H5VersionManager.compareVersion('1.0.1', '1.0')).toBe(1);
  });
});

describe('H5VersionManager checkForUpdate', () => {
  test('无当前版本时返回可用更新', async () => {
    const deps = makeMockDeps();
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    const result = await manager.checkForUpdate();
    expect(result.available).toBe(true);
    expect(manager.getState()).toBe('AVAILABLE');
  });

  test('已是最新版本时返回 NO_UPDATE', async () => {
    const deps = makeMockDeps();
    await deps.storage.install('1.0.0', new Uint8Array([1]), makeManifest());
    await deps.storage.activate('1.0.0');
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    const result = await manager.checkForUpdate();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('already_latest');
    expect(manager.getState()).toBe('NO_UPDATE');
  });

  test('app 版本过低时返回 INCOMPATIBLE', async () => {
    const manifest = makeManifest({ minAppVersion: '2.0.0' });
    const deps = makeMockDeps(manifest);
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    const result = await manager.checkForUpdate();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('app_version_too_low');
    expect(manager.getState()).toBe('INCOMPATIBLE');
  });

  test('bridge 版本不兼容时返回 INCOMPATIBLE', async () => {
    const manifest = makeManifest({ bridgeVersion: '2.0.0' });
    const deps = makeMockDeps(manifest);
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    const result = await manager.checkForUpdate();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('bridge_incompatible');
  });
});

describe('H5VersionManager update 流程', () => {
  test('完整更新流程进入 SMOKE_TEST', async () => {
    const deps = makeMockDeps();
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    await manager.update();
    expect(manager.getState()).toBe('SMOKE_TEST');
    expect(manager.getStatus().pendingVersion).toBe('1.0.0');
  });

  test('sha256 校验失败时回滚', async () => {
    const manifest = makeManifest({ sha256: 'wrong-hash' });
    const deps = makeMockDeps(manifest);
    // verifier 返回的 hash 与 manifest 不匹配
    const badVerifier: Verifier = { sha256: async () => 'actual-hash' };
    const manager = new H5VersionManager({
      ...deps,
      verifier: badVerifier,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    await expect(manager.update()).rejects.toThrow();
    expect(manager.getState()).toBe('ROLLBACK');
  });

  test('markReady 后进入 STABLE', async () => {
    const deps = makeMockDeps();
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    await manager.update();
    await manager.markReady();
    expect(manager.getState()).toBe('STABLE');
    expect(manager.getStatus().currentVersion).toBe('1.0.0');
    expect(manager.getStatus().pendingVersion).toBeNull();
  });

  test('markFailed 后回滚', async () => {
    const deps = makeMockDeps();
    await deps.storage.install('0.9.0', new Uint8Array([1]), makeManifest({ version: '0.9.0' }));
    await deps.storage.activate('0.9.0');
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    await manager.update();
    await manager.markFailed();
    expect(manager.getState()).toBe('ROLLBACK');
  });

  test('非 SMOKE_TEST 状态下 markReady 不改变状态', async () => {
    const deps = makeMockDeps();
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    await manager.markReady();
    expect(manager.getState()).toBe('IDLE');
  });
});

describe('H5Runtime', () => {
  test('resolveEntry 无激活版本时返回空串', async () => {
    const deps = makeMockDeps();
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    const runtime = new H5Runtime(deps.storage, manager);
    const entry = await runtime.resolveEntry();
    expect(entry).toBe('');
  });

  test('resolveEntry 有激活版本时返回入口路径', async () => {
    const deps = makeMockDeps();
    await deps.storage.install('1.0.0', new Uint8Array([1]), makeManifest());
    await deps.storage.activate('1.0.0');
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    const runtime = new H5Runtime(deps.storage, manager);
    const entry = await runtime.resolveEntry();
    expect(entry).toContain('index.html');
  });

  test('getCurrentVersion 返回当前版本', async () => {
    const deps = makeMockDeps();
    await deps.storage.install('1.0.0', new Uint8Array([1]), makeManifest());
    await deps.storage.activate('1.0.0');
    const manager = new H5VersionManager({
      ...deps,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
    });
    const runtime = new H5Runtime(deps.storage, manager);
    expect(await runtime.getCurrentVersion()).toBe('1.0.0');
  });
});

describe('BootStateMachine', () => {
  test('初始状态为 BOOT', () => {
    const sm = new BootStateMachine();
    expect(sm.getState()).toBe('BOOT');
  });

  test('正常启动流程', () => {
    const sm = new BootStateMachine();
    expect(sm.transition('LOCAL_READY')).toBe(true);
    expect(sm.getState()).toBe('CHECK_LOCAL');
    expect(sm.transition('UPDATE_CHECKED')).toBe(true);
    expect(sm.getState()).toBe('CHECK_UPDATE');
    expect(sm.transition('H5_PREPARED')).toBe(true);
    expect(sm.getState()).toBe('PREPARE_H5');
    expect(sm.transition('WEBVIEW_LOADED')).toBe(true);
    expect(sm.getState()).toBe('LOAD_WEBVIEW');
    expect(sm.transition('HANDSHAKE_START')).toBe(true);
    expect(sm.getState()).toBe('BRIDGE_HANDSHAKE');
    expect(sm.transition('H5_READY')).toBe(true);
    expect(sm.getState()).toBe('H5_READY');
    expect(sm.transition('RUNNING')).toBe(true);
    expect(sm.getState()).toBe('RUNNING');
  });

  test('非法转移返回 false', () => {
    const sm = new BootStateMachine();
    expect(sm.transition('H5_READY')).toBe(false);
    expect(sm.getState()).toBe('BOOT');
  });

  test('ERROR 触发错误恢复', () => {
    const sm = new BootStateMachine();
    sm.transition('LOCAL_READY');
    expect(sm.transition('ERROR')).toBe(true);
    expect(sm.getState()).toBe('ERROR_RECOVERY');
  });

  test('错误恢复后可重新加载 WebView', () => {
    const sm = new BootStateMachine();
    sm.transition('LOCAL_READY');
    sm.transition('ERROR');
    expect(sm.transition('WEBVIEW_LOADED')).toBe(true);
    expect(sm.getState()).toBe('LOAD_WEBVIEW');
  });
});

describe('InMemoryH5Storage', () => {
  test('install + activate + getActiveEntry', async () => {
    const storage = new InMemoryH5Storage();
    expect(await storage.getCurrentVersion()).toBeNull();
    await storage.install('1.0.0', new Uint8Array([1]), makeManifest());
    expect(await storage.listVersions()).toContain('1.0.0');
    await storage.activate('1.0.0');
    expect(await storage.getCurrentVersion()).toBe('1.0.0');
    const entry = await storage.getActiveEntry();
    expect(entry).toContain('index.html');
  });

  test('rollback 到历史版本', async () => {
    const storage = new InMemoryH5Storage();
    await storage.install('1.0.0', new Uint8Array([1]), makeManifest({ version: '1.0.0' }));
    await storage.install('2.0.0', new Uint8Array([1]), makeManifest({ version: '2.0.0' }));
    await storage.activate('2.0.0');
    expect(await storage.getCurrentVersion()).toBe('2.0.0');
    await storage.rollback('1.0.0');
    expect(await storage.getCurrentVersion()).toBe('1.0.0');
  });

  test('remove 删除版本', async () => {
    const storage = new InMemoryH5Storage();
    await storage.install('1.0.0', new Uint8Array([1]), makeManifest());
    expect(await storage.listVersions()).toHaveLength(1);
    await storage.remove('1.0.0');
    expect(await storage.listVersions()).toHaveLength(0);
  });
});
