#!/usr/bin/env node
/**
 * iOS 工程引用完整性守卫（提交/CI 用，无需 Mac）。
 *
 * 存在的理由：platforms/ios/qux/ 下的 Swift/ObjC 文件只有在被 project.pbxproj 引用时才会参与编译。
 * 之前 8 个源文件里只有 AppDelegate.swift 进了工程，其余 7 个（含用 RCT_EXTERN_MODULE 导出
 * 能力的 .m）是「代码在、CI 也绿、打出来的包却没有任何 Bridge 能力」——xcodebuild 不会为
 * 没被引用的文件报任何错，Mac 上的编译通过反而像是好消息。
 * 这道检查跑在 ubuntu runner 上，把磁盘源文件与工程引用做差集，唯一的判据就是差集为空。
 *
 * 用法：
 *   node scripts/check-ios-project.js            # 校验 platforms/ios
 *   node scripts/check-ios-project.js --ios-dir <dir>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ID = '[0-9A-Fa-f]{24}';

/** 取某个「Begin X section」区块的正文（到对应的 End 行为止）。 */
function sectionOf(source, section) {
  const begin = source.indexOf(`/* Begin ${section} section */`);
  if (begin === -1) return '';
  const end = source.indexOf(`/* End ${section} section */`, begin);
  return source.slice(begin, end === -1 ? source.length : end);
}

/** 区块内每条「ID + 注释 + {isa = ...}」记录（按行匹配，pbxproj 是一行一条）。 */
function entriesOf(sectionText) {
  const out = [];
  const re = new RegExp(`^\\s*(${ID})\\s*/\\*\\s*(.*?)\\s*\\*/\\s*=\\s*\\{(.*)\\};`, 'm');
  let rest = sectionText;
  while (true) {
    const m = rest.match(re);
    if (!m) break;
    out.push({ id: m[1], comment: m[2], body: m[3] });
    rest = rest.slice(rest.indexOf(m[0]) + m[0].length);
  }
  return out;
}

/** Sources 构建阶段里的 buildFile id 列表。 */
function sourcePhaseBuildIds(source) {
  const m = source.match(/isa\s*=\s*PBXSourcesBuildPhase;[\s\S]*?files\s*=\s*\(([\s\S]*?)\);/);
  if (!m) return [];
  return Array.from(m[1].matchAll(new RegExp(`(${ID})`, 'g'))).map((x) => x[1]);
}

/** 工程目录下的源文件：AppDelegate + Base*（与 scripts/ios.js 的 nativeSources 同口径）。 */
function diskSources(iosDir) {
  if (!fs.existsSync(iosDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(iosDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'Pods' || entry.name.endsWith('.xcworkspace'))
      continue;
    for (const file of fs.readdirSync(path.join(iosDir, entry.name))) {
      if (/\.(swift|m)$/.test(file)) out.push(`${entry.name}/${file}`);
    }
  }
  return out.sort();
}

/**
 * 返回漂移清单（空即工程与磁盘一致）。
 * 每个源文件查三件事：有 PBXFileReference、有对应 PBXBuildFile、该 buildFile 挂在 Sources 阶段。
 */
function collectIosProjectDrift(iosDir) {
  const problems = [];
  const pbxproj = path.join(iosDir, findProjectName(iosDir), 'project.pbxproj');
  if (!fs.existsSync(pbxproj)) {
    return [`未找到 Xcode 工程文件：${pbxproj}`];
  }
  const source = fs.readFileSync(pbxproj, 'utf8');

  const fileRefs = entriesOf(sectionOf(source, 'PBXFileReference'));
  const buildFiles = entriesOf(sectionOf(source, 'PBXBuildFile'));
  const sourcesPhase = new Set(sourcePhaseBuildIds(source));

  for (const rel of diskSources(iosDir)) {
    const name = path.basename(rel);
    const ref = fileRefs.find(
      (e) => e.comment === name || new RegExp(`path = ${rel};`).test(e.body)
    );
    if (!ref) {
      problems.push(`${rel} 未加入工程（缺 PBXFileReference）：文件在磁盘上但永远不参与编译`);
      continue;
    }
    const build = buildFiles.find((e) => new RegExp(`fileRef\\s*=\\s*${ref.id}\\b`).test(e.body));
    if (!build) {
      problems.push(`${rel} 只有文件引用、没有 PBXBuildFile：不会进任何构建阶段`);
      continue;
    }
    if (!sourcesPhase.has(build.id)) {
      problems.push(`${rel} 的 PBXBuildFile 没挂在 Sources 构建阶段：不会编译进 .app`);
    }
  }
  return problems;
}

function findProjectName(iosDir) {
  const proj = fs
    .readdirSync(iosDir)
    .filter((f) => f.endsWith('.xcodeproj'))
    .sort();
  return proj.length ? proj[0] : 'qux.xcodeproj';
}

function main() {
  const i = process.argv.indexOf('--ios-dir');
  const iosDir = path.resolve(
    i === -1 ? path.join(__dirname, '..', 'platforms', 'ios') : process.argv[i + 1]
  );
  const problems = collectIosProjectDrift(iosDir);
  if (problems.length === 0) {
    console.log(
      `[ios-project] 工程引用完整：${diskSources(iosDir).length} 个源文件全部挂在 Sources 阶段`
    );
    return;
  }
  console.error(
    '[ios-project] iOS 工程与磁盘源文件不一致（CI 的 xcodebuild 会绿着打出缺能力的包）：'
  );
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '  修法：在 Xcode 里 Add Files to "qux" 并勾选 App target，或直接补 project.pbxproj 的引用与 Sources 段。'
  );
  process.exit(1);
}

module.exports = { collectIosProjectDrift, diskSources, findProjectName };

if (require.main === module) {
  main();
}
