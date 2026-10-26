/**
 * 「基座 + URL」容器模式单测：入口短路、remoteUrl 校验、导航白名单。
 */
import { resolveH5Source } from '../src/app/resolve-h5-source';
import { decideNavigation } from '../src/webview/navigation';

const BUILTIN = 'file:///android_asset/index.html';
const SITE = 'https://remote-h5.example.test/';
const SITE_ORIGIN = 'https://remote-h5.example.test';
// 负例数据，不是要加载的脚本：拆开写避免 no-script-url 把它当真实注入点。
const SCRIPT_URL = 'java' + 'script:alert(1)';

/** 用指定的 remoteUrl / 额外字段重新加载一次 config（version.json 是模块初始化期读取的常量）。 */
function loadConfig(
  remoteUrl: unknown,
  extra: Record<string, unknown> = {},
): typeof import('../src/config') {
  let cfg: typeof import('../src/config') | undefined;
  jest.isolateModules(() => {
    jest.doMock('../version.json', () => ({
      appName: 'test',
      apkName: 'test',
      applicationId: 'com.qux.test',
      versionName: '1.0.0',
      versionCode: 1,
      remoteUrl,
      ...extra,
    }));
    cfg = require('../src/config');
  });
  if (!cfg) {
    throw new Error('config 未加载');
  }
  return cfg;
}

describe('resolveH5Source 远程模式分支', () => {
  it('remoteUrl 生效时直接返回该地址，且不查本地激活版本', async () => {
    const resolveEntry = jest.fn(async () => BUILTIN);
    const src = await resolveH5Source({ runtime: { resolveEntry }, remoteUrl: SITE });
    expect(src).toEqual({ uri: SITE });
    expect(resolveEntry).not.toHaveBeenCalled();
  });

  it('remoteUrl 为空串/null 时维持本地行为（优先已激活子包）', async () => {
    const runtime = { resolveEntry: async () => 'https://cdn/x/index.html' };
    for (const remoteUrl of ['', null, undefined]) {
      await expect(resolveH5Source({ runtime, remoteUrl, builtinEntry: BUILTIN })).resolves.toEqual(
        { uri: 'https://cdn/x/index.html' },
      );
    }
  });

  it('远程模式下本地无入口也不回退内置资源：WebView 加载的就是站点', async () => {
    const src = await resolveH5Source({
      runtime: { resolveEntry: async () => '' },
      remoteUrl: SITE,
      builtinEntry: BUILTIN,
    });
    expect(src).toEqual({ uri: SITE });
  });
});

