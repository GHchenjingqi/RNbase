/**
 * 「基座 + URL」容器模式单测：入口短路、remoteUrl 校验、导航白名单。
 */
import { resolveH5Source } from '../src/app/resolve-h5-source';
import { decideNavigation } from '../src/webview/navigation';

const FALLBACK = '<html>fallback</html>';
const SITE = 'https://gushici.app.workbuddy.host/';
const SITE_ORIGIN = 'https://gushici.app.workbuddy.host';
// 负例数据，不是要加载的脚本：拆开写避免 no-script-url 把它当真实注入点。
const SCRIPT_URL = 'java' + 'script:alert(1)';

/** 用指定的 remoteUrl 重新加载一次 config（version.json 是模块初始化期读取的常量）。 */
function loadConfig(remoteUrl: unknown): typeof import('../src/config') {
  let cfg: typeof import('../src/config') | undefined;
  jest.isolateModules(() => {
    jest.doMock('../version.json', () => ({
      appName: 'test',
      apkName: 'test',
      applicationId: 'com.qux.test',
      versionName: '1.0.0',
      versionCode: 1,
      remoteUrl,
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
    const resolveEntry = jest.fn(async () => 'file:///android_asset/index.html');
    const src = await resolveH5Source({ resolveEntry }, FALLBACK, SITE);
    expect(src).toEqual({ uri: SITE });
    expect(resolveEntry).not.toHaveBeenCalled();
  });

  it('remoteUrl 为空串/null 时维持本地行为（优先本地入口）', async () => {
    const runtime = { resolveEntry: async () => 'https://cdn/x/index.html' };
    await expect(resolveH5Source(runtime, FALLBACK, '')).resolves.toEqual({
      uri: 'https://cdn/x/index.html',
    });
    await expect(resolveH5Source(runtime, FALLBACK, null)).resolves.toEqual({
      uri: 'https://cdn/x/index.html',
    });
    await expect(resolveH5Source(runtime, FALLBACK, undefined)).resolves.toEqual({
      uri: 'https://cdn/x/index.html',
    });
  });

  it('远程模式下本地无入口也不会回退内置兜底页', async () => {
    const src = await resolveH5Source({ resolveEntry: async () => '' }, FALLBACK, SITE);
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
    const cfg = loadConfig('https://gushici.app.workbuddy.host/poem/123?x=1');
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
      '//gushici.app.workbuddy.host/',
    ]) {
      expect(loadConfig(raw).IS_REMOTE_H5).toBe(false);
    }
  });

  it('开启时站点 origin 进 DOMAIN_WHITELIST，否则不进', () => {
    expect(loadConfig(SITE).DOMAIN_WHITELIST).toContain(SITE_ORIGIN);
    expect(loadConfig('').DOMAIN_WHITELIST).not.toContain(SITE_ORIGIN);
  });
});

describe('decideNavigation 远程模式', () => {
  const whitelist = ['https://mobile-base.example.com', SITE_ORIGIN];

  it('站内跳转留在容器内', () => {
    expect(decideNavigation(`${SITE_ORIGIN}/poem/123`, whitelist)).toEqual({
      action: 'allow',
      reason: 'trusted_origin',
    });
  });

  it('站内 origin 带端口/大小写差异仍按 origin 比对', () => {
    expect(decideNavigation('https://GUSHICI.app.workbuddy.host/', whitelist).action).toBe('allow');
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
