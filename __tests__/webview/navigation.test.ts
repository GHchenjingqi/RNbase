/**
 * Phase 2：导航白名单决策单元测试（规范 §24）。
 */
import { decideNavigation, shouldStartLoad } from '../../src/webview/navigation';

const WHITELIST = ['https://mobile-erp.example.com'];

describe('decideNavigation', () => {
  test('白名单内 https 域名 -> allow', () => {
    const result = decideNavigation('https://mobile-erp.example.com/index.html', WHITELIST);
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

  test('自定义 scheme erp:// -> block', () => {
    const result = decideNavigation('erp://module/action?id=123', WHITELIST);
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
      'file:///data/user/0/com.qux/files/h5-versions/1.0.1/index.html',
      WHITELIST,
    );
    expect(result.action).toBe('allow');
    expect(result.reason).toBe('h5_versions');
  });

  test('h5-versions 目录外的 file:// 仍 block', () => {
    const result = decideNavigation(
      'file:///data/user/0/com.qux/files/other/secret.html',
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
    const result = decideNavigation('https://mobile-erp.example.com/order/detail?id=1', WHITELIST);
    expect(result.action).toBe('allow');
  });
});

describe('shouldStartLoad', () => {
  test('白名单内返回 true', () => {
    expect(shouldStartLoad('https://mobile-erp.example.com/', WHITELIST)).toBe(true);
  });

  test('白名单外返回 false', () => {
    expect(shouldStartLoad('https://evil.com/', WHITELIST)).toBe(false);
  });

  test('自定义 scheme 返回 false', () => {
    expect(shouldStartLoad('erp://test', WHITELIST)).toBe(false);
  });
});
