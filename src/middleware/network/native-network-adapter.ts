/**
 * 原生网络适配器（RN 侧，规则 13/51）：对接 NativeModules.ERPNetwork。
 *
 * 原生未链接时返回 undefined，模块降级为 DEVICE_UNSUPPORTED（规则 13/16）。
 * 延迟读取 NativeModules，便于测试注入 mock。
 */
import { NativeModules } from 'react-native';
import type { NetworkAdapter, NetworkStatus } from './types';

export interface ERPNetworkNative {
  getStatus(): Promise<NetworkStatus>;
}

/** 解析原生网络适配器；原生模块缺失时返回 undefined（按需降级）。 */
export function resolveNativeNetworkAdapter(): NetworkAdapter | undefined {
  const nativeModule = (NativeModules as Record<string, unknown>).ERPNetwork as
    | ERPNetworkNative
    | undefined;
  if (!nativeModule) {
    return undefined;
  }
  return {
    getStatus: () => nativeModule.getStatus(),
  };
}
