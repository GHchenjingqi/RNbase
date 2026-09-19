/**
 * keyboard 桥接模块：键盘管理（显示/隐藏/高度查询/事件监听）。
 *
 * 纯 RN 实现：Keyboard API。
 */
import { Keyboard, Platform } from 'react-native';
import type { BridgeServer } from '../bridge-server';
import { bridgeEventBus } from '../event-bus';

let keyboardListenerInstalled = false;
let currentKeyboardHeight = 0;

function installKeyboardListeners(): void {
  if (keyboardListenerInstalled) return;
  keyboardListenerInstalled = true;

  const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

  Keyboard.addListener(showEvent as 'keyboardDidShow', e => {
    currentKeyboardHeight = e.endCoordinates.height;
    bridgeEventBus.emit('keyboard.didShow', { height: currentKeyboardHeight });
  });
  Keyboard.addListener(hideEvent as 'keyboardDidHide', () => {
    currentKeyboardHeight = 0;
    bridgeEventBus.emit('keyboard.didHide', { height: 0 });
  });
}

export function registerKeyboardModule(server: BridgeServer): void {
  installKeyboardListeners();

  server.registerModule('keyboard', {
    /** 隐藏键盘。 */
    dismiss() {
      Keyboard.dismiss();
      return { ok: true };
    },

    /** 获取当前键盘高度（0 表示未弹出）。 */
    getHeight() {
      return { height: currentKeyboardHeight };
    },

    /** 查询键盘是否可见。 */
    isVisible() {
      return { visible: currentKeyboardHeight > 0 };
    },
  });
}
