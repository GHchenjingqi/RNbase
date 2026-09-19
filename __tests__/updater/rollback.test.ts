/**
 * Phase 8：失败回滚单元测试（规范 §8、§9、§26、§35）。
 */
import { RollbackManager, createInMemoryPersistence } from '../../src/updater/rollback-manager';
import { BootFailureDetector } from '../../src/updater/boot-failure-detector';
import { createInMemoryPointer } from '../../src/updater/activator';

function createRollbackManager(options?: { maxRollbacks?: number; fallbackVersion?: string }) {
  const pointer = createInMemoryPointer(['1.0.0', '1.0.1', '1.0.2'], '1.0.0');
  const persistence = createInMemoryPersistence();
  const manager = new RollbackManager({
    pointer,
    fallbackVersion: options?.fallbackVersion ?? 'builtin-fallback',
    maxConsecutiveRollbacks: options?.maxRollbacks ?? 3,
    persistence,
  });
  return { manager, pointer, persistence };
}

describe('P8.1 RollbackManager', () => {
  test('初始状态', () => {
    const { manager } = createRollbackManager();
    const state = manager.getState();
    expect(state.currentVersion).toBeNull();
    expect(state.previousVersion).toBeNull();
    expect(state.launchStatus).toBe('unknown');
    expect(state.consecutiveRollbacks).toBe(0);
    expect(state.blacklistedVersions).toHaveLength(0);
  });

  test('markTesting 设置 testing 状态', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.1');
    const state = manager.getState();
    expect(state.currentVersion).toBe('1.0.1');
    expect(state.previousVersion).toBeNull();
    expect(state.launchStatus).toBe('testing');
  });

  test('markReady 从 testing 转为 stable', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.1');
    await manager.markReady();
    const state = manager.getState();
    expect(state.launchStatus).toBe('stable');
    expect(state.consecutiveRollbacks).toBe(0);
  });

  test('markReady 在非 testing 状态下不改变', async () => {
    const { manager } = createRollbackManager();
    await manager.markReady();
    expect(manager.getState().launchStatus).toBe('unknown');
  });

  test('启动失败自动回滚到 previousVersion', async () => {
    const { manager, pointer } = createRollbackManager();
    await manager.markTesting('1.0.0');
    await manager.markReady();
    await manager.markTesting('1.0.1');
    const result = await manager.handleBootFailure('js_crash');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rolledBackTo).toBe('1.0.0');
      expect(result.fallbackUsed).toBe(false);
      expect(result.reason).toBe('js_crash');
    }
    expect(await pointer.getCurrent()).toBe('1.0.0');
    expect(manager.getState().launchStatus).toBe('stable');
  });

  test('启动失败将坏版本加入黑名单', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.0');
    await manager.markReady();
    await manager.markTesting('1.0.1');
    await manager.handleBootFailure('js_crash');
    expect(manager.isBlacklisted('1.0.1')).toBe(true);
    expect(manager.isBlacklisted('1.0.0')).toBe(false);
  });

  test('无历史版本时回滚到 fallback', async () => {
    const { manager, pointer } = createRollbackManager();
    await manager.markTesting('1.0.1');
    const result = await manager.handleBootFailure('webview_load_error');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rolledBackTo).toBe('builtin-fallback');
      expect(result.fallbackUsed).toBe(true);
    }
    expect(await pointer.getCurrent()).toBe('builtin-fallback');
  });

  test('连续回滚超过阈值进入 fallback', async () => {
    const { manager, pointer } = createRollbackManager({ maxRollbacks: 2 });
    // 第一次回滚
    await manager.markTesting('1.0.0');
    await manager.markReady();
    await manager.markTesting('1.0.1');
    await manager.handleBootFailure('js_crash');
    expect(manager.getState().consecutiveRollbacks).toBe(1);

    // 第二次回滚
    await manager.markTesting('1.0.2');
    await manager.handleBootFailure('ready_timeout');
    expect(manager.getState().consecutiveRollbacks).toBe(2);

    // 第三次回滚（超过阈值）
    await manager.markTesting('1.0.1'); // 已被黑名单
    const result = await manager.handleBootFailure('handshake_failed');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.fallbackUsed).toBe(true);
    }
    expect(await pointer.getCurrent()).toBe('builtin-fallback');
  });

  test('stable 状态不执行回滚', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.1');
    await manager.markReady();
    const result = await manager.handleBootFailure('js_crash');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('already_rollback');
  });

  test('手动回滚到指定版本', async () => {
    const { manager, pointer } = createRollbackManager();
    await manager.markTesting('1.0.1');
    await manager.markReady();
    const result = await manager.manualRollback('1.0.0');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rolledBackTo).toBe('1.0.0');
    }
    expect(await pointer.getCurrent()).toBe('1.0.0');
    expect(manager.getState().launchStatus).toBe('testing'); // 手动回滚后需重新验证
  });

  test('手动回滚到当前版本失败', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.1');
    const result = await manager.manualRollback('1.0.1');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('already_rollback');
  });

  test('黑名单管理', () => {
    const { manager } = createRollbackManager();
    expect(manager.isBlacklisted('1.0.1')).toBe(false);
    manager.blacklist('1.0.1');
    expect(manager.isBlacklisted('1.0.1')).toBe(true);
    manager.removeFromBlacklist('1.0.1');
    expect(manager.isBlacklisted('1.0.1')).toBe(false);
  });

  test('重置连续回滚计数', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.1');
    await manager.handleBootFailure('js_crash');
    expect(manager.getState().consecutiveRollbacks).toBe(1);
    manager.resetConsecutiveRollbacks();
    expect(manager.getState().consecutiveRollbacks).toBe(0);
  });

  test('持久化保存与恢复', async () => {
    const { manager, persistence } = createRollbackManager();
    await manager.markTesting('1.0.1');
    await manager.markReady();
    const stored = persistence.getStored();
    expect(stored?.currentVersion).toBe('1.0.1');
    expect(stored?.launchStatus).toBe('stable');

    // 创建新 manager 并恢复
    const pointer2 = createInMemoryPointer(['1.0.1'], '1.0.1');
    const manager2 = new RollbackManager({ pointer: pointer2, persistence });
    await manager2.restore();
    expect(manager2.getState().currentVersion).toBe('1.0.1');
    expect(manager2.getState().launchStatus).toBe('stable');
  });
});

