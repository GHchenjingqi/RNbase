/**
 * Phase 2：导航白名单决策单元测试（规范 §24）。
 *
 * 离线包路径里的包名一律从 config 取（APP_PACKAGE），不写死：decideNavigation 的
 * h5-versions 前缀本身就是按 version.json 的 applicationId 拼的，CI 用中性
 * version.json（com.qux.base），写死某个具体包名的用例只在他本机绿。
 */
import { decideNavigation, normalizeOrigin, shouldStartLoad } from '../../src/webview/navigation';
import { APP_PACKAGE } from '../../src/config';

/**
 * origin 归一化的契约（真机踩过的坑）：
 * Hermes/RN 的 URL 允许相对解析，`new URL('null')` 不抛，返回 protocol='' 的半成品，
 * 拼成 "//" 是个真值 —— 而安卓 WebMessageListener 对 file:// 页给的 sourceOrigin
 * 正是字面量 "null"（雷电 Android 9 实测），于是本地模式的 Bridge 调用全被拒。
 * 这里钉住「没有 scheme 就不是 origin」，jest 用 Node 的 URL（会抛）也测得出同一契约。
 */
describe('normalizeOrigin', () => {
  it('没有 scheme 的串一律 null（含安卓本地页给的 "null"）', () => {
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('   ')).toBeNull();
    expect(normalizeOrigin('//evil.com')).toBeNull();
    expect(normalizeOrigin('evil.com/path')).toBeNull();
  });

  it('带 scheme 的取 scheme://host，丢掉 path/query/尾斜杠', () => {
    expect(normalizeOrigin('https://h5.demo.test/app/?x=1')).toBe('https://h5.demo.test');
    expect(normalizeOrigin('http://10.0.2.2:5173')).toBe('http://10.0.2.2:5173');
    expect(normalizeOrigin('file:///android_asset/index.html')).toBe('file://');
  });
});

const WHITELIST = ['https://mobile-base.example.com'];

describe('decideNavigation', () => {
  test('白名单内 https 域名 -> allow', () => {
    const result = decideNavigation('https://mobile-base.example.com/index.html', WHITELIST);
    expect(result.action).toBe('allow');
    expect(result.reason).toBe('trusted_origin');
  });

  test('白名单内 http 域名 -> allow', () => {
    const wl = ['http://localhost:8082'];
    const result = decideNavigation('http://localhost:8082/index.html', wl);
    expect(result.action).toBe('allow');
  });

  test('白名单外 https 域名 -> open-external', () => {
    const result = decideNavigation('https://www.baidu.com', WHITELIST);
    expect(result.action).toBe('open-external');
    expect(result.reason).toBe('untrusted_origin');
  });

  test('自定义 scheme base:// -> block', () => {
    const result = decideNavigation('base://module/action?id=123', WHITELIST);
    expect(result.action).toBe('block');
    expect(result.reason).toBe('custom_scheme_deep_link');
  });

  test('file:// -> block', () => {
    const result = decideNavigation('file:///sdcard/test.html', WHITELIST);
    expect(result.action).toBe('block');
    expect(result.reason).toBe('file_scheme_blocked');
  });

  test('动态 H5 子包 file:// (h5-versions) -> allow', () => {
    const result = decideNavigation(
      `file:///data/user/0/${APP_PACKAGE}/files/h5-versions/1.0.1/index.html`,
      WHITELIST,
    );
    expect(result.action).toBe('allow');
    expect(result.reason).toBe('h5_versions');
  });

  test('h5-versions 目录外的 file:// 仍 block', () => {
    const result = decideNavigation(
      `file:///data/user/0/${APP_PACKAGE}/files/other/secret.html`,
      WHITELIST,
    );
    expect(result.action).toBe('block');
    expect(result.reason).toBe('file_scheme_blocked');
  });

  test('about:blank -> allow', () => {
    const result = decideNavigation('about:blank', WHITELIST);
    expect(result.action).toBe('allow');
    expect(result.reason).toBe('internal_scheme');
  });

  test('空 URL -> block', () => {
    const result = decideNavigation('', WHITELIST);
    expect(result.action).toBe('block');
    expect(result.reason).toBe('empty_url');
  });

  test('白名单带子路径仍 allow', () => {
    const result = decideNavigation('https://mobile-base.example.com/order/detail?id=1', WHITELIST);
    expect(result.action).toBe('allow');
  });
});

describe('shouldStartLoad', () => {
  test('白名单内返回 true', () => {
    expect(shouldStartLoad('https://mobile-base.example.com/', WHITELIST)).toBe(true);
  });

  test('白名单外返回 false', () => {
    expect(shouldStartLoad('https://evil.com/', WHITELIST)).toBe(false);
  });

  test('自定义 scheme 返回 false', () => {
    expect(shouldStartLoad('base://test', WHITELIST)).toBe(false);
  });
});
