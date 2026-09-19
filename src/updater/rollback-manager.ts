/**
 * 回滚管理器（Phase 8 / 规范 §8、§9、§26、§35）。
 *
 * 职责：
 *  - 记录 currentVersion / previousVersion / pendingVersion / launchStatus
 *  - 新版本首次启动置 launchStatus=testing，READY 确认后才置 stable
 *  - 启动失败判定与自动回滚
 *  - 熔断/黑名单：回滚后对问题版本打标记，避免反复拉回坏版本
 *  - 连续回滚保护：多次失败时停留在内置 fallback
 *
 * 接口驱动：CurrentPointer 可注入，便于单测与替换为真实实现。
 */
import type { CurrentPointer } from './activator';
import { UPDATE_MAX_ROLLBACKS, UPDATE_FALLBACK_VERSION } from '../config';

export type LaunchStatus = 'testing' | 'stable' | 'unknown';

export type RollbackState = {
  currentVersion: string | null;
  previousVersion: string | null;
  pendingVersion: string | null;
  launchStatus: LaunchStatus;
  /** 连续回滚次数 */
  consecutiveRollbacks: number;
  /** 被熔断的版本列表（启动失败的版本） */
  blacklistedVersions: string[];
};

export type BootFailureReason =
  | 'webview_load_error'
  | 'js_crash'
  | 'handshake_failed'
  | 'ready_timeout'
  | 'unknown';

export type RollbackResult =
  | {
      success: true;
      rolledBackTo: string | null;
      reason: BootFailureReason;
      fallbackUsed: boolean;
    }
  | {
      success: false;
      reason: 'no_previous_version' | 'already_rollback' | 'max_rollbacks_exceeded';
      details: string;
    };

export type RollbackManagerOptions = {
  pointer: CurrentPointer;
  /** 内置 fallback 版本标识（连续回滚超过阈值时使用） */
  fallbackVersion?: string;
  /** 最大连续回滚次数，默认 3，超过后进入 fallback */
  maxConsecutiveRollbacks?: number;
  /** 状态持久化接口（可选，用于跨启动恢复状态） */
  persistence?: RollbackPersistence;
  /** 回滚事件回调 */
  onRollback?: (state: RollbackState, reason: BootFailureReason) => void;
  /** READY 确认回调 */
  onReady?: (state: RollbackState) => void;
};

export type RollbackPersistence = {
  save: (state: RollbackState) => Promise<void>;
  load: () => Promise<RollbackState | null>;
};

export class RollbackManager {
  private readonly options: Required<
    Omit<RollbackManagerOptions, 'persistence' | 'onRollback' | 'onReady'>
  > & {
    persistence?: RollbackPersistence;
    onRollback?: RollbackManagerOptions['onRollback'];
    onReady?: RollbackManagerOptions['onReady'];
  };
  private state: RollbackState;

  constructor(options: RollbackManagerOptions) {
    this.options = {
      pointer: options.pointer,
      fallbackVersion: options.fallbackVersion ?? UPDATE_FALLBACK_VERSION,
      maxConsecutiveRollbacks: options.maxConsecutiveRollbacks ?? UPDATE_MAX_ROLLBACKS,
      persistence: options.persistence,
      onRollback: options.onRollback,
      onReady: options.onReady,
    };
    this.state = {
      currentVersion: null,
      previousVersion: null,
      pendingVersion: null,
      launchStatus: 'unknown',
      consecutiveRollbacks: 0,
      blacklistedVersions: [],
    };
  }

  /** 从持久化恢复状态（启动时调用）。 */
  async restore(): Promise<void> {
    if (!this.options.persistence) return;
    try {
      const saved = await this.options.persistence.load();
      if (saved) {
        this.state = saved;
      }
    } catch {
      // 持久化失败，使用默认状态
    }
  }

  /** 获取当前状态。 */
  getState(): RollbackState {
    return {
      ...this.state,
      blacklistedVersions: [...this.state.blacklistedVersions],
    };
  }

  /**
   * 标记新版本启动中（testing 状态）。
   * 在激活新版本后、WebView 加载前调用。
   */
  async markTesting(version: string): Promise<void> {
    this.state.previousVersion = this.state.currentVersion;
    this.state.currentVersion = version;
    this.state.pendingVersion = null;
    this.state.launchStatus = 'testing';
    await this.persist();
  }

  /**
   * 标记新版本启动成功（READY 确认）。
   * H5 完成握手并调用 app.ready 后调用。
   */
  async markReady(): Promise<void> {
    if (this.state.launchStatus !== 'testing') {
      return; // 非 testing 状态不处理
    }
    this.state.launchStatus = 'stable';
    this.state.consecutiveRollbacks = 0; // 成功后重置连续回滚计数
    await this.persist();
    this.options.onReady?.(this.getState());
  }

  /**
   * 检查版本是否被熔断（黑名单）。
   * 更新检查时调用，避免拉回坏版本。
   */
  isBlacklisted(version: string): boolean {
    return this.state.blacklistedVersions.includes(version);
  }

