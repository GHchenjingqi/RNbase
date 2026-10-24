/**
 * App 级 Bridge 组装（规则 10/13）：汇聚权限管理、各原生能力 adapter 与生命周期回调。
 *
 * 真实项目在此注入 scanner/camera/media/file/location 的原生实现；
 * 未注入时对应模块返回 DEVICE_UNSUPPORTED（规则 13/16）。
 */
import { createBridgeServer } from '../bridge';
import type { BridgeCallHandler } from '../bridge/protocol';
import { PermissionManager } from '../permissions/permission-manager';
import type { CapabilityAdapters } from '../bridge/modules/capabilities/types';
import type { LifecycleHandlers } from '../bridge/modules/app';
import type { NetworkAdapter } from '../middleware/network/types';

export type BridgeServerOptions = {
  /** 每次 Bridge 调用后的观测钩子（设备调用日志）。 */
  onCall?: BridgeCallHandler;
  /** Bridge 消息来源谓词（规范 §25）；由 WebViewBridge 用当前页与入口 URL 组出来。 */
  isTrustedOrigin?: (origin?: string) => boolean;
};

export function createAppBridgeServer(
  capabilities: CapabilityAdapters = {},
  lifecycle: LifecycleHandlers = {},
  network?: NetworkAdapter,
  options: BridgeServerOptions = {}
): ReturnType<typeof createBridgeServer> {
  return createBridgeServer(new PermissionManager(), capabilities, lifecycle, network, {
    onCall: options.onCall,
    isTrustedOrigin: options.isTrustedOrigin,
  });
}
