/**
 * gen-api-doc.js 纯函数单测：H5 注册表解析、RN 侧模块解析、漂移比对、文档渲染。
 * 被测脚本是 CommonJS（scripts/ 目录按约定 eslint-ignore），此处 require 后给最小类型。
 */
const gen = require('../../scripts/gen-api-doc.js');

type Registry = {
  modules: Record<string, Record<string, string>>;
  appManager: Record<string, { module: string; action: string }>;
};

const typed = gen as {
  parseH5Registry: (source: string) => Registry;
  parseRnModules: (source: string) => string[];
  computeDrift: (
    h5: string[],
    rn: string[],
  ) => {
    rnOnly: string[];
    h5Only: string[];
    common: string[];
  };
  renderDoc: (registry: Registry, rnModules: string[]) => string;
  dashToCamel: (s: string) => string;
};

const API_SAMPLE = `(function (global) {
  'use strict';
  var MODULES = {
    APP: {
      GETINFO: 'getInfo',
      NATIVEBACKRESULT: 'nativeBackResult',
    },
    LOG: {
      INFO: 'info',
    },
    // 动作名含数字（readAsBase64）：曾因正则只认字母而被静默漏渲，此处钉住
    FILE: {
      READASBASE64: 'readAsBase64',
    },
    // 注释里混入的假键不应被解析：FAKE: 'fake'
    EMPTY: {},
  };

  var APP_MANAGER_MODULE = 'appManager';
  var APP_MANAGER_ACTIONS = {
    ISINSTALLED: 'isInstalled',
    OPENAPP: 'openApp',
  };
})(this);`;

describe('gen-api-doc 纯函数', () => {
  test('dashToCamel 转换注册文件名', () => {
    expect(typed.dashToCamel('app-manager')).toBe('appManager');
    expect(typed.dashToCamel('network-info')).toBe('networkInfo');
    expect(typed.dashToCamel('app')).toBe('app');
  });

  test('parseH5Registry 解析模块/方法与 APPMANAGER 特例，跳过空块', () => {
    const { modules, appManager } = typed.parseH5Registry(API_SAMPLE);
    expect(modules.APP).toEqual({ GETINFO: 'getInfo', NATIVEBACKRESULT: 'nativeBackResult' });
    expect(modules.LOG).toEqual({ INFO: 'info' });
    expect(modules.FILE).toEqual({ READASBASE64: 'readAsBase64' });
    expect(modules.EMPTY).toBeUndefined();
    expect(appManager.ISINSTALLED).toEqual({ module: 'appManager', action: 'isInstalled' });
    expect(appManager.OPENAPP).toEqual({ module: 'appManager', action: 'openApp' });
  });

  test('parseRnModules 从 register 调用行推导模块名，忽略 import', () => {
    const src = [
      "import { registerAppManagerModule } from './modules/capabilities/app-manager';",
      "import { registerNetworkInfoModule } from './modules/capabilities/network-info';",
      '  registerAppModule();',
      '  registerAppManagerModule();',
      '  registerNetworkInfoModule();',
    ].join('\n');
    expect(typed.parseRnModules(src)).toEqual(['app', 'appManager', 'networkInfo']);
  });

  test('computeDrift 输出双侧差异与交集', () => {
    const drift = typed.computeDrift(['app', 'camera'], ['app', 'toast', 'sensor']);
    expect(drift.common).toEqual(['app']);
    expect(drift.rnOnly).toEqual(['toast', 'sensor']);
    expect(drift.h5Only).toEqual(['camera']);
  });

  test('renderDoc 生成含能力表与漂移段的 Markdown', () => {
    const registry = typed.parseH5Registry(API_SAMPLE);
    const md = typed.renderDoc(registry, ['app', 'log', 'appManager', 'toast']);
    expect(md).toContain('# Bridge 能力清单（自动生成）');
    expect(md).toContain('`RN.APP.GETINFO` | app.getInfo');
    expect(md).toContain('`RN.APPMANAGER.ISINSTALLED` | appManager.isInstalled');
    // RN 侧 toast 未暴露应出现在漂移段
    expect(md).toContain('- `toast`');
    // app/log/appManager 两侧都有，不应出现在漂移段
    expect(md).not.toMatch(/^- `app`$/m);
    expect(md).not.toMatch(/^- `appManager`$/m);
  });
});
