#!/usr/bin/env node
/**
 * Bridge 能力清单生成器（协议文档防腐化）。
 *
 * 真源：`scripts/api.js` 的 MODULES / APP_MANAGER_ACTIONS 注册表（H5 侧唯一调用入口）。
 * 交叉比对：`src/bridge/index.ts` 的 registerXxxModule 导入（RN 侧已注册模块）。
 *
 * 用法：
 *   node scripts/gen-api-doc.js            生成 docs/BRIDGE_API.generated.md
 *   node scripts/gen-api-doc.js --check    与已生成文档比对，不一致则 exit 1（可作 CI 门禁）
 *
 * 设计：解析/比对/渲染均为纯函数，导出供 __tests__/scripts 单测覆盖；
 *       CLI 仅负责读文件写文件。RN 侧模块名按注册文件名 dash→camel 推导，
 *       与实际 module 字符串命名约定一致（见各 capabilities/*.ts）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** 从 api.js 源码解析 H5 SDK 注册表。返回 { modules, appManager }。 */
function parseH5Registry(source) {
  const modules = {};
  const modulesMatch = source.match(/var MODULES = \{([\s\S]*?)\n  \};/);
  if (modulesMatch) {
    const blockRegex = /^\s{4}([A-Z_]+): \{([\s\S]*?)\n    \},?$/gm;
    let m;
    while ((m = blockRegex.exec(modulesMatch[1])) !== null) {
      const actions = {};
      const actionRegex = /([A-Z_]+): '([a-zA-Z]+)'/g;
      let a;
      while ((a = actionRegex.exec(m[2])) !== null) {
        actions[a[1]] = a[2];
      }
      if (Object.keys(actions).length > 0) {
        modules[m[1]] = actions;
      }
    }
  }

  let appManager = {};
  const amModule = source.match(/var APP_MANAGER_MODULE = '([^']+)';/);
  const amActions = source.match(/var APP_MANAGER_ACTIONS = \{([\s\S]*?)\n  \};/);
  if (amModule && amActions) {
    let a;
    const actionRegex = /([A-Z_]+): '([a-zA-Z]+)'/g;
    while ((a = actionRegex.exec(amActions[1])) !== null) {
      appManager[a[1]] = { module: amModule[1], action: a[2] };
    }
  }

  return { modules, appManager };
}

