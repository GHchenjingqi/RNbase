/**
 * 基座品牌中性守卫单测。
 *
 * 这个脚本是「提交前该不该跑 brand:reset」的唯一机器判据，所以两件事必须钉住：
 *  - 中性状态要放过（否则门禁会变成噪音，人会把门禁删掉）；
 *  - 每一类品牌残留要各自点名到文件（尤其位图：早期版本用 utf8 读 PNG，
 *    相同文件也会因为非法字节被替换成 U+FFFD 而判成不一致，属于假阳性）。
 *
 * 第二层（tracked 源码违禁词扫描）另外钉住「缺词表不能失败」：CI 上不存在本地词表，
 * 让它变红只会逼人在 CI 里加一份含真实租户名的清单，那正是这层守卫要防的事。
 * 还有——**本文件里出现的违禁词一律是 TEST_ONLY_* 人造词**，真实租户名写进测试
 * 就等于租户名进了基座仓库，守卫自己成了泄漏源。
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const checker = require('../../scripts/check-brand-neutral.js');
const { NEUTRAL } = require('../../scripts/apply-app-meta.js');

type DenylistResult = {
  problems: string[];
  /** 非空表示这一层本次没扫（未配词表 / 词表为空 / 非 git 环境），只提示不失败。 */
  skipped: string | null;
};

type Checker = {
  collectBrandDrift: (baseDir: string) => string[];
  resolveAndroidMain: (baseDir: string) => string;
  collectDenylistDrift: (baseDir: string) => DenylistResult;
  loadBrandDenylist: (baseDir: string) => string[] | null;
  listTrackedTextFiles: (baseDir: string) => { files: string[] | null; reason: string | null };
  DENYLIST_FILE: string;
};
const typed = checker as Checker;

type Fixture = {
  baseDir: string;
  main: string;
  write: (relPath: string[], content: string | Buffer) => void;
};

