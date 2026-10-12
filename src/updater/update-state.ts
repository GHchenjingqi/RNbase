/**
 * 更新状态机（Phase 7 / 规范 §35）。
 *
 * 状态流转：
 *   IDLE → CHECKING → AVAILABLE → DOWNLOADING → VERIFYING → INSTALLING →
 *   READY_TO_ACTIVATE → ACTIVATING → SMOKE_TEST → STABLE
 *
 * 失败态：NO_UPDATE / INCOMPATIBLE / DOWNLOAD_FAILED / VERIFY_FAILED /
 *         INSTALL_FAILED / BOOT_FAILED → ROLLBACK
 *
 * 纯逻辑、可单测；与具体 IO 解耦。
 */

export type UpdateState =
  | 'IDLE'
  | 'CHECKING'
  | 'AVAILABLE'
  | 'NO_UPDATE'
  | 'INCOMPATIBLE'
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'INSTALLING'
  | 'READY_TO_ACTIVATE'
  | 'ACTIVATING'
  | 'SMOKE_TEST'
  | 'STABLE'
  | 'DOWNLOAD_FAILED'
  | 'VERIFY_FAILED'
  | 'INSTALL_FAILED'
  | 'BOOT_FAILED'
  | 'ROLLBACK';

export type UpdateTrigger =
  | 'CHECK_START'
  | 'UPDATE_AVAILABLE'
  | 'NO_UPDATE'
  | 'INCOMPATIBLE'
  | 'DOWNLOAD_START'
  | 'DOWNLOAD_COMPLETE'
  | 'DOWNLOAD_FAILED'
  | 'VERIFY_START'
  | 'VERIFY_COMPLETE'
  | 'VERIFY_FAILED'
  | 'INSTALL_START'
  | 'INSTALL_COMPLETE'
  | 'INSTALL_FAILED'
  | 'READY_TO_ACTIVATE'
  | 'ACTIVATE_START'
  | 'ACTIVATE_COMPLETE'
  | 'SMOKE_TEST_START'
  | 'READY_CONFIRMED'
  | 'BOOT_FAILED'
  | 'ROLLBACK_START'
  | 'ROLLBACK_COMPLETE'
  | 'RESET';

const TRANSITIONS: Record<UpdateState, Partial<Record<UpdateTrigger, UpdateState>>> = {
  IDLE: {
    CHECK_START: 'CHECKING',
  },
  CHECKING: {
    UPDATE_AVAILABLE: 'AVAILABLE',
    NO_UPDATE: 'NO_UPDATE',
    INCOMPATIBLE: 'INCOMPATIBLE',
  },
  AVAILABLE: {
    DOWNLOAD_START: 'DOWNLOADING',
  },
  NO_UPDATE: {
    CHECK_START: 'CHECKING',
    RESET: 'IDLE',
  },
  INCOMPATIBLE: {
    CHECK_START: 'CHECKING',
    RESET: 'IDLE',
  },
  DOWNLOADING: {
    DOWNLOAD_COMPLETE: 'VERIFYING',
    DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  },
  VERIFYING: {
    VERIFY_COMPLETE: 'INSTALLING',
    VERIFY_FAILED: 'VERIFY_FAILED',
  },
  INSTALLING: {
    INSTALL_COMPLETE: 'READY_TO_ACTIVATE',
    INSTALL_FAILED: 'INSTALL_FAILED',
  },
  READY_TO_ACTIVATE: {
    ACTIVATE_START: 'ACTIVATING',
  },
  ACTIVATING: {
    ACTIVATE_COMPLETE: 'SMOKE_TEST',
  },
  SMOKE_TEST: {
    READY_CONFIRMED: 'STABLE',
    BOOT_FAILED: 'BOOT_FAILED',
  },
  STABLE: {
    CHECK_START: 'CHECKING',
    RESET: 'IDLE',
  },
  DOWNLOAD_FAILED: {
    CHECK_START: 'CHECKING',
    RESET: 'IDLE',
  },
  VERIFY_FAILED: {
    CHECK_START: 'CHECKING',
    RESET: 'IDLE',
  },
  INSTALL_FAILED: {
    CHECK_START: 'CHECKING',
    RESET: 'IDLE',
  },
  BOOT_FAILED: {
    ROLLBACK_START: 'ROLLBACK',
  },
  ROLLBACK: {
    ROLLBACK_COMPLETE: 'STABLE',
    RESET: 'IDLE',
  },
};

export type StateChangeListener = (state: UpdateState, prev: UpdateState) => void;

export class UpdateStateMachine {
  private state: UpdateState;
  private readonly listeners = new Set<StateChangeListener>();

  constructor(initial: UpdateState = 'IDLE') {
    this.state = initial;
  }

  getState(): UpdateState {
    return this.state;
  }

  /** 执行一次转移；非法转移会被忽略并返回 false。 */
  transition(trigger: UpdateTrigger): boolean {
    const next = TRANSITIONS[this.state]?.[trigger];
    if (!next) {
      return false;
    }
    const prev = this.state;
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener(next, prev);
      } catch {
        // 单个 listener 异常不影响状态机
      }
    }
    return true;
  }

  /** 订阅状态变化，返回取消订阅函数。 */
  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 判断当前状态是否为失败态。 */
  isFailed(): boolean {
    return [
      'DOWNLOAD_FAILED',
      'VERIFY_FAILED',
      'INSTALL_FAILED',
      'BOOT_FAILED',
      'ROLLBACK',
      'INCOMPATIBLE',
    ].includes(this.state);
  }

  /** 判断当前状态是否为终态（STABLE / NO_UPDATE / 失败态）。 */
  isTerminal(): boolean {
    return this.state === 'STABLE' || this.state === 'NO_UPDATE' || this.isFailed();
  }

  /** 判断是否正在更新中（非终态、非 IDLE）。 */
  isUpdating(): boolean {
    return !this.isTerminal() && this.state !== 'IDLE';
  }
}