  /**
   * 将版本加入黑名单（熔断）。
   * 回滚后自动调用。
   */
  blacklist(version: string): void {
    if (!this.state.blacklistedVersions.includes(version)) {
      this.state.blacklistedVersions.push(version);
    }
  }

  /** 从黑名单移除版本（手动修复后调用）。 */
  removeFromBlacklist(version: string): void {
    this.state.blacklistedVersions = this.state.blacklistedVersions.filter(v => v !== version);
  }

  /**
   * 处理启动失败，执行自动回滚。
   *
   * 流程：
   *  1. 检查是否超过最大连续回滚次数 → 进入 fallback
   *  2. 将当前版本加入黑名单
   *  3. 切回 previousVersion（或 fallback）
   *  4. 重置 launchStatus
   *  5. 增加连续回滚计数
   */
  async handleBootFailure(reason: BootFailureReason): Promise<RollbackResult> {
    if (this.state.launchStatus === 'stable') {
      return {
        success: false,
        reason: 'already_rollback',
        details: '当前版本已 stable，不执行回滚',
      };
    }

    const failedVersion = this.state.currentVersion;
    if (failedVersion) {
      this.blacklist(failedVersion);
    }

    // 检查连续回滚次数
    if (this.state.consecutiveRollbacks >= this.options.maxConsecutiveRollbacks) {
      // 超过阈值，进入 fallback
      const fallbackVersion = this.options.fallbackVersion;
      try {
        await this.options.pointer.setCurrent(fallbackVersion);
      } catch {
        // fallback 切换失败，保留现状
      }
      this.state.currentVersion = fallbackVersion;
      this.state.previousVersion = failedVersion;
      this.state.launchStatus = 'stable'; // fallback 视为 stable
      this.state.consecutiveRollbacks += 1;
      await this.persist();
      this.options.onRollback?.(this.getState(), reason);
      return {
        success: true,
        rolledBackTo: fallbackVersion,
        reason,
        fallbackUsed: true,
      };
    }

    // 正常回滚到 previousVersion
    const rollbackTarget = this.state.previousVersion;
    if (!rollbackTarget) {
      // 没有历史版本，进入 fallback
      const fallbackVersion = this.options.fallbackVersion;
      try {
        await this.options.pointer.setCurrent(fallbackVersion);
      } catch {
        // ignore
      }
      this.state.currentVersion = fallbackVersion;
      this.state.launchStatus = 'stable';
      this.state.consecutiveRollbacks += 1;
      await this.persist();
      this.options.onRollback?.(this.getState(), reason);
      return {
        success: true,
        rolledBackTo: fallbackVersion,
        reason,
        fallbackUsed: true,
      };
    }

    try {
      await this.options.pointer.setCurrent(rollbackTarget);
    } catch (err) {
      return {
        success: false,
        reason: 'no_previous_version',
        details: err instanceof Error ? err.message : String(err),
      };
    }

    this.state.currentVersion = rollbackTarget;
    this.state.previousVersion = failedVersion;
    this.state.launchStatus = 'stable'; // 回滚到的版本视为 stable（之前已验证）
    this.state.consecutiveRollbacks += 1;
    await this.persist();
    this.options.onRollback?.(this.getState(), reason);

    return {
      success: true,
      rolledBackTo: rollbackTarget,
      reason,
      fallbackUsed: false,
    };
  }

  /**
   * 手动回滚到指定版本（错误页「使用上一版本」按钮调用）。
   */
  async manualRollback(targetVersion: string): Promise<RollbackResult> {
    if (targetVersion === this.state.currentVersion) {
      return {
        success: false,
        reason: 'already_rollback',
        details: '目标版本已是当前版本',
      };
    }

    const current = this.state.currentVersion;
    try {
      await this.options.pointer.setCurrent(targetVersion);
    } catch (err) {
      return {
        success: false,
        reason: 'no_previous_version',
        details: err instanceof Error ? err.message : String(err),
      };
    }

    this.state.previousVersion = current;
    this.state.currentVersion = targetVersion;
    this.state.launchStatus = 'testing'; // 手动回滚后需要重新验证
    await this.persist();

    return {
      success: true,
      rolledBackTo: targetVersion,
      reason: 'unknown',
      fallbackUsed: false,
    };
  }

  /** 重置连续回滚计数（手动修复后调用）。 */
  resetConsecutiveRollbacks(): void {
    this.state.consecutiveRollbacks = 0;
  }

  private async persist(): Promise<void> {
    if (!this.options.persistence) return;
    try {
      await this.options.persistence.save(this.getState());
    } catch {
      // 持久化失败不影响主流程
    }
  }
}

/** 创建 InMemory 持久化（用于测试）。 */
export function createInMemoryPersistence(): RollbackPersistence & {
  getStored: () => RollbackState | null;
} {
  let stored: RollbackState | null = null;
  return {
    async save(state) {
      stored = state;
    },
    async load() {
      return stored;
    },
    getStored() {
      return stored;
    },
  };
}