describe('version.json 的 remoteUrl 归一化', () => {
  it('https 站点视为开启远程模式，origin 只到 host', () => {
    const cfg = loadConfig(SITE);
    expect(cfg.REMOTE_H5_URL).toBe(SITE);
    expect(cfg.IS_REMOTE_H5).toBe(true);
    expect(cfg.REMOTE_H5_ORIGIN).toBe(SITE_ORIGIN);
  });

  it('origin 不含 path/query，避免把路径当信任域放行', () => {
    const cfg = loadConfig('https://remote-h5.example.test/poem/123?x=1');
    expect(cfg.REMOTE_H5_ORIGIN).toBe(SITE_ORIGIN);
  });

  it('留空 / 纯空白 / 非字符串 = 未开启', () => {
    for (const raw of ['', '   ', undefined, null, 123, { url: SITE }]) {
      const cfg = loadConfig(raw);
      expect(cfg.REMOTE_H5_URL).toBeNull();
      expect(cfg.IS_REMOTE_H5).toBe(false);
      expect(cfg.REMOTE_H5_ORIGIN).toBeNull();
    }
  });

  it('非 http(s) scheme 一律当未开启：不给容器塞任意脚本', () => {
    for (const raw of [
      SCRIPT_URL,
      'data:text/html,<script>alert(1)</script>',
      'file:///android_asset/index.html',
      'intent://scan/#Intent;scheme=zxing;end',
      'https://',
      '//remote-h5.example.test/',
    ]) {
      expect(loadConfig(raw).IS_REMOTE_H5).toBe(false);
    }
  });

  it('开启时站点 origin 进 DOMAIN_WHITELIST，否则不进', () => {
    expect(loadConfig(SITE).DOMAIN_WHITELIST).toContain(SITE_ORIGIN);
    expect(loadConfig('').DOMAIN_WHITELIST).not.toContain(SITE_ORIGIN);
  });

  it('信任域只来自 version.json 的 trustedDomains：出厂不再内置占位 https 域', () => {
    const httpsOnly = (list: string[]) => list.filter(x => x.startsWith('https://'));
    // 未配置 = 一个 https 信任域都没有（本地 H5 走 asset:// 前缀放行，不需要域名）。
    // 以前这里首项写死 https://mobile-base.example.com，等于「只信一个不存在的域」。
    expect(httpsOnly(loadConfig('').DOMAIN_WHITELIST)).toEqual([]);
    expect(
      httpsOnly(loadConfig('', { trustedDomains: ['https://a.example.test'] }).DOMAIN_WHITELIST),
    ).toEqual(['https://a.example.test']);
  });

  it('trustedDomains 丢掉非 http(s) 项并做 trim：不把任意 scheme 当信任源', () => {
    const cfg = loadConfig('', {
      trustedDomains: [SCRIPT_URL, 'data:text/html,x', ' https://b.example.test ', 42, ''],
    });
    expect(cfg.DOMAIN_WHITELIST.filter(x => x.startsWith('https://'))).toEqual([
      'https://b.example.test',
    ]);
  });

  it('离线 H5 子包前缀跟着 applicationId 走：换包名的子应用读得到自己的包', () => {
    // config 与 navigation 都在模块初始化期读 version.json，所以两者都要在同一个
    // isolateModules 里、mock 生效期间重新 require，否则拿到的是真 version.json 的实例。
    let appPackage: string | undefined;
    let decide:
      | ((url: string, whitelist?: string[]) => { action: string; reason: string })
      | undefined;
    jest.isolateModules(() => {
      jest.doMock('../version.json', () => ({
        appName: 'test',
        apkName: 'test',
        applicationId: 'com.qux.demo',
        versionName: '1.0.0',
        versionCode: 1,
        remoteUrl: '',
      }));
      appPackage = require('../src/config').APP_PACKAGE as string;
      decide = require('../src/webview/navigation').decideNavigation;
    });
    expect(appPackage).toBe('com.qux.demo');
    expect(decide!('file:///data/user/0/com.qux.demo/files/h5-versions/1/index.html', [])).toEqual({
      action: 'allow',
      reason: 'h5_versions',
    });
    // 别的包的私有目录仍然拦下：放行前缀只跟着自己的 applicationId。
    expect(
      decide!('file:///data/user/0/com.other.app/files/h5-versions/1/index.html', []).action,
    ).toBe('block');
  });
});

describe('decideNavigation 远程模式', () => {
  const whitelist = ['https://base-fixture.example.test', SITE_ORIGIN];

  it('站内跳转留在容器内', () => {
    expect(decideNavigation(`${SITE_ORIGIN}/poem/123`, whitelist)).toEqual({
      action: 'allow',
      reason: 'trusted_origin',
    });
  });

  it('站内 origin 带端口/大小写差异仍按 origin 比对', () => {
    expect(decideNavigation('https://REMOTE-H5.example.test/', whitelist).action).toBe('allow');
  });

  it('跳出站点外一律走系统浏览器（不继承容器权限）', () => {
    expect(decideNavigation('https://evil.example.com/x', whitelist)).toEqual({
      action: 'open-external',
      reason: 'untrusted_origin',
    });
  });

  it('远程模式下危险 scheme 仍被拦下', () => {
    expect(decideNavigation(SCRIPT_URL, whitelist).action).toBe('block');
    expect(decideNavigation('file:///sdcard/x.html', whitelist).action).toBe('block');
    expect(decideNavigation('base://open', whitelist).action).toBe('block');
  });
});
