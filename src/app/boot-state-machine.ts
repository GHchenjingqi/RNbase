/**
 * App 启动状态机（规则 34）：从 BOOT 到 RUNNING，异常走 ERROR_RECOVERY。
 *
 * 纯逻辑、可单测；与具体 UI / WebView 解耦。
 */
export type BootState =
  | 'BOOT'
  | 'CHECK_LOCAL'
  | 'CHECK_UPDATE'
  | 'PREPARE_H5'
  | 'LOAD_WEBVIEW'
  | 'BRIDGE_HANDSHAKE'
  | 'H5_READY'
  | 'RUNNING'
  | 'ERROR_RECOVERY';

export type BootTrigger =
  | 'LOCAL_READY'
  | 'UPDATE_CHECKED'
  | 'H5_PREPARED'
  | 'WEBVIEW_LOADED'
  | 'HANDSHAKE_START'
  | 'H5_READY'
  | 'RUNNING'
  | 'ERROR';

const TRANSITIONS: Record<BootState, Partial<Record<BootTrigger, BootState>>> = {
  BOOT: { LOCAL_READY: 'CHECK_LOCAL' },
  CHECK_LOCAL: { UPDATE_CHECKED: 'CHECK_UPDATE', ERROR: 'ERROR_RECOVERY' },
  CHECK_UPDATE: { H5_PREPARED: 'PREPARE_H5', ERROR: 'ERROR_RECOVERY' },
  PREPARE_H5: { WEBVIEW_LOADED: 'LOAD_WEBVIEW', ERROR: 'ERROR_RECOVERY' },
  LOAD_WEBVIEW: {
    HANDSHAKE_START: 'BRIDGE_HANDSHAKE',
    ERROR: 'ERROR_RECOVERY',
  },
  BRIDGE_HANDSHAKE: { H5_READY: 'H5_READY', ERROR: 'ERROR_RECOVERY' },
  H5_READY: { RUNNING: 'RUNNING' },
  RUNNING: {},
  ERROR_RECOVERY: { WEBVIEW_LOADED: 'LOAD_WEBVIEW' },
};

export class BootStateMachine {
  private state: BootState;

  constructor(initial: BootState = 'BOOT') {
    this.state = initial;
  }

  getState(): BootState {
    return this.state;
  }

  /** 执行一次转移；非法转移会被忽略并返回 false。 */
  transition(trigger: BootTrigger): boolean {
    const next = TRANSITIONS[this.state]?.[trigger];
    if (!next) {
      return false;
    }
    this.state = next;
    return true;
  }
}
