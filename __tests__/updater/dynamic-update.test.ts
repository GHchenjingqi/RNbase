/**
 * Phase 7：动态 H5 更新单元测试（规范 §35-§39、§55-§58）。
 */
import { UpdateStateMachine } from '../../src/updater/update-state';
import { ManifestClient, createMockManifestClient } from '../../src/updater/manifest-client';
import {
  checkForUpdate,
  compareVersion,
  checkAppVersionCompatibility,
  checkBridgeCompatibility,
  checkRollout,
} from '../../src/updater/update-checker';
import { PackageDownloader, createMockDownloader } from '../../src/updater/downloader';
import { verifyPackage, createMockHasher, createFailingHasher } from '../../src/updater/verifier';
import {
  PackageInstaller,
  createInMemoryFileSystem,
  createMockUnzipper,
} from '../../src/updater/installer';
import { VersionActivator, createInMemoryPointer } from '../../src/updater/activator';
import { UpdateOrchestrator } from '../../src/updater/update-orchestrator';
import type { H5Manifest } from '../../src/updater/types';

function makeManifest(overrides: Partial<H5Manifest> = {}): H5Manifest {
  return {
    version: '1.0.1',
    buildId: 'build-001',
    entry: 'index.html',
    packageUrl: 'https://cdn.example.com/h5/1.0.1.zip',
    sha256: 'abc123',
    size: 1024,
    publishedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('P7.1 UpdateStateMachine', () => {
  test('初始状态为 IDLE', () => {
    const sm = new UpdateStateMachine();
    expect(sm.getState()).toBe('IDLE');
  });

  test('正常更新流程状态流转', () => {
    const sm = new UpdateStateMachine();
    expect(sm.transition('CHECK_START')).toBe(true);
    expect(sm.getState()).toBe('CHECKING');
    expect(sm.transition('UPDATE_AVAILABLE')).toBe(true);
    expect(sm.getState()).toBe('AVAILABLE');
    expect(sm.transition('DOWNLOAD_START')).toBe(true);
    expect(sm.getState()).toBe('DOWNLOADING');
    expect(sm.transition('DOWNLOAD_COMPLETE')).toBe(true);
    expect(sm.getState()).toBe('VERIFYING');
    expect(sm.transition('VERIFY_COMPLETE')).toBe(true);
    expect(sm.getState()).toBe('INSTALLING');
    expect(sm.transition('INSTALL_COMPLETE')).toBe(true);
    expect(sm.getState()).toBe('READY_TO_ACTIVATE');
    expect(sm.transition('ACTIVATE_START')).toBe(true);
    expect(sm.getState()).toBe('ACTIVATING');
    expect(sm.transition('ACTIVATE_COMPLETE')).toBe(true);
    expect(sm.getState()).toBe('SMOKE_TEST');
    expect(sm.transition('READY_CONFIRMED')).toBe(true);
    expect(sm.getState()).toBe('STABLE');
  });

  test('非法转移返回 false', () => {
    const sm = new UpdateStateMachine();
    expect(sm.transition('DOWNLOAD_START')).toBe(false);
    expect(sm.getState()).toBe('IDLE');
  });

  test('失败态流转', () => {
    const sm = new UpdateStateMachine();
    sm.transition('CHECK_START');
    sm.transition('UPDATE_AVAILABLE');
    sm.transition('DOWNLOAD_START');
    expect(sm.transition('DOWNLOAD_FAILED')).toBe(true);
    expect(sm.getState()).toBe('DOWNLOAD_FAILED');
    expect(sm.isFailed()).toBe(true);
  });

  test('状态变化订阅', () => {
    const sm = new UpdateStateMachine();
    const states: string[] = [];
    sm.subscribe(state => states.push(state));
    sm.transition('CHECK_START');
    sm.transition('NO_UPDATE');
    expect(states).toEqual(['CHECKING', 'NO_UPDATE']);
  });
});

describe('P7.2 ManifestClient', () => {
  test('Mock manifest client 返回最新版本', async () => {
    const client = createMockManifestClient([
      makeManifest({ version: '1.0.0' }),
      makeManifest({ version: '1.0.1' }),
    ]);
    const manifest = await client.fetchLatest();
    expect(manifest.version).toBe('1.0.1');
  });

  test('短缓存生效', async () => {
    const client = createMockManifestClient(makeManifest({ version: '1.0.0' }), {
      cacheTtlMs: 60000,
    });
    const m1 = await client.fetchLatest();
    const m2 = await client.fetchLatest();
    expect(m1).toBe(m2); // 同一引用（缓存）
  });

  test('clearCache 清除缓存', async () => {
    const client = createMockManifestClient(makeManifest({ version: '1.0.0' }), {
      cacheTtlMs: 60000,
    });
    await client.fetchLatest();
    client.clearCache();
    const m2 = await client.fetchLatest();
    expect(m2.version).toBe('1.0.0');
  });

  test('缺少必填字段抛出错误', async () => {
    const badManifest = { version: '1.0.0' }; // 缺少 entry/packageUrl/sha256/size/publishedAt
    const fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => badManifest,
      text: async () => JSON.stringify(badManifest),
    });
    const client = new ManifestClient({
      latestUrl: 'https://example.com/manifest.json',
      fetcher,
      cacheTtlMs: 0,
    });
    await expect(client.fetchLatest()).rejects.toThrow();
  });
});

