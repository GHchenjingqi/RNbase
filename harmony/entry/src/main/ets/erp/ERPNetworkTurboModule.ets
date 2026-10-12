/**
 * 鸿蒙侧 ERPNetwork TurboModule：`getStatus` 与 Android `ERPNetworkModule.kt` 同形状
 * （`{ connected, type }`，type ∈ wifi|cellular|wired|none|unknown）。
 *
 * Android 靠 ConnectivityManager 回调缓存状态；这里每次调用现查（H5 只在需要时问一次，
 * 且 `connection` 的同步 API 很轻），所以不需要注册监听。
 * 同步查询要 `ohos.permission.GET_NETWORK_INFO`（system_grant，声明即可）。
 */
import connection from '@ohos.net.connection';
import { UITurboModule } from '@rnoh/react-native-openharmony';

export interface ERPNetworkStatus {
  connected: boolean;
  type: string;
}

export class ERPNetworkTurboModule extends UITurboModule {
  public static readonly NAME: string = 'ERPNetwork';

  async getStatus(): Promise<ERPNetworkStatus> {
    const status: ERPNetworkStatus = { connected: false, type: 'unknown' };
    try {
      const netHandle: connection.NetHandle = connection.getDefaultNetSync();
      const caps: connection.NetCapabilities = connection.getNetCapabilitiesSync(netHandle);
      const bearers: Array<connection.NetBearType> = caps.bearerTypes;
      if (bearers.indexOf(connection.NetBearType.BEARER_WIFI) >= 0) {
        status.type = 'wifi';
        status.connected = true;
      } else if (bearers.indexOf(connection.NetBearType.BEARER_CELLULAR) >= 0) {
        status.type = 'cellular';
        status.connected = true;
      } else if (bearers.indexOf(connection.NetBearType.BEARER_ETHERNET) >= 0) {
        status.type = 'wired';
        status.connected = true;
      } else if (bearers.length > 0) {
        status.connected = true;
      }
    } catch (error) {
      status.type = 'none';
      this.ctx.logger.error(`[ERPNetwork] 网络状态查询失败: ${error}`);
    }
    return status;
  }
}
