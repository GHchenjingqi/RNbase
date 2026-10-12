/**
 * 更新检查器（Phase 7 / 规范 §6.2、§17、§30）。
 *
 * 职责：
 *  - 版本比较（semver 风格，支持 2026.08.31.001 这种日期版本）
 *  - minAppVersion / maxAppVersion / bridgeVersion 兼容性判定
 *  - 灰度识别（percentage / tenant / userId / deviceId / appVersion / platform）
 *
 * 纯逻辑、无 IO、可单测。
 */
import type { H5Manifest } from './types';

export type UpdateCheckContext = {
  currentH5Version: string | null;
  appVersion: string;
  bridgeVersion: string;
  platform: 'android' | 'ios' | 'web';
  /** 灰度判定所需的设备/用户信息 */
  deviceId?: string;
  userId?: string;
  tenantId?: string;
};

export type UpdateCheckResult =
  | { available: true; manifest: H5Manifest; reason: 'update_available' }
  | {
      available: false;
      reason:
        | 'already_latest'
        | 'app_version_too_low'
        | 'app_version_too_high'
        | 'bridge_incompatible'
        | 'not_in_rollout'
        | 'version_lower';
    };

export type RolloutRule = {
  /** 灰度百分比 0-100 */
  percentage?: number;
  /** 指定租户列表 */
  tenants?: string[];
  /** 指定用户列表 */
  users?: string[];
  /** 指定设备列表 */
  devices?: string[];
  /** 指定 appVersion 范围（min/max） */
  appVersionMin?: string;
  appVersionMax?: string;
  /** 指定平台 */
  platforms?: Array<'android' | 'ios' | 'web'>;
};

/** 比较两个版本号，a>b 返回 1，a=b 返回 0，a<b 返回 -1。 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

/** 检查 app 版本是否在 manifest 要求的范围内。 */
export function checkAppVersionCompatibility(
  manifest: H5Manifest,
  appVersion: string,
): 'ok' | 'too_low' | 'too_high' {
  if (manifest.minAppVersion && compareVersion(appVersion, manifest.minAppVersion) < 0) {
    return 'too_low';
  }
  if (manifest.maxAppVersion && compareVersion(appVersion, manifest.maxAppVersion) > 0) {
    return 'too_high';
  }
  return 'ok';
}

/** 检查 Bridge 版本是否兼容（major 一致，current minor >= required）。 */
export function checkBridgeCompatibility(manifest: H5Manifest, bridgeVersion: string): boolean {
  if (!manifest.bridgeVersion) return true;
  const [cMajor, cMinor] = parseVersion(bridgeVersion);
  const [rMajor, rMinor] = parseVersion(manifest.bridgeVersion);
  return cMajor === rMajor && cMinor >= rMinor;
}

function parseVersion(v: string): [number, number, number] {
  const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * 灰度判定（规范 §30）。
 * 基于 deviceId / userId 的稳定哈希，确保同一设备结果不抖动。
 */
export function checkRollout(rule: RolloutRule | undefined, ctx: UpdateCheckContext): boolean {
  if (!rule) return true; // 无灰度规则 = 全量

  // 平台过滤
  if (rule.platforms && !rule.platforms.includes(ctx.platform)) {
    return false;
  }

  // appVersion 范围过滤
  if (rule.appVersionMin && compareVersion(ctx.appVersion, rule.appVersionMin) < 0) {
    return false;
  }
  if (rule.appVersionMax && compareVersion(ctx.appVersion, rule.appVersionMax) > 0) {
    return false;
  }

  // 白名单：指定租户/用户/设备直接命中
  if (rule.tenants && ctx.tenantId && rule.tenants.includes(ctx.tenantId)) {
    return true;
  }
  if (rule.users && ctx.userId && rule.users.includes(ctx.userId)) {
    return true;
  }
  if (rule.devices && ctx.deviceId && rule.devices.includes(ctx.deviceId)) {
    return true;
  }

  // 百分比灰度：基于稳定哈希
  if (rule.percentage !== undefined && rule.percentage > 0) {
    const seed = ctx.deviceId ?? ctx.userId ?? ctx.tenantId ?? 'default';
    const hash = stableHash(seed);
    const bucket = hash % 100;
    return bucket < rule.percentage;
  }

  // 有白名单但当前用户不在白名单，且无百分比 → 不命中
  if (rule.tenants || rule.users || rule.devices) {
    return false;
  }

  return true;
}

/** 稳定字符串哈希（djb2），用于灰度分桶。 */
function stableHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    /* eslint-disable no-bitwise */
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    /* eslint-enable no-bitwise */
  }
  return Math.abs(hash);
}

/**
 * 执行完整的更新检查。
 * 流程：版本比较 → app 兼容性 → bridge 兼容性 → 灰度判定
 */
export function checkForUpdate(
  manifest: H5Manifest,
  ctx: UpdateCheckContext,
  rollout?: RolloutRule,
): UpdateCheckResult {
  // 版本比较
  if (ctx.currentH5Version) {
    const cmp = compareVersion(manifest.version, ctx.currentH5Version);
    if (cmp <= 0) {
      return {
        available: false,
        reason: cmp === 0 ? 'already_latest' : 'version_lower',
      };
    }
  }

  // app 版本兼容性
  const appCompat = checkAppVersionCompatibility(manifest, ctx.appVersion);
  if (appCompat === 'too_low') {
    return { available: false, reason: 'app_version_too_low' };
  }
  if (appCompat === 'too_high') {
    return { available: false, reason: 'app_version_too_high' };
  }

  // bridge 兼容性
  if (!checkBridgeCompatibility(manifest, ctx.bridgeVersion)) {
    return { available: false, reason: 'bridge_incompatible' };
  }

  // 灰度判定
  if (!checkRollout(rollout, ctx)) {
    return { available: false, reason: 'not_in_rollout' };
  }

  return { available: true, manifest, reason: 'update_available' };
}
