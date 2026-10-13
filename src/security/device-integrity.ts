/**
 * 设备完整性（root / jailbreak 检测，P2 安全闭环）。
 *
 * 真实检测依赖原生能力：
 *  - Android：集成 RootBeer / 读 `Build.TAGS`、su 二进制探测等（BaseCapabilities.getDeviceIntegrity）
 *  - iOS：jailbreak 探针（文件存在性 / 越狱沙盒 / 私有 API 可用性）
 *  - 鸿蒙：系统完整性校验接口
 *
 * 基座只定义「JS 侧策略 + 守卫桥接」：原生未实现该方法时一律返回 'unknown'（不误判、不阻断），
 * 上层据此决定是否对高风险 Bridge 操作做二次确认（step-up）。
 * 真实检测逻辑由原生模块补，详见 docs/提升方案建议.md §P2 原生接入。
 */
import { NativeModules } from 'react-native';

/** 设备完整性结论。 */
export type DeviceIntegrity = 'secure' | 'compromised' | 'unknown';

type NativeIntegrityResult = 'secure' | 'compromised' | 'unknown' | boolean | undefined;

/**
 * 是否对「疑似被攻破」设备强制 step-up（高风险操作二次确认）。
 * - true（enforce）：compromised 时高风险操作必须二次确认；
 * - false（observe，默认）：仅记录，不强制（灰度观察期，避免误伤正常用户）。
 */
export const DEVICE_INTEGRITY_ENFORCE: boolean =
  (globalThis as unknown as { __APP_CONFIG__?: { deviceIntegrityEnforce?: boolean } })
    .__APP_CONFIG__?.deviceIntegrityEnforce ?? false;

function getNativeIntegrity(): NativeIntegrityResult | Promise<NativeIntegrityResult> {
  const caps = (NativeModules as Record<string, unknown>).BaseCapabilities as
    | { getDeviceIntegrity?: () => NativeIntegrityResult | Promise<NativeIntegrityResult> }
    | undefined;
  if (caps && typeof caps.getDeviceIntegrity === 'function') {
    return caps.getDeviceIntegrity();
  }
  return undefined;
}

/** Promise 类型守卫（避免 instanceof 在原始值联合类型上报错）。 */
function isPromiseLike(v: unknown): v is Promise<unknown> {
  return (
    typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'
  );
}

let cachedIntegrity: DeviceIntegrity | null = null;

/**
 * 获取设备完整性（同步优先，原生若返回 Promise 则由调用方 await 版本）。
 * 原生不可用 → 'unknown'（不阻断）。
 */
export function getDeviceIntegrity(): DeviceIntegrity {
  if (cachedIntegrity) {
    return cachedIntegrity;
  }
  const raw = getNativeIntegrity();
  // 同步路径无法 await；原生若返回 Promise，交由 getDeviceIntegrityAsync 解析，此处保守判 unknown。
  cachedIntegrity = isPromiseLike(raw) ? 'unknown' : normalizeIntegrity(raw);
  return cachedIntegrity;
}

/** 异步版本：覆盖原生返回 Promise 的场景。 */
export async function getDeviceIntegrityAsync(): Promise<DeviceIntegrity> {
  const raw = getNativeIntegrity();
  const resolved = isPromiseLike(raw) ? await raw : raw;
  cachedIntegrity = normalizeIntegrity(resolved);
  return cachedIntegrity;
}

/** 仅供测试重置缓存。 */
export function resetDeviceIntegrityCache(): void {
  cachedIntegrity = null;
}

function normalizeIntegrity(raw: NativeIntegrityResult): DeviceIntegrity {
  if (raw === 'secure' || raw === 'compromised' || raw === 'unknown') {
    return raw;
  }
  if (typeof raw === 'boolean') {
    return raw ? 'compromised' : 'secure';
  }
  return 'unknown';
}

/** 设备是否被判定为已攻破。 */
export function isCompromised(integrity: DeviceIntegrity): boolean {
  return integrity === 'compromised';
}

/**
 * 当前完整性结论下，高风险操作是否需要 step-up 二次确认。
 * - 结论 compromised 且处于 enforce 模式 → 需要；
 * - 其余（unknown / secure / observe 模式）→ 不需要。
 */
export function requiresStepUp(
  integrity: DeviceIntegrity,
  enforce: boolean = DEVICE_INTEGRITY_ENFORCE
): boolean {
  return integrity === 'compromised' && enforce;
}
