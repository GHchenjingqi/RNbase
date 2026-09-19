/**
 * Bridge 聚合入口：创建已注册 app / permission / 能力模块的 BridgeServer。
 *
 * 未来扩展更多模块时，仅需在此注册，H5 侧协议保持不变（规则 10）。
 * 能力模块通过 adapters 注入，未接入时返回 DEVICE_UNSUPPORTED（规则 13/16）。
 */
import { BridgeServer } from './bridge-server';
import type { BridgeCallHandler } from './protocol';
import { registerAppModule } from './modules/app';
import { registerPermissionModule } from './modules/permission';
import { registerAuthModule } from './modules/auth';
import { registerSystemModule } from './modules/system';
import { registerNotificationModule } from './modules/notification';
import { registerLogModule } from './modules/log';
import { PermissionManager } from '../permissions/permission-manager';
import { registerScannerModule } from './modules/capabilities/scanner';
import { registerCameraModule } from './modules/capabilities/camera';
import { registerMediaModule } from './modules/capabilities/media';
import { registerFileModule } from './modules/capabilities/file';
import { registerLocationModule } from './modules/capabilities/location';
import { registerClipboardModule } from './modules/capabilities/clipboard';
import { registerBrightnessModule } from './modules/capabilities/brightness';
import { registerFlashlightModule } from './modules/capabilities/flashlight';
import { registerSensorModule } from './modules/capabilities/sensor';
import { registerBiometricModule } from './modules/capabilities/biometric';
import { registerContactsModule } from './modules/capabilities/contacts';
import { registerCalendarModule } from './modules/capabilities/calendar';
import { registerNfcModule } from './modules/capabilities/nfc';
import { registerBluetoothModule } from './modules/capabilities/bluetooth';
import { registerAudioModule } from './modules/capabilities/audio';
import { registerStorageModule } from './modules/capabilities/storage';
import { registerNetworkInfoModule } from './modules/capabilities/network-info';
import { registerQrModule } from './modules/capabilities/qr';
import { registerImageModule } from './modules/capabilities/image';
import { registerHapticsModule } from './modules/capabilities/haptics';
import { registerSpeechModule } from './modules/capabilities/speech';
import { registerAppManagerModule } from './modules/capabilities/app-manager';
import { registerBackgroundTaskModule } from './modules/capabilities/background-task';
import { registerInAppReviewModule } from './modules/capabilities/in-app-review';
import { registerToastModule } from './modules/toast';
import { registerDialogModule } from './modules/dialog';
import { registerOrientationModule } from './modules/orientation';
import { registerStatusBarModule } from './modules/statusbar';
import { registerKeyboardModule } from './modules/keyboard';
import { registerNavigationModule } from './modules/navigation';
import { registerWebViewControlModule } from './modules/webview-control';
import { registerDeviceModule } from './modules/device';
import { registerBatteryModule } from './modules/battery';
import type { CapabilityAdapters } from './modules/capabilities/types';
import type { LifecycleHandlers } from './modules/app';
import type { NetworkAdapter } from '../middleware/network/types';
import { resolveNativeCapabilityAdapters } from '../middleware/native/capability-native-adapters';
import { resolveNativeNetworkAdapter } from '../middleware/network/native-network-adapter';
import { resolveNativeSystemAdapter } from '../middleware/native/system-native-adapter';
import { registerNetworkModule } from '../middleware/network/network-module';
import { logger } from '../diagnostics/logger';

export function createBridgeServer(
  manager: PermissionManager = new PermissionManager(),
  capabilities: CapabilityAdapters = {},
  lifecycle: LifecycleHandlers = {},
  networkAdapter?: NetworkAdapter | undefined,
  options?: { onCall?: BridgeCallHandler },
): BridgeServer {
  // 原生适配器为默认能力来源，传入的 capabilities 可覆盖（规则 13：适配现有工程）。
  const merged: CapabilityAdapters = {
    ...resolveNativeCapabilityAdapters(),
    ...capabilities,
  };
  const server = new BridgeServer({
    onEvent: e => {
      if (!e.success) {
        logger.log({
          event: 'bridge_error',
          requestId: e.requestId,
          module: e.module,
          action: e.action,
          errorCode: e.errorCode,
          durationMs: e.durationMs,
        });
      }
    },
    onCall: options?.onCall,
  });

  // ── 基础模块 ──
  registerAppModule(server, lifecycle);
  registerPermissionModule(server, manager);
  registerAuthModule(server);
  registerSystemModule(server, resolveNativeSystemAdapter());
  registerNotificationModule(server, {
    getToken: merged.notification?.getToken,
    setBadge: merged.notification?.setBadge,
    playSound: merged.notification?.playSound,
    sendNotification: merged.notification?.sendNotification,
  });
  registerLogModule(server);
  registerNetworkModule(server, networkAdapter ?? resolveNativeNetworkAdapter());

  // ── 设备能力模块（需原生适配器） ──
  registerScannerModule(server, merged);
  registerCameraModule(server, merged);
  registerMediaModule(server, merged);
  registerFileModule(server, merged);
  registerLocationModule(server, merged);
  registerClipboardModule(server, merged);
  registerBrightnessModule(server, merged);
  registerFlashlightModule(server, merged);
  registerSensorModule(server, merged);
  registerBiometricModule(server, merged);
  registerContactsModule(server, merged);
  registerCalendarModule(server, merged);
  registerNfcModule(server, merged);
  registerBluetoothModule(server, merged);
  registerAudioModule(server, merged);
  registerStorageModule(server, merged);
  registerNetworkInfoModule(server, merged);
  registerQrModule(server, merged);
  registerImageModule(server, merged);
  registerHapticsModule(server, merged);
  registerSpeechModule(server, merged);
  registerAppManagerModule(server, merged);
  registerBackgroundTaskModule(server, merged);
  registerInAppReviewModule(server, merged);

  // ── 纯 RN 模块 ──
  registerToastModule(server);
  registerDialogModule(server);
  registerOrientationModule(server);
  registerStatusBarModule(server);
  registerKeyboardModule(server);
  registerNavigationModule(server);
  registerWebViewControlModule(server);
  registerDeviceModule(server);
  registerBatteryModule(server);

  return server;
}

export { BridgeServer } from './bridge-server';
export * from './protocol';
export { BridgeException, createBridgeError } from './bridge-error';
export * from './version';
export * from './schema';
export { BridgeEventBus, bridgeEventBus } from './event-bus';
export type { BridgeEventHandler } from './event-bus';