describe('P8.2 BootFailureDetector', () => {
  test('初始状态未启动', () => {
    const { manager } = createRollbackManager();
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 1000,
    });
    expect(detector.isResolved()).toBe(false);
    expect(detector.isWebViewLoaded()).toBe(false);
  });

  test('start 启动监控', () => {
    const { manager } = createRollbackManager();
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 1000,
    });
    detector.start();
    expect(detector.isResolved()).toBe(false);
  });

  test('webview_loaded 事件标记加载完成', async () => {
    const { manager } = createRollbackManager();
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 1000,
    });
    detector.start();
    await detector.handleEvent({ type: 'webview_loaded' });
    expect(detector.isWebViewLoaded()).toBe(true);
  });

  test('ready 事件标记启动成功', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.1');
    const onSuccess = jest.fn();
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 5000,
      onSuccess,
    });
    detector.start();
    await detector.handleEvent({ type: 'ready' });
    expect(detector.isResolved()).toBe(true);
    expect(manager.getState().launchStatus).toBe('stable');
    expect(onSuccess).toHaveBeenCalled();
  });

  test('webview_load_error 触发回滚', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.0');
    await manager.markReady();
    await manager.markTesting('1.0.1');
    const onFailure = jest.fn();
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 5000,
      onFailure,
    });
    detector.start();
    await detector.handleEvent({
      type: 'webview_load_error',
      details: 'net::ERR_CONNECTION_REFUSED',
    });
    expect(detector.isResolved()).toBe(true);
    expect(onFailure).toHaveBeenCalledWith('webview_load_error', 'net::ERR_CONNECTION_REFUSED');
    expect(manager.getState().currentVersion).toBe('1.0.0');
  });

  test('js_crash 触发回滚', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.0');
    await manager.markReady();
    await manager.markTesting('1.0.1');
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 5000,
    });
    detector.start();
    await detector.handleEvent({
      type: 'js_crash',
      details: 'TypeError: undefined is not a function',
    });
    expect(manager.getState().currentVersion).toBe('1.0.0');
    expect(manager.isBlacklisted('1.0.1')).toBe(true);
  });

  test('handshake_failed 触发回滚', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.0');
    await manager.markReady();
    await manager.markTesting('1.0.1');
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 5000,
    });
    detector.start();
    await detector.handleEvent({
      type: 'handshake_failed',
      details: 'Bridge version mismatch',
    });
    expect(manager.getState().currentVersion).toBe('1.0.0');
  });

  test('READY 超时触发回滚', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.0');
    await manager.markReady();
    await manager.markTesting('1.0.1');
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 100,
    });
    detector.start();
    // 等待超时
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(detector.isResolved()).toBe(true);
    expect(manager.getState().currentVersion).toBe('1.0.0');
  });

  test('markReady 等价于 ready 事件', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.1');
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 5000,
    });
    detector.start();
    await detector.markReady();
    expect(detector.isResolved()).toBe(true);
    expect(manager.getState().launchStatus).toBe('stable');
  });

  test('triggerFailure 手动触发失败', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.0');
    await manager.markReady();
    await manager.markTesting('1.0.1');
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 5000,
    });
    detector.start();
    await detector.triggerFailure('ready_timeout', '手动触发');
    expect(detector.isResolved()).toBe(true);
    expect(manager.getState().currentVersion).toBe('1.0.0');
  });

  test('stop 停止监控并清除计时器', async () => {
    const { manager } = createRollbackManager();
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 100,
    });
    detector.start();
    detector.stop();
    // 等待超时时间，确认不会触发回滚
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(detector.isResolved()).toBe(false);
  });

  test('已解析后不再处理事件', async () => {
    const { manager } = createRollbackManager();
    await manager.markTesting('1.0.1');
    const detector = new BootFailureDetector({
      rollbackManager: manager,
      readyTimeoutMs: 5000,
    });
    detector.start();
    await detector.handleEvent({ type: 'ready' });
    expect(detector.isResolved()).toBe(true);
    // 后续事件应被忽略
    await detector.handleEvent({ type: 'js_crash' });
    expect(manager.getState().launchStatus).toBe('stable');
  });
});
