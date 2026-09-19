/**
 * network 聚合入口（规则 46）。
 */
export type { NetworkStatus, NetworkType, NetworkAdapter } from './types';
export { resolveNativeNetworkAdapter } from './native-network-adapter';
export { registerNetworkModule } from './network-module';
