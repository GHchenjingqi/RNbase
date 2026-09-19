/**
 * dialog 桥接模块：原生弹窗（Alert）与操作表（ActionSheet）。
 *
 * 纯 RN 实现：Alert.alert / ActionSheetIOS。
 */
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import type { BridgeServer } from '../bridge-server';
import { BridgeException } from '../bridge-error';

export function registerDialogModule(server: BridgeServer): void {
  server.registerModule('dialog', {
    /**
     * 原生 Alert 弹窗。
     * H5 调用：RN.DIALOG.ALERT({ title, message, buttons: [{text, style}] })
     * 返回 { buttonIndex: number }，-1 表示取消。
     */
    alert(params) {
      const p = params as
        | {
            title?: string;
            message?: string;
            buttons?: {
              text: string;
              style?: 'default' | 'cancel' | 'destructive';
            }[];
            cancelable?: boolean;
          }
        | undefined;
      return new Promise<{ buttonIndex: number }>(resolve => {
        const buttons = (p?.buttons ?? [{ text: '确定' }]).map((b, i) => ({
          text: b.text,
          style: b.style,
          onPress: () => resolve({ buttonIndex: i }),
        }));
        Alert.alert(p?.title ?? '', p?.message, buttons, {
          cancelable: p?.cancelable ?? true,
          onDismiss: () => resolve({ buttonIndex: -1 }),
        });
      });
    },

    /**
     * 操作表（ActionSheet）。
     * H5 调用：RN.DIALOG.ACTIONSHEET({ title, message, options: [], destructiveButtonIndex, cancelButtonIndex })
     * 返回 { buttonIndex: number }。
     */
    actionSheet(params) {
      const p = params as
        | {
            title?: string;
            message?: string;
            options: string[];
            destructiveButtonIndex?: number;
            cancelButtonIndex?: number;
          }
        | undefined;
      if (!p?.options || !Array.isArray(p.options) || p.options.length === 0) {
        throw new BridgeException('INVALID_PARAMS', 'options 不能为空');
      }
      if (Platform.OS === 'ios') {
        return new Promise<{ buttonIndex: number }>(resolve => {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              title: p.title,
              message: p.message,
              options: p.options,
              destructiveButtonIndex: p.destructiveButtonIndex,
              cancelButtonIndex: p.cancelButtonIndex ?? p.options.length - 1,
            },
            buttonIndex => resolve({ buttonIndex }),
          );
        });
      }
      // Android 降级为 Alert
      return new Promise<{ buttonIndex: number }>(resolve => {
        const buttons = p.options.map((text, i) => ({
          text,
          onPress: () => resolve({ buttonIndex: i }),
        }));
        Alert.alert(p?.title ?? '', p?.message, buttons, {
          cancelable: true,
          onDismiss: () => resolve({ buttonIndex: p.cancelButtonIndex ?? -1 }),
        });
      });
    },
  });
}
