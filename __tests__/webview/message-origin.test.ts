/**
 * Bridge 消息来源判定单测（规范 §25）。
 *
 * 钉住三件事：跨域 iframe 拦得住、前缀伪装拦得住（曾经的 startsWith 漏洞）、
 * 本地/内联入口不会被自己拦死。
 *
 * 离线包路径的包名从 config 取（APP_PACKAGE）：其中一条用例要走 decideNavigation 的
 * h5-versions 前缀，而那条前缀按 version.json 的 applicationId 拼；CI 用的是中性
 * version.json（com.qux.base），写死具体包名就只有本机绿。
 */
import { isTrustedMessageOrigin } from '../../src/webview/message-origin';
import { APP_PACKAGE } from '../../src/config';

const WHITELIST = ['https://mobile-base.example.com'];

function check(input: Partial<Parameters<typeof isTrustedMessageOrigin>[0]>) {
  return isTrustedMessageOrigin({
    pageUrl: input.pageUrl ?? '',
    entryUrl: input.entryUrl ?? '',
    whitelist: input.whitelist ?? WHITELIST,
    messageOrigin: input.messageOrigin,
  });
}

describe('isTrustedMessageOrigin', () => {
  test('远程模式：当前页=白名单域，消息同源 → 放行', () => {
    expect(
      check({
        messageOrigin: 'https://mobile-base.example.com',
        pageUrl: 'https://mobile-base.example.com/app/',
        entryUrl: 'https://mobile-base.example.com/app/',
      }),
    ).toBe(true);
  });

  test('跨域 iframe 冒出来调用 → 拒', () => {
    expect(
      check({
        messageOrigin: 'https://evil.com',
        pageUrl: 'https://mobile-base.example.com/app/',
        entryUrl: 'https://mobile-base.example.com/app/',
      }),
    ).toBe(false);
  });

  test('前缀伪装域名（https://受信.evil.com）→ 拒（旧的 startsWith 会放行）', () => {
    expect(
      check({
        messageOrigin: 'https://mobile-base.example.com.evil.com',
        pageUrl: 'https://mobile-base.example.com/app/',
        entryUrl: 'https://mobile-base.example.com/app/',
      }),
    ).toBe(false);
  });

  test('站外页没给消息来源 → 拒（失败关闭只对非本地页保留）', () => {
    expect(
      check({
        pageUrl: 'https://evil.com/phishing',
        entryUrl: 'https://mobile-base.example.com/app/',
      }),
    ).toBe(false);
  });

  /**
   * 真机回归（雷电 Android 9 + APK 内置 assets 首屏）：
   * 安卓 WebMessageListener 对 file:// 页给的 sourceOrigin 是字面量 "null"，
   * 旧的「拿不到 origin 一律拒」把本地模式的 14 个接口全打成 SECURITY_BLOCKED，
   * 而单测用的是 http 域，所以只有装机才暴露。
   */
  test('本地内置包：安卓给的 sourceOrigin 是字面量 "null" → 放行（真机实测形态）', () => {
    expect(
      check({
        messageOrigin: 'null',
        pageUrl: 'file:///android_asset/index.html',
        entryUrl: 'file:///android_asset/index.html',
      }),
    ).toBe(true);
  });

  test('动态 H5 子包：sourceOrigin 为 "null" 也放行（离线包页同样是本地页）', () => {
    expect(
      check({
        messageOrigin: 'null',
        pageUrl: `file:///data/user/0/${APP_PACKAGE}/files/h5-versions/2/index.html`,
        entryUrl: 'file:///android_asset/index.html',
      }),
    ).toBe(true);
  });

  test('内联兜底 html（source.html，没有 uri）：来源缺失也放行', () => {
    expect(check({ messageOrigin: 'null', pageUrl: '', entryUrl: '' })).toBe(true);
  });

  test('本地页里的跨域 iframe 仍然拒：它给得出自己的 origin，与当前页不同源', () => {
    expect(
      check({
        messageOrigin: 'https://evil.com',
        pageUrl: 'file:///android_asset/index.html',
        entryUrl: 'file:///android_asset/index.html',
      }),
    ).toBe(false);
  });

  test('本地内置包：安卓消息 origin 是裸 file://，入口页放行', () => {
    expect(
      check({
        messageOrigin: 'file://',
        pageUrl: 'file:///android_asset/h5/index.html',
        entryUrl: 'file:///android_asset/h5/index.html',
      }),
    ).toBe(true);
  });

  test('动态 H5 子包（h5-versions）：入口不是它也能过导航策略', () => {
    expect(
      check({
        messageOrigin: 'file://',
        pageUrl: `file:///data/user/0/${APP_PACKAGE}/files/h5-versions/2/index.html`,
        entryUrl: '',
      }),
    ).toBe(true);
  });

  test('鸿蒙：消息带的是整页 URL，与入口同源 → 放行', () => {
    const uri = 'resource://rawfile/assets/h5/index.html';
    expect(check({ messageOrigin: uri, pageUrl: uri, entryUrl: uri })).toBe(true);
  });

  test('内联兜底页（about:blank）不会被拦死', () => {
    expect(check({ messageOrigin: 'about:blank', pageUrl: 'about:blank', entryUrl: '' })).toBe(
      true,
    );
  });

  test('页面已跳到站外域名：来源与当前页一致也拒（当前页本身不可信）', () => {
    expect(
      check({
        messageOrigin: 'https://evil.com',
        pageUrl: 'https://evil.com/phishing',
        entryUrl: 'https://mobile-base.example.com/app/',
      }),
    ).toBe(false);
  });
});