describe('P7.3 UpdateChecker', () => {
  test('compareVersion 比较', () => {
    expect(compareVersion('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersion('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersion('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersion('2026.08.31.001', '2026.08.30.001')).toBe(1);
  });

  test('checkAppVersionCompatibility', () => {
    const m = makeManifest({ minAppVersion: '2.0.0', maxAppVersion: '3.0.0' });
    expect(checkAppVersionCompatibility(m, '1.0.0')).toBe('too_low');
    expect(checkAppVersionCompatibility(m, '2.5.0')).toBe('ok');
    expect(checkAppVersionCompatibility(m, '3.5.0')).toBe('too_high');
  });

  test('checkBridgeCompatibility', () => {
    const m = makeManifest({ bridgeVersion: '1.0.0' });
    expect(checkBridgeCompatibility(m, '1.0.0')).toBe(true);
    expect(checkBridgeCompatibility(m, '1.5.0')).toBe(true);
    expect(checkBridgeCompatibility(m, '2.0.0')).toBe(false);
    expect(checkBridgeCompatibility(m, '0.9.0')).toBe(false);
  });

  test('checkForUpdate 正常更新', () => {
    const result = checkForUpdate(makeManifest({ version: '1.0.1' }), {
      currentH5Version: '1.0.0',
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
      platform: 'android',
    });
    expect(result.available).toBe(true);
  });

  test('checkForUpdate 已是最新', () => {
    const result = checkForUpdate(makeManifest({ version: '1.0.0' }), {
      currentH5Version: '1.0.0',
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
      platform: 'android',
    });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('already_latest');
  });

  test('checkForUpdate app 版本过低', () => {
    const result = checkForUpdate(makeManifest({ version: '1.0.1', minAppVersion: '2.0.0' }), {
      currentH5Version: '1.0.0',
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
      platform: 'android',
    });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('app_version_too_low');
  });

  test('checkRollout 百分比灰度', () => {
    // 固定 deviceId 应该得到稳定结果
    const ctx = {
      currentH5Version: null,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
      platform: 'android' as const,
      deviceId: 'device-123',
    };
    const r1 = checkRollout({ percentage: 50 }, ctx);
    const r2 = checkRollout({ percentage: 50 }, ctx);
    expect(r1).toBe(r2); // 稳定
  });

  test('checkRollout 平台过滤', () => {
    const ctx = {
      currentH5Version: null,
      appVersion: '1.0.0',
      bridgeVersion: '1.0.0',
      platform: 'android' as const,
    };
    expect(checkRollout({ platforms: ['ios'] }, ctx)).toBe(false);
    expect(checkRollout({ platforms: ['android'] }, ctx)).toBe(true);
  });
});

describe('P7.4 Downloader', () => {
  test('正常下载', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const downloader = new PackageDownloader(createMockDownloader(data));
    const result = await downloader.download('https://example.com/package.zip');
    expect(result).toEqual(data);
  });

  test('重试后成功', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const downloader = new PackageDownloader(createMockDownloader(data, { failAttempts: 2 }), {
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });
    const result = await downloader.download('https://example.com/package.zip');
    expect(result).toEqual(data);
  });

  test('超过重试次数抛出错误', async () => {
    const downloader = new PackageDownloader(
      createMockDownloader(new Uint8Array(), { failAttempts: 10 }),
      { maxRetries: 2, retryBaseDelayMs: 10 },
    );
    await expect(downloader.download('https://example.com/package.zip')).rejects.toThrow();
  });

  test('进度回调', async () => {
    const data = new Uint8Array(1000);
    const progresses: number[] = [];
    const downloader = new PackageDownloader(createMockDownloader(data, { totalSize: 1000 }), {
      onProgress: p => progresses.push(p.percent),
    });
    await downloader.download('https://example.com/package.zip');
    expect(progresses.length).toBeGreaterThan(0);
    expect(progresses[progresses.length - 1]).toBe(100);
  });
});

describe('P7.5 Verifier', () => {
  test('SHA-256 校验通过', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = await verifyPackage(data, {
      expectedSha256: 'abc123',
      expectedSize: 3,
      hasher: createMockHasher('abc123'),
    });
    expect(result.ok).toBe(true);
  });

  test('SHA-256 不匹配', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = await verifyPackage(data, {
      expectedSha256: 'abc123',
      expectedSize: 3,
      hasher: createFailingHasher(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('sha256_mismatch');
  });

  test('大小不匹配', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = await verifyPackage(data, {
      expectedSha256: 'abc123',
      expectedSize: 100,
      hasher: createMockHasher('abc123'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('size_mismatch');
  });

  test('大小容差', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = await verifyPackage(data, {
      expectedSha256: 'abc123',
      expectedSize: 5,
      sizeTolerance: 2,
      hasher: createMockHasher('abc123'),
    });
    expect(result.ok).toBe(true);
  });
});

describe('P7.6 Installer', () => {
  test('正常安装', async () => {
    const fs = createInMemoryFileSystem();
    const files = [
      { path: 'index.html', data: new Uint8Array([1]) },
      { path: 'js/app.js', data: new Uint8Array([2]) },
    ];
    const installer = new PackageInstaller({
      fileSystem: fs,
      unzipper: createMockUnzipper(files),
    });
    const result = await installer.install(
      new Uint8Array([1, 2, 3]),
      makeManifest({ entry: 'index.html' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe('1.0.1');
      expect(result.fileCount).toBe(2);
    }
    expect(fs.getVersions()).toContain('1.0.1');
  });

  test('缺少入口文件失败', async () => {
    const fs = createInMemoryFileSystem();
    const installer = new PackageInstaller({
      fileSystem: fs,
      unzipper: createMockUnzipper([{ path: 'other.html', data: new Uint8Array([1]) }]),
    });
    const result = await installer.install(new Uint8Array(), makeManifest({ entry: 'index.html' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_entry');
  });

  test('解压失败', async () => {
    const fs = createInMemoryFileSystem();
    const installer = new PackageInstaller({
      fileSystem: fs,
      unzipper: createMockUnzipper([], { fail: true }),
    });
    const result = await installer.install(new Uint8Array(), makeManifest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unzip_failed');
  });
});

describe('P7.7 Activator', () => {
  test('正常激活', async () => {
    const pointer = createInMemoryPointer(['1.0.0', '1.0.1'], '1.0.0');
    const activator = new VersionActivator(pointer);
    const result = await activator.activate('1.0.1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe('1.0.1');
      expect(result.previousVersion).toBe('1.0.0');
    }
    expect(await pointer.getCurrent()).toBe('1.0.1');
  });

  test('未安装版本激活失败', async () => {
    const pointer = createInMemoryPointer(['1.0.0'], '1.0.0');
    const activator = new VersionActivator(pointer);
    const result = await activator.activate('2.0.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_installed');
  });

  test('已是当前版本', async () => {
    const pointer = createInMemoryPointer(['1.0.0'], '1.0.0');
    const activator = new VersionActivator(pointer);
    const result = await activator.activate('1.0.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_current');
  });
});

describe('P7.8 UpdateOrchestrator 完整流程', () => {
  function createOrchestrator(manifest: H5Manifest = makeManifest()) {
    const fs = createInMemoryFileSystem();
    const pointer = createInMemoryPointer([], null);
    const packageData = new Uint8Array(manifest.size);
    const orchestrator = new UpdateOrchestrator({
      manifestClient: createMockManifestClient(manifest),
      httpDownloader: createMockDownloader(packageData),
      hasher: createMockHasher(manifest.sha256),
      fileSystem: fs,
      unzipper: createMockUnzipper([{ path: manifest.entry, data: new Uint8Array([1]) }]),
      currentPointer: pointer,
      context: {
        currentH5Version: null,
        appVersion: '1.0.0',
        bridgeVersion: '1.0.0',
        platform: 'android',
        deviceId: 'test-device',
      },
      checkThrottleMs: 0,
    });
    return { orchestrator, fs, pointer };
  }

  test('检查更新可用', async () => {
    const { orchestrator } = createOrchestrator();
    const result = await orchestrator.check();
    expect(result.available).toBe(true);
    expect(orchestrator.getState()).toBe('AVAILABLE');
  });

  test('检查节流', async () => {
    const { orchestrator } = createOrchestrator();
    (
      orchestrator as unknown as { options: { checkThrottleMs: number } }
    ).options.checkThrottleMs = 60000;
    await orchestrator.check();
    const result2 = await orchestrator.check();
    expect(result2.available).toBe(false);
    if (!result2.available) expect(result2.reason).toBe('throttled');
  });

  test('完整更新流程（检查→下载→校验→安装）', async () => {
    const { orchestrator, fs } = createOrchestrator();
    const checkResult = await orchestrator.check();
    expect(checkResult.available).toBe(true);

    const updateResult = await orchestrator.update();
    expect(updateResult.success).toBe(true);
    if (updateResult.success) {
      expect(updateResult.version).toBe('1.0.1');
      expect(updateResult.activated).toBe(false);
    }
    expect(orchestrator.getState()).toBe('READY_TO_ACTIVATE');
    expect(fs.getVersions()).toContain('1.0.1');
  });

  test('激活新版本', async () => {
    const { orchestrator, pointer } = createOrchestrator();
    await orchestrator.check();
    await orchestrator.update();
    const activateResult = await orchestrator.activate();
    expect(activateResult.success).toBe(true);
    if (activateResult.success) expect(activateResult.activated).toBe(true);
    expect(orchestrator.getState()).toBe('SMOKE_TEST');
    expect(await pointer.getCurrent()).toBe('1.0.1');
  });

  test('READY 确认进入 STABLE', async () => {
    const { orchestrator } = createOrchestrator();
    await orchestrator.check();
    await orchestrator.update();
    await orchestrator.activate();
    expect(orchestrator.markReady()).toBe(true);
    expect(orchestrator.getState()).toBe('STABLE');
  });

  test('强制更新检测', () => {
    const m = makeManifest({ forceUpdate: true });
    const { orchestrator } = createOrchestrator(m);
    expect(orchestrator.isForceUpdateRequired(m)).toBe(true);
  });

  test('hash 校验失败', async () => {
    const m = makeManifest({ sha256: 'wrong-hash', size: 3 });
    const { orchestrator } = createOrchestrator(m);
    (
      orchestrator as unknown as {
        options: { hasher: ReturnType<typeof createFailingHasher> };
      }
    ).options.hasher = createFailingHasher();
    await orchestrator.check();
    const result = await orchestrator.update();
    expect(result.success).toBe(false);
    expect(orchestrator.getState()).toBe('VERIFY_FAILED');
  });
});
