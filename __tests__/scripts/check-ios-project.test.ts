/**
 * iOS 工程引用完整性守卫单测。
 *
 * 这条检查存在的意义是「xcodebuild 对没被引用的文件不报错」，所以四种漏法要分别钉住：
 * 完全没有引用、只有引用没有 BuildFile、有 BuildFile 但没挂 Sources、以及齐活不该报。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const checker = require('../../scripts/check-ios-project.js');
const typed = checker as {
  collectIosProjectDrift: (iosDir: string) => string[];
  diskSources: (iosDir: string) => string[];
};

const TMP: string[] = [];

/** 生成一个最小 iOS 工程；files 决定磁盘上有哪些源文件，refs 决定工程里引用了哪些。 */
function makeIosDir(opts: {
  files: string[];
  refs?: string[];
  buildFiles?: string[];
  sourcesPhase?: string[];
}): string {
  const iosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-project-'));
  TMP.push(iosDir);
  fs.mkdirSync(path.join(iosDir, 'qux'), { recursive: true });
  for (const f of opts.files) {
    fs.writeFileSync(path.join(iosDir, 'qux', f), '// source\n', 'utf8');
  }
  const refs = opts.refs ?? opts.files;
  const buildFiles = opts.buildFiles ?? opts.files;
  const phase = opts.sourcesPhase ?? buildFiles;

  const refId = (name: string) =>
    `AA000000000000000000${String(hash(name) % 1000).padStart(3, '0')}0`;
  const buildId = (name: string) =>
    `BB000000000000000000${String(hash(name) % 1000).padStart(3, '0')}0`;

  const lines = [
    '// !$*UTF8*$!',
    '{',
    '\tobjects = {',
    '/* Begin PBXBuildFile section */',
    ...buildFiles.map(
      n =>
        `\t\t${buildId(n)} /* ${n} in Sources */ = {isa = PBXBuildFile; fileRef = ${refId(
          n,
        )} /* ${n} */; };`,
    ),
    '/* End PBXBuildFile section */',
    '/* Begin PBXFileReference section */',
    ...refs.map(
      n =>
        `\t\t${refId(
          n,
        )} /* ${n} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = ${n}; path = qux/${n}; sourceTree = "<group>"; };`,
    ),
    '/* End PBXFileReference section */',
    '/* Begin PBXSourcesBuildPhase section */',
    '\t\t' + 'CC' + '0'.repeat(21) + '1 /* Sources */ = {',
    '\t\t\tisa = PBXSourcesBuildPhase;',
    '\t\t\tfiles = (',
    ...phase.map(n => `\t\t\t\t${buildId(n)} /* ${n} in Sources */,`),
    '\t\t\t);',
    '\t\t};',
    '/* End PBXSourcesBuildPhase section */',
    '\t};',
    '}',
  ];
  fs.mkdirSync(path.join(iosDir, 'qux.xcodeproj'), { recursive: true });
  fs.writeFileSync(path.join(iosDir, 'qux.xcodeproj', 'project.pbxproj'), lines.join('\n'), 'utf8');
  return iosDir;
}

function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 100000;
  return h;
}

afterAll(() => {
  for (const dir of TMP) fs.rmSync(dir, { recursive: true, force: true });
});

describe('diskSources', () => {
  test('只认工程目录下的源文件，忽略 Pods 与 xcworkspace', () => {
    const iosDir = makeIosDir({ files: ['BaseH5.m'] });
    fs.mkdirSync(path.join(iosDir, 'Pods', 'Lib'), { recursive: true });
    fs.writeFileSync(path.join(iosDir, 'Pods', 'Lib', 'Noise.m'), '', 'utf8');
    fs.mkdirSync(path.join(iosDir, 'qux.xcworkspace'), { recursive: true });
    expect(typed.diskSources(iosDir)).toEqual(['qux/BaseH5.m']);
  });
});

describe('collectIosProjectDrift', () => {
  test('引用齐全时不报（基线）', () => {
    const iosDir = makeIosDir({ files: ['AppDelegate.swift', 'BaseH5.swift'] });
    expect(typed.collectIosProjectDrift(iosDir)).toEqual([]);
  });

  test('完全没进工程：点名缺 PBXFileReference', () => {
    const iosDir = makeIosDir({
      files: ['AppDelegate.swift', 'BaseCapabilities.m'],
      refs: ['AppDelegate.swift'],
      buildFiles: ['AppDelegate.swift'],
      sourcesPhase: ['AppDelegate.swift'],
    });
    expect(typed.collectIosProjectDrift(iosDir)).toEqual([
      expect.stringContaining('qux/BaseCapabilities.m 未加入工程（缺 PBXFileReference）'),
    ]);
  });

  test('只有文件引用、没有 BuildFile：单独点名', () => {
    const iosDir = makeIosDir({ files: ['BaseH5.m'], buildFiles: [], sourcesPhase: [] });
    expect(typed.collectIosProjectDrift(iosDir)).toEqual([
      expect.stringContaining('BaseH5.m 只有文件引用、没有 PBXBuildFile'),
    ]);
  });

  test('有 BuildFile 但没挂 Sources 阶段：单独点名（这种最容易漏也最难看出）', () => {
    const iosDir = makeIosDir({ files: ['BaseNetwork.m'], sourcesPhase: [] });
    expect(typed.collectIosProjectDrift(iosDir)).toEqual([
      expect.stringContaining('BaseNetwork.m 的 PBXBuildFile 没挂在 Sources 构建阶段'),
    ]);
  });

  test('工程文件缺失直接报错，不静默通过', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-noproj-'));
    TMP.push(bare);
    expect(typed.collectIosProjectDrift(bare)).toEqual([
      expect.stringContaining('未找到 Xcode 工程文件'),
    ]);
  });

  test('真实工程的源文件全部已挂上（这条会随漏加文件而红，正是它的用处）', () => {
    const realDir = path.resolve(__dirname, '../../platforms/ios');
    expect(typed.diskSources(realDir).length).toBeGreaterThan(1);
    expect(typed.collectIosProjectDrift(realDir)).toEqual([]);
  });
});