/** dash→camel：'app-manager' -> 'appManager'。 */
function dashToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** 从 src/bridge/index.ts 源码解析 RN 侧已注册模块名（按 register 调用行）。 */
function parseRnModules(source) {
  const names = new Set();
  // registerXxxModule(...) 调用行（排除 import 行）
  const callRegex = /^\s*register([A-Za-z]+)Module\(/gm;
  let m;
  while ((m = callRegex.exec(source)) !== null) {
    names.add(dashToCamel(m[1].replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()));
  }
  return Array.from(names).sort();
}

/** 计算两侧模块漂移。返回 { rnOnly, h5Only, common }。 */
function computeDrift(h5ModuleNames, rnModuleNames) {
  const h5 = new Set(h5ModuleNames);
  const rn = new Set(rnModuleNames);
  return {
    rnOnly: rnModuleNames.filter((n) => !h5.has(n)),
    h5Only: h5ModuleNames.filter((n) => !rn.has(n)),
    common: rnModuleNames.filter((n) => h5.has(n)),
  };
}

/** 渲染生成的 Markdown 文档。 */
function renderDoc({ modules, appManager }, rnModules) {
  const lines = [];
  lines.push('# Bridge 能力清单（自动生成）');
  lines.push('');
  lines.push('> 由 `scripts/gen-api-doc.js` 从 `scripts/api.js` 注册表自动生成，请勿手改。');
  // 故意不写「生成时间」：内容没变、日期也会变，CI 的 --check 门禁就会每天自己红。
  // 文件什么时候变的，git log 一查便知。
  lines.push('> 漂移校验：`node scripts/gen-api-doc.js --check`。');
  lines.push('> 详细使用说明见根目录 `DEVICE_CAPABILITIES.md`（手写文档）。');
  lines.push('');

  let total = 0;
  const moduleNames = Object.keys(modules);
  lines.push(`## H5 SDK 暴露的能力（${moduleNames.length} 模块）`);
  lines.push('');
  lines.push('| 调用 | Bridge module.action |');
  lines.push('| --- | --- |');
  for (const mod of moduleNames) {
    for (const [upper, lower] of Object.entries(modules[mod])) {
      total += 1;
      lines.push(`| \`RN.${mod}.${upper}\` | ${mod.toLowerCase()}.${lower} |`);
    }
  }
  lines.push('');
  lines.push(`**合计 ${total} 个方法。**`);
  lines.push('');

  const amKeys = Object.keys(appManager);
  if (amKeys.length > 0) {
    lines.push(`### APPMANAGER 特例（模块名 appManager，非全小写）`);
    lines.push('');
    lines.push('| 调用 | Bridge module.action |');
    lines.push('| --- | --- |');
    for (const upper of amKeys) {
      const { module, action } = appManager[upper];
      lines.push(`| \`RN.APPMANAGER.${upper}\` | ${module}.${action} |`);
    }
    lines.push('');
  }

  // 漂移比对统一使用桥接模块名：H5 注册表键为大写（APP），对应桥接名小写（app）；
  // APPMANAGER 是特例，桥接名为驼峰 appManager。
  const h5BridgeNames = Object.keys(modules)
    .filter((k) => k !== 'APPMANAGER')
    .map((k) => k.toLowerCase());
  if (Object.keys(appManager).length > 0) {
    h5BridgeNames.push(Object.values(appManager)[0].module);
  }
  const drift = computeDrift(h5BridgeNames, rnModules);
  lines.push(`## RN 侧已注册但 H5 SDK 未暴露（${drift.rnOnly.length} 个，按需在 api.js 补登记）`);
  lines.push('');
  if (drift.rnOnly.length === 0) {
    lines.push('（无）');
  } else {
    for (const n of drift.rnOnly) lines.push(`- \`${n}\``);
  }
  lines.push('');
  lines.push(`## H5 SDK 登记但 RN 侧未见注册调用（${drift.h5Only.length} 个，需人工确认）`);
  lines.push('');
  if (drift.h5Only.length === 0) {
    lines.push('（无）');
  } else {
    for (const n of drift.h5Only) lines.push(`- \`${n}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const root = path.resolve(__dirname, '..');
  const apiSource = fs.readFileSync(path.join(root, 'scripts/api.js'), 'utf8');
  const bridgeSource = fs.readFileSync(path.join(root, 'src/bridge/index.ts'), 'utf8');
  const docPath = path.join(root, 'docs/BRIDGE_API.generated.md');

  const registry = parseH5Registry(apiSource);
  const rnModules = parseRnModules(bridgeSource);
  const md = renderDoc(registry, rnModules);

  if (check) {
    const existing = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
    if (existing !== md) {
      console.error(
        '[gen-api-doc] 文档与 api.js 注册表不一致，运行 `node scripts/gen-api-doc.js` 重新生成。'
      );
      process.exit(1);
    }
    console.log('[gen-api-doc] check passed');
    return;
  }

  fs.writeFileSync(docPath, md, 'utf8');
  const count = Object.values(registry.modules).reduce((n, a) => n + Object.keys(a).length, 0);
  console.log(
    `[gen-api-doc] 已生成 docs/BRIDGE_API.generated.md（${count} 方法 + ${
      Object.keys(registry.appManager).length
    } APPMANAGER 特例，RN 侧 ${rnModules.length} 模块比对完成）`
  );
}

module.exports = { parseH5Registry, parseRnModules, computeDrift, renderDoc, dashToCamel };

if (require.main === module) {
  main();
}
