/**
 * P2-3：设备完整性（root/jailbreak）与 TLS 证书锁定策略单元测试。
 */
import { NativeModules } from 'react-native';
import {
  getDeviceIntegrity,
  getDeviceIntegrityAsync,
  isCompromised,
  requiresStepUp,
  resetDeviceIntegrityCache,
} from '../../src/security/device-integrity';
import { validatePinning, pinMatches, getConfiguredPins } from '../../src/security/ssl-pinning';

const nativeCaps = NativeModules as unknown as Record<string, unknown>;

describe('P2-3 设备完整性', () => {
  beforeEach(() => resetDeviceIntegrityCache());

  test('原生未实现 → 降级 unknown（不阻断）', () => {
    nativeCaps.ERPCapabilities = undefined;
    expect(getDeviceIntegrity()).toBe('unknown');
  });

  test('原生返回 compromised → 判定已攻破', () => {
    nativeCaps.ERPCapabilities = { getDeviceIntegrity: () => 'compromised' };
    expect(getDeviceIntegrity()).toBe('compromised');
    expect(isCompromised('compromised')).toBe(true);
  });

  test('原生返回布尔 true → 归一为 compromised', () => {
    nativeCaps.ERPCapabilities = { getDeviceIntegrity: () => true };
    expect(getDeviceIntegrity()).toBe('compromised');
  });

  test('原生返回 Promise → 异步版本可用', async () => {
    nativeCaps.ERPCapabilities = { getDeviceIntegrity: () => Promise.resolve('secure') };
    const res = await getDeviceIntegrityAsync();
    expect(res).toBe('secure');
  });

  test('requiresStepUp：enforce + compromised 才需要二次确认', () => {
    expect(requiresStepUp('compromised', true)).toBe(true);
    expect(requiresStepUp('compromised', false)).toBe(false);
    expect(requiresStepUp('unknown', true)).toBe(false);
    expect(requiresStepUp('secure', true)).toBe(false);
  });
});

describe('P2-3 TLS 证书锁定', () => {
  test('未配置 pin（观察模式）→ 不误拦', () => {
    expect(validatePinning([], ['leaf-hash-x'])).toBe(true);
    expect(getConfiguredPins()).toEqual([]);
  });

  test('命中 pin → 通过', () => {
    expect(validatePinning(['pinA', 'pinB'], ['pinB'])).toBe(true);
    expect(pinMatches(['pinA'], 'pinA')).toBe(true);
  });

  test('未命中 pin → 拒绝', () => {
    expect(validatePinning(['pinA'], ['pinX'])).toBe(false);
    expect(pinMatches(['pinA'], 'pinX')).toBe(false);
  });
});
