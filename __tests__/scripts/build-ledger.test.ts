/**
 * 出包台账与 release 版本码闸门单测。
 *
 * 要防的事故：同一 applicationId 连着出两个相同 versionCode 的 release 包——
 * 装机端判成同版本、市场驳回，而产物文件名里看不出来。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const ledger = require('../../scripts/build-ledger.js');
const typed = ledger as {
  ledgerFile: (rootDir: string, applicationId: string) => string;
  readLedger: (file: string) => object[];
  lastReleaseCode: (entries: { mode: string; versionCode: number }[]) => number | null;
  checkReleaseVersionCode: (
    rootDir: string,
    opts: { applicationId: string; versionCode: number | string },
  ) => { allow: boolean; last: number | null; problem: string };
  appendBuild: (rootDir: string, entry: Record<string, unknown>) => string | null;
};

const TMP: string[] = [];
function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-ledger-'));
  TMP.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TMP) fs.rmSync(dir, { recursive: true, force: true });
});

describe('checkReleaseVersionCode', () => {
  test('没有台账时放行（第一次出包）', () => {
    expect(
      typed.checkReleaseVersionCode(tempRoot(), { applicationId: 'com.qux', versionCode: 1 }),
    ).toEqual({
      allow: true,
      last: null,
      problem: '',
    });
  });

  test('与上次 release 同版本码：拒绝，且把「先 bump」写进提示', () => {
    const root = tempRoot();
    typed.appendBuild(root, {
      artifact: 'A-1.0.6-release.apk',
      mode: 'release',
      applicationId: 'com.qux',
      versionName: '1.0.6',
      versionCode: 7,
    });
    const verdict = typed.checkReleaseVersionCode(root, {
      applicationId: 'com.qux',
      versionCode: 7,
    });
    expect(verdict.allow).toBe(false);
    expect(verdict.last).toBe(7);
    expect(verdict.problem).toContain('不大于上一次 release 的 7');
    expect(verdict.problem).toContain('npm run version:bump');
  });

  test('比上次 release 大：放行', () => {
    const root = tempRoot();
    typed.appendBuild(root, {
      mode: 'release',
      applicationId: 'com.qux',
      versionCode: 7,
      artifact: 'x',
    });
    expect(
      typed.checkReleaseVersionCode(root, { applicationId: 'com.qux', versionCode: 8 }).allow,
    ).toBe(true);
  });

  test('倒退同样拒绝', () => {
    const root = tempRoot();
    typed.appendBuild(root, {
      mode: 'release',
      applicationId: 'com.qux',
      versionCode: 12,
      artifact: 'x',
    });
    expect(
      typed.checkReleaseVersionCode(root, { applicationId: 'com.qux', versionCode: 11 }).allow,
    ).toBe(false);
  });

  test('debug 记录不参与比较（重装 debug 包是日常）', () => {
    const root = tempRoot();
    typed.appendBuild(root, {
      mode: 'debug',
      applicationId: 'com.qux',
      versionCode: 7,
      artifact: 'x',
    });
    const verdict = typed.checkReleaseVersionCode(root, {
      applicationId: 'com.qux',
      versionCode: 7,
    });
    expect(verdict.allow).toBe(true);
    expect(verdict.last).toBeNull();
  });

  test('按 applicationId 隔离：不同租户互不影响', () => {
    const root = tempRoot();
    typed.appendBuild(root, {
      mode: 'release',
      applicationId: 'com.qux.a',
      versionCode: 9,
      artifact: 'x',
    });
    expect(
      typed.checkReleaseVersionCode(root, { applicationId: 'com.qux.b', versionCode: 1 }).allow,
    ).toBe(true);
  });

  test('非法版本码直接拒（version.json 被写坏时不该继续出包）', () => {
    for (const bad of [0, -1, 1.5, 'x']) {
      const verdict = typed.checkReleaseVersionCode(tempRoot(), {
        applicationId: 'com.qux',
        versionCode: bad as never,
      });
      expect(verdict.allow).toBe(false);
      expect(verdict.problem).toContain('非法');
    }
  });

  test('台账坏了当成空表，不反过来挡住出包', () => {
    const root = tempRoot();
    const file = typed.ledgerFile(root, 'com.qux');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json', 'utf8');
    expect(
      typed.checkReleaseVersionCode(root, { applicationId: 'com.qux', versionCode: 3 }).allow,
    ).toBe(true);
  });
});

describe('appendBuild', () => {
  test('落到 dist/<applicationId>/.builds.json 并可回读', () => {
    const root = tempRoot();
    const file = typed.appendBuild(root, {
      mode: 'release',
      applicationId: 'com.qux',
      versionCode: 3,
      versionName: '1.0.3',
      artifact: 'RNBase-1.0.3-release.apk',
    });
    expect(file).toBe(path.join(root, 'dist', 'com.qux', '.builds.json'));
    const entries = typed.readLedger(file!) as { at: string; versionCode: number }[];
    expect(entries).toHaveLength(1);
    expect(entries[0].versionCode).toBe(3);
    expect(Date.parse(entries[0].at)).not.toBeNaN();
  });

  test('lastReleaseCode 取最大值而不是最后一条', () => {
    expect(
      typed.lastReleaseCode([
        { mode: 'release', versionCode: 9 },
        { mode: 'release', versionCode: 11 },
        { mode: 'debug', versionCode: 99 },
      ]),
    ).toBe(11);
    expect(typed.lastReleaseCode([])).toBeNull();
  });
});
