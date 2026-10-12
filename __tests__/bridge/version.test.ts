/**
 * Phase 3：Bridge 版本兼容性单元测试（规范 §6/§17）。
 */
import { compareVersion, isCompatible, parseVersion } from '../../src/bridge/version';

describe('parseVersion', () => {
  test('正常版本号解析', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  test('带前缀的版本号', () => {
    expect(parseVersion('v2.0.1-beta')).toEqual([2, 0, 1]);
  });

  test('缺省 minor/patch 的版本号补 0', () => {
    expect(parseVersion('1.0')).toEqual([1, 0, 0]);
    expect(parseVersion('1')).toEqual([1, 0, 0]);
  });

  test('无效版本号返回 [0,0,0]', () => {
    expect(parseVersion('invalid')).toEqual([0, 0, 0]);
    expect(parseVersion('')).toEqual([0, 0, 0]);
  });
});

describe('compareVersion', () => {
  test('a > b 返回 1', () => {
    expect(compareVersion('2.0.0', '1.0.0')).toBe(1);
    expect(compareVersion('1.2.0', '1.1.0')).toBe(1);
    expect(compareVersion('1.0.2', '1.0.1')).toBe(1);
  });

  test('a < b 返回 -1', () => {
    expect(compareVersion('1.0.0', '2.0.0')).toBe(-1);
  });

  test('a == b 返回 0', () => {
    expect(compareVersion('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('isCompatible', () => {
  test('major 一致且 current minor >= required -> true', () => {
    expect(isCompatible('1.0.0', '1.2.0')).toBe(true);
    expect(isCompatible('1.2.0', '1.2.0')).toBe(true);
    expect(isCompatible('1.1.0', '1.5.0')).toBe(true);
  });

  test('major 一致但 current minor < required -> false', () => {
    expect(isCompatible('1.3.0', '1.2.0')).toBe(false);
  });

  test('major 不一致 -> false', () => {
    expect(isCompatible('2.0.0', '1.0.0')).toBe(false);
    expect(isCompatible('1.0.0', '2.0.0')).toBe(false);
  });

  test('patch 不影响兼容性', () => {
    expect(isCompatible('1.0.0', '1.0.99')).toBe(true);
  });
});
