/**
 * 网络状态类型（规则 46：H5 通过 Native.network.getStatus 获取网络状态）。
 */
export type NetworkType = 'wifi' | 'cellular' | 'none' | 'unknown';

export type NetworkStatus = {
  connected: boolean;
  type: NetworkType;
};

export interface NetworkAdapter {
  getStatus(): Promise<NetworkStatus>;
}
