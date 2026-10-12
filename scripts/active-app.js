/**
 * 活动 H5 子应用解析（基座唯一的「当前装的是哪个 App」真源）。
 *
 * 基座本身不内置任何具体 App 参数：品牌/版本/权限由子应用 app.config.json 持有，
 * 由 apply-app-meta.js 下发；而「当前活动子应用是哪一个」记录在 app_base/app-registry.json。
 * gradle.js / dev.js / bump-version.js 都通过本模块定位子应用目录与产物目录，
 * 避免把某个具体子工程路径硬编码进基座。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_FILE = path.join(ROOT, 'app-registry.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * 读取注册表原文（不解析活动应用），供 registry:set 使用。
 */
function readRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) {
    throw new Error(`未找到注册表：${REGISTRY_FILE}（应记录 activeApp 与 apps 列表）`);
  }
  const raw = readJson(REGISTRY_FILE);
  if (!raw.apps || typeof raw.apps !== 'object') {
    throw new Error(`${REGISTRY_FILE} 缺少 apps 字段`);
  }
  return raw;
}

/**
 * 解析活动子应用。
 * @param {string} [nameOverride] 显式指定子应用名（命令行 --app），可为注册表键名或目录路径
 * @returns {{ name: string, dir: string, distDir: string, dist: string, configPath: string, brandDir: string, source: string }}
 */
function resolveActiveApp(nameOverride) {
  const raw = readRegistry();

  if (nameOverride && nameOverride !== 'true') {
    if (raw.apps[nameOverride]) {
      return build(nameOverride, raw.apps[nameOverride], 'cli');
    }
    // 允许直接传目录路径（未登记在注册表中的临时子应用）
    if (nameOverride.includes('/') || nameOverride.includes('\\')) {
      const dir = path.resolve(ROOT, nameOverride);
      return build(path.basename(dir), { dir: nameOverride, dist: detectDist(dir) }, 'cli-path');
    }
    throw new Error(
      `注册表中不存在子应用「${nameOverride}」，已登记：${Object.keys(raw.apps).join(' / ')}`,
    );
  }

  if (!raw.activeApp) {
    throw new Error(`${REGISTRY_FILE} 缺少 activeApp（用 npm run app:use <name> 设置）`);
  }
  if (!raw.apps[raw.activeApp]) {
    throw new Error(
      `activeApp「${raw.activeApp}」未在 apps 中登记，已登记：${Object.keys(raw.apps).join(' / ')}`,
    );
  }
  return build(raw.activeApp, raw.apps[raw.activeApp], 'registry');
}

function build(name, entry, source) {
  const dir = path.resolve(ROOT, entry.dir);
  const dist = entry.dist || detectDist(dir);
  return {
    name,
    dir,
    dist,
    distDir: path.join(dir, dist),
    configPath: path.join(dir, 'app.config.json'),
    brandDir: path.join(dir, 'app-brand', 'android'),
    source,
  };
}

/** 未登记 dist 时推断：优先单文件产物，其次标准产物。 */
function detectDist(dir) {
  for (const candidate of ['dist-file', 'dist']) {
    if (fs.existsSync(path.join(dir, candidate, 'index.html'))) {
      return candidate;
    }
  }
  return 'dist';
}

/**
 * 当前安装到设备上的包名 = 活动子应用下发的 applicationId。
 * 注意与源码 namespace（固定 com.qux，MainActivity 所在包）区分：
 * am start / force-stop 必须用这里的值，否则切包名后命令打不到 App。
 */
function readApplicationId() {
  try {
    const v = readJson(path.join(ROOT, 'version.json'));
    if (v && v.applicationId) {
      return v.applicationId;
    }
  } catch (e) {
    // version.json 缺失/损坏时回退基座默认包名
  }
  return 'com.qux';
}

/** 写回 activeApp（registry:set）。 */
function setActiveApp(name) {
  const raw = readRegistry();
  if (!raw.apps[name]) {
    throw new Error(
      `注册表中不存在子应用「${name}」，已登记：${Object.keys(raw.apps).join(' / ')}`,
    );
  }
  raw.activeApp = name;
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  return raw;
}

module.exports = {
  resolveActiveApp,
  readRegistry,
  setActiveApp,
  readApplicationId,
  REGISTRY_FILE,
  ROOT,
};