function newFixture(): Fixture {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-neutral-'));
  const main = path.join(baseDir, 'platforms', 'android', 'app', 'src', 'main');
  const write = (relPath: string[], content: string | Buffer) => {
    const file = path.join(baseDir, ...relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  return { baseDir, main, write };
}

/** 写出一个「刚跑过 brand:reset」的中性仓库。 */
function neutralFixture(): Fixture {
  const f = newFixture();
  f.write(
    ['platforms', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'],
    `<resources>\n  <string name="app_name">${NEUTRAL.appName}</string>\n</resources>\n`,
  );
  f.write(
    ['platforms', 'android', 'app', 'src', 'main', 'res', 'values', 'colors.xml'],
    `<resources>\n  <color name="splash_bg">${NEUTRAL.splashBackgroundColor}</color>\n</resources>\n`,
  );
  f.write(
    ['platforms', 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash_screen.xml'],
    '<layer-list><item android:drawable="@color/splash_bg" /></layer-list>\n',
  );
  // 图标：brand-default 与 res 逐字节相同即为复位态
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x41]);
  for (const dir of ['brand-default', 'res']) {
    f.write(
      ['platforms', 'android', 'app', 'src', 'main', dir, 'mipmap-hdpi', 'ic_launcher.png'],
      png,
    );
    f.write(
      ['platforms', 'android', 'app', 'src', 'main', dir, 'mipmap-xhdpi', 'ic_launcher.png'],
      png,
    );
  }
  const harmony = JSON.stringify({ string: [{ name: '__N__', value: NEUTRAL.appName }] });
  f.write(
    ['harmony', 'AppScope', 'resources', 'base', 'element', 'string.json'],
    harmony.replace('__N__', 'app_name'),
  );
  f.write(
    ['harmony', 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json'],
    harmony.replace('__N__', 'EntryAbility_label'),
  );
  return f;
}

const TMP: string[] = [];

function fixture(dir: Fixture): Fixture {
  TMP.push(dir.baseDir);
  return dir;
}

afterAll(() => {
  for (const dir of TMP) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 把 fixture 变成真 git 仓库：第二层守卫的扫描面来自 `git ls-files`，
 * 只 init + add 就够（ls-files 读索引，不需要 commit，也不碰用户全局配置）。
 * Windows 上 git 输出的是正斜杠路径，这正好也是被测代码要处理的形状。
 */
function gitTrack(baseDir: string) {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', baseDir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  git(['add', '-A']);
}

describe('collectBrandDrift', () => {
  test('复位态（中性）基座零漂移', () => {
    expect(typed.collectBrandDrift(fixture(neutralFixture()).baseDir)).toEqual([]);
  });

  test('Android 桌面名带子应用名只点名 strings.xml', () => {
    const f = fixture(neutralFixture());
    f.write(
      ['platforms', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'],
      `<resources><string name="app_name">某某ERP</string></resources>\n`,
    );
    const problems = typed.collectBrandDrift(f.baseDir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('strings.xml');
    expect(problems[0]).toContain('app_name="某某ERP"');
  });

  test('闪屏底色被子应用改掉', () => {
    const f = fixture(neutralFixture());
    f.write(
      ['platforms', 'android', 'app', 'src', 'main', 'res', 'values', 'colors.xml'],
      '<resources><color name="splash_bg">#FF112233</color></resources>\n',
    );
    const problems = typed.collectBrandDrift(f.baseDir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('splash_bg=#FF112233');
  });

  test('闪屏 drawable 引用子应用 logo', () => {
    const f = fixture(neutralFixture());
    f.write(
      ['platforms', 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash_screen.xml'],
      '<layer-list><item android:drawable="@drawable/splash_logo" /></layer-list>\n',
    );
    expect(typed.collectBrandDrift(f.baseDir)).toEqual([
      expect.stringContaining('仍引用 splash_logo 品牌图'),
    ]);
  });

  test('子应用图标残留：同目录名、不同字节', () => {
    const f = fixture(neutralFixture());
    f.write(
      ['platforms', 'android', 'app', 'src', 'main', 'res', 'mipmap-xhdpi', 'ic_launcher.png'],
      Buffer.from([1, 2, 3, 4]),
    );
    const problems = typed.collectBrandDrift(f.baseDir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('mipmap-xhdpi/ic_launcher.png');
    expect(problems[0]).toContain('与 brand-default 不一致');
  });

  test('基座默认图标被删掉：报缺失而不是静默放过', () => {
    const f = fixture(neutralFixture());
    fs.rmSync(
      path.join(
        f.baseDir,
        'platforms',
        'android',
        'app',
        'src',
        'main',
        'res',
        'mipmap-hdpi',
        'ic_launcher.png',
      ),
    );
    expect(typed.collectBrandDrift(f.baseDir)).toEqual([
      expect.stringContaining('mipmap-hdpi/ic_launcher.png 缺失'),
    ]);
  });

  test('PNG 按字节比：内容相同的二进制文件不得因 utf8 解码而误报', () => {
    // 0xFF/0xFE 是非法 UTF-8 字节；早前版本 readFileSync(...,'utf8') 后再比较，
    // 完全相同的图标也会被判成漂移，等于门禁自己制造噪音。
    const f = fixture(neutralFixture());
    const weird = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0xc3, 0x28]);
    f.write(
      [
        'platforms',
        'android',
        'app',
        'src',
        'main',
        'brand-default',
        'mipmap-hdpi',
        'ic_launcher.png',
      ],
      weird,
    );
    f.write(
      ['platforms', 'android', 'app', 'src', 'main', 'res', 'mipmap-hdpi', 'ic_launcher.png'],
      weird,
    );
    expect(typed.collectBrandDrift(f.baseDir)).toEqual([]);
  });

  test('鸿蒙两处桌面名各自点名自己的文件', () => {
    const f = fixture(neutralFixture());
    f.write(
      ['harmony', 'AppScope', 'resources', 'base', 'element', 'string.json'],
      JSON.stringify({ string: [{ name: 'app_name', value: '某某ERP' }] }),
    );
    f.write(
      ['harmony', 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json'],
      JSON.stringify({ string: [{ name: 'EntryAbility_label', value: '某某ERP' }] }),
    );
    const problems = typed.collectBrandDrift(f.baseDir);
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain(
      'harmony/AppScope/resources/base/element/string.json app_name="某某ERP"',
    );
    expect(problems.join('\n')).toContain('EntryAbility_label="某某ERP"');
  });

  test('鸿蒙 string.json 坏 JSON 也报，不静默跳过', () => {
    const f = fixture(neutralFixture());
    f.write(
      ['harmony', 'AppScope', 'resources', 'base', 'element', 'string.json'],
      '{ this is not json',
    );
    expect(typed.collectBrandDrift(f.baseDir)).toEqual([
      expect.stringContaining('解析失败或没有 app_name 项'),
    ]);
  });

  test('缺文件不报错：只校验存在的品牌落点', () => {
    const empty = fixture(newFixture());
    expect(typed.collectBrandDrift(empty.baseDir)).toEqual([]);
  });
});

describe('resolveAndroidMain', () => {
  test('新基座用 platforms/android，旧布局退回 android', () => {
    const old = fixture(newFixture());
    fs.mkdirSync(path.join(old.baseDir, 'android', 'app', 'src', 'main'), { recursive: true });
    expect(typed.resolveAndroidMain(old.baseDir)).toBe(
      path.join(old.baseDir, 'android', 'app', 'src', 'main'),
    );
  });

  test('两种布局都没有时给出 platforms/android 路径（让上层按缺文件处理）', () => {
    const bare = fixture(newFixture());
    expect(typed.resolveAndroidMain(bare.baseDir)).toBe(
      path.join(bare.baseDir, 'platforms', 'android', 'app', 'src', 'main'),
    );
  });
});

/**
 * 第二层：tracked 文本文件的违禁词扫描。
 * 词表来自本地 brand-denylist.txt（gitignore 掉），所以这里全部用 TEST_ONLY_* 人造词。
 */
describe('collectDenylistDrift', () => {
  const WORD = 'TEST_ONLY_ZULU';

  /** 建一个「有词表 + 有源码」的 git fixture，返回扫描结果。 */
  function scanFixture(denylist: string, files: Record<string, string>): DenylistResult {
    const f = fixture(newFixture());
    f.write([typed.DENYLIST_FILE], denylist);
    for (const [rel, content] of Object.entries(files)) {
      f.write(rel.split('/'), content);
    }
    gitTrack(f.baseDir);
    return typed.collectDenylistDrift(f.baseDir);
  }

  test('命中词表：报出「文件:行号 + 命中词」，让上层非 0 退出', () => {
    const r = scanFixture(`${WORD}\n`, {
      'src/config/ids.ts': `export const ok = 1;\nexport const tenantId = '${WORD}.lower';\n`,
    });
    expect(r.skipped).toBeNull();
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('src/config/ids.ts:2');
    expect(r.problems[0]).toContain(WORD);
  });

  test('没有本地词表：不报错不失败，只说明跳过源码扫描（CI 走这条）', () => {
    const f = fixture(newFixture());
    f.write(['src', 'a.ts'], `export const a = 1;\n`);
    gitTrack(f.baseDir);
    const r = typed.collectDenylistDrift(f.baseDir);
    expect(r.problems).toEqual([]);
    expect(r.skipped).toContain('未配置本地违禁词清单');
    expect(r.skipped).toContain('跳过源码扫描');
  });

  test('词表里的注释行与空行不算词条', () => {
    const f = fixture(newFixture());
    // 注释里那个词出现在源码里不该命中；真正的词条 TEST_ONLY_DELTA 没出现，也不该命中。
    f.write([typed.DENYLIST_FILE], `# 别把 ${WORD} 写进基座\n\n   \nTEST_ONLY_DELTA\n`);
    f.write(['src', 'b.ts'], `// ${WORD}\nexport const d = 1;\n`);
    gitTrack(f.baseDir);
    expect(typed.loadBrandDenylist(f.baseDir)).toEqual(['TEST_ONLY_DELTA']);
    const r = typed.collectDenylistDrift(f.baseDir);
    expect(r.problems).toEqual([]);
    expect(r.skipped).toBeNull();
  });

  test('全注释/空词表：等同没配词表，不拿空词表去扫全仓', () => {
    const f = fixture(newFixture());
    f.write([typed.DENYLIST_FILE], '# 还没填\n\n');
    f.write(['src', 'c.ts'], 'export const a = 1;\n');
    gitTrack(f.baseDir);
    const r = typed.collectDenylistDrift(f.baseDir);
    expect(r.problems).toEqual([]);
    expect(r.skipped).toContain('没有有效词条');
  });

  test('词表自身不进扫描面：否则每个词条都命中自己', () => {
    const f = fixture(newFixture());
    f.write([typed.DENYLIST_FILE], `${WORD}\n`);
    f.write(['src', 'clean.ts'], 'export const a = 1;\n');
    gitTrack(f.baseDir);
    expect(typed.collectDenylistDrift(f.baseDir).problems).toEqual([]);

    // 反证：源码真写了这个词时，只报源码那一处
    f.write(['src', 'clean.ts'], `export const id = '${WORD}';\n`);
    const hit = typed.collectDenylistDrift(f.baseDir).problems;
    expect(hit).toHaveLength(1);
    expect(hit[0]).toContain('src/clean.ts:1');
    // 带冒号才判得准：命中说明本身也会提到文件名（「来自 brand-denylist.txt」）
    expect(hit.join('\n')).not.toContain(`${typed.DENYLIST_FILE}:`);
  });

  test('匹配大小写不敏感', () => {
    const r = scanFixture('TEST_ONLY_Kilo\n', {
      'src/d.ts': `const id = 'test_only_kilo';\n`,
    });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('src/d.ts:1');
  });

  test('二进制产物扩展名不扫', () => {
    const r = scanFixture(`${WORD}\n`, {
      'assets/icon.png': `假 PNG，正文写着 ${WORD}\n`,
      'signing/release.keystore': `${WORD}\n`,
      'dist/app.apk': `${WORD}\n`,
    });
    expect(r.problems).toEqual([]);
  });

  test('非 git 环境：安全跳过并说明原因，不误报失败', () => {
    const f = fixture(neutralFixture()); // 纯临时目录，没有 .git
    f.write([typed.DENYLIST_FILE], `${WORD}\n`);
    f.write(['src', 'e.ts'], `const x = '${WORD}';\n`);
    const r = typed.collectDenylistDrift(f.baseDir);
    expect(r.problems).toEqual([]);
    expect(r.skipped).toContain('git ls-files');
    expect(r.skipped).toContain('跳过源码扫描');
  });

  test('listTrackedTextFiles 返回正斜杠相对路径，供上层拼绝对路径', () => {
    const f = fixture(newFixture());
    f.write(['src', 'nested', 'deep.ts'], 'export const a = 1;\n');
    gitTrack(f.baseDir);
    const listed = typed.listTrackedTextFiles(f.baseDir);
    expect(listed.reason).toBeNull();
    expect(listed.files).toContain('src/nested/deep.ts');
    expect(listed.files!.join('\n')).not.toContain('\\');
  });
});
