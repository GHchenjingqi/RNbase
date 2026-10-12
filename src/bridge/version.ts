/**
 * Bridge 版本管理与兼容性比较（对应 Phase 3 / 规范 §6/§17）。
 *
 * 版本号遵循 semver 语义：major.minor.patch
 *  - major 不兼容：必须返回 BRIDGE_VERSION_NOT_SUPPORTED
 *  - minor 向下兼容：新 H5 可在旧 Bridge 上运行，但新能力不可用
 *  - patch 完全兼容
 */
import { BRIDGE_VERSION, BRIDGE_PROTOCOL_VERSION } from '../config';

export const CURRENT_BRIDGE_VERSION = BRIDGE_VERSION;

/**
 * 解析版本号字符串为数值元组。
 * @param version 如 "1.2.0"，也支持 "v1.2.3"、"1.2.3-beta"、"1.2"、"1" 等缺省格式
 * @returns [major, minor, patch]，解析失败返回 [0, 0, 0]
 */
export function parseVersion(version: string): [number, number, number] {
  // 支持 "1.2.3"、"v1.2.3"、"1.2.3-beta"、"1.2"、"1" 等格式，缺失的 minor/patch 补 0
  const match = String(version ?? '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return [0, 0, 0];
  return [parseInt(match[1], 10), parseInt(match[2] || '0', 10), parseInt(match[3] || '0', 10)];
}

/**
 * 比较两个版本号。
 * @returns -1 (a < b), 0 (a == b), 1 (a > b)
 */
export function compareVersion(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPat] = parseVersion(a);
  const [bMaj, bMin, bPat] = parseVersion(b);
  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
  if (aMin !== bMin) return aMin > bMin ? 1 : -1;
  if (aPat !== bPat) return aPat > bPat ? 1 : -1;
  return 0;
}

/**
 * 判断当前 Bridge 是否满足 H5 要求的最低版本。
 *
 * 兼容性规则（规范 §17）：
 *  - major 必须一致（不兼容升级需发新版 App）
 *  - 当前 minor >= 要求 minor
 *  - patch 不影响兼容性
 *
 * @param h5MinBridge H5 manifest 中声明的 minBridgeVersion
 * @param currentBridge 当前 App 的 Bridge 版本，默认使用配置
 */
export function isCompatible(
  h5MinBridge: string,
  currentBridge: string = CURRENT_BRIDGE_VERSION,
): boolean {
  const [hMaj] = parseVersion(h5MinBridge);
  const [cMaj, cMin] = parseVersion(currentBridge);
  const [, hMin] = parseVersion(h5MinBridge);

  // major 不一致直接不兼容
  if (hMaj !== cMaj) return false;
  // 当前 minor 必须 >= 要求 minor
  return cMin >= hMin;
}

/**
 * 获取版本信息对象，用于 app.getInfo / handshake。
 */
export function getVersionInfo() {
  return {
    bridgeVersion: CURRENT_BRIDGE_VERSION,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    parsed: parseVersion(CURRENT_BRIDGE_VERSION),
  };
}
