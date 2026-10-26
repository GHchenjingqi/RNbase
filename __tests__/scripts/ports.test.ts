/**
 * 开发期端口单一真源（ports.json）的守卫单测。
 *
 * 为什么要守：Metro / vite 与设备侧映射端口以前散在 6 个脚本和 src/config 里，
 * 同一个含义写了好几处。改一处忘另一处不会报错，只会让 `adb reverse` / `hdc rport`
 * 拼出指错方向的映射，表现为「脚本说一切正常，设备拿到旧端口」。
 * 更阴的一种是漏键：`tcp:undefined` 是合法字符串，命令照样退 0。
 *
 * 所以两层都要钉：
 *   1) ports.json 的键齐全且端口合法（读取器自己会拒，这里验它真的会拒）；
 *   2) 仓库里除 ports.json 之外，代码（注释除外）不许再出现裸端口字面量。
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const ports = require('../../scripts/ports.js');

type PortsModule = {
  PORTS_FILE: string;
  REQUIRED_KEYS: string[];
  ports: Record<string, string | number>;
  METRO_HOST_PORT: number;
  METRO_DEVICE_PORT: number;
  H5_DEV_PORT: number;
  ANDROID_EMULATOR_HOST_IP: string;
  loadPorts: () => Record<string, string | number>;
};

const mod = ports as PortsModule;

/** 端口数字键（其余是地址字符串）。 */
const NUMERIC_KEYS = mod.REQUIRED_KEYS.filter(k => k !== 'androidEmulatorHostIp');

describe('ports.json 的读取与校验', () => {
  it('出厂 ports.json 键齐全、端口合法，且导出与 JSON 一一对应', () => {
    const raw = JSON.parse(fs.readFileSync(mod.PORTS_FILE, 'utf8'));
    for (const key of mod.REQUIRED_KEYS) {
      expect(raw[key]).toBeDefined();
    }
    for (const key of NUMERIC_KEYS) {
      expect(Number.isInteger(raw[key])).toBe(true);
      expect(raw[key]).toBeGreaterThanOrEqual(1);
      expect(raw[key]).toBeLessThanOrEqual(65535);
    }
    // 模拟器回环地址写错（比如漏了末段）不会让任何命令失败，只会让 dev 直连静默失效。
    expect(raw.androidEmulatorHostIp).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    expect(mod.METRO_HOST_PORT).toBe(raw.metroHostPort);
    expect(mod.METRO_DEVICE_PORT).toBe(raw.metroDevicePort);
    expect(mod.H5_DEV_PORT).toBe(raw.h5DevPort);
    expect(mod.ANDROID_EMULATOR_HOST_IP).toBe(raw.androidEmulatorHostIp);
  });

  it('Metro 的设备侧端口与宿主机端口是两个值：设备上固定请求前者', () => {
    // 这两个值一旦相同，adb reverse / hdc rport 就成了自映射，dev 直连在真机上静默失败。
    expect(mod.METRO_DEVICE_PORT).not.toBe(mod.METRO_HOST_PORT);
  });

  it('漏键直接抛：不能让 tcp:undefined 拼进转发命令', () => {
    expect(() => loadFrom({ metroDevicePort: null })).toThrow(/缺少键/);
    // 全缺：报错要把缺的键逐个点名，否则改 ports.json 的人不知道少了哪一个。
    const allMissing = Object.fromEntries(mod.REQUIRED_KEYS.map(k => [k, undefined]));
    expect(() => loadFrom(allMissing)).toThrow(`缺少键：${mod.REQUIRED_KEYS.join(', ')}`);
  });

  it('端口越界 / 非整数直接抛', () => {
    expect(() => loadFrom({ h5DevPort: 0 })).toThrow(/端口非法/);
    expect(() => loadFrom({ h5DevPort: 70000 })).toThrow(/端口非法/);
    expect(() => loadFrom({ metroHostPort: 1.5 })).toThrow(/端口非法/);
  });

  it('ports.json 读不到时报错点名文件，而不是静默给默认值', () => {
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(() => mod.loadPorts()).toThrow(/读取 .*ports\.json 失败/);
    spy.mockRestore();
  });
});

/** 用给定覆盖值伪造一份 ports.json 内容，重新走一遍读取校验。 */
function loadFrom(overrides: Record<string, unknown>): Record<string, string | number> {
  const base = JSON.parse(fs.readFileSync(mod.PORTS_FILE, 'utf8'));
  const merged = { ...base, ...overrides };
  const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => JSON.stringify(merged));
  try {
    return mod.loadPorts();
  } finally {
    spy.mockRestore();
  }
}

describe('端口字面量不得散落在代码里', () => {
  const LITERAL = /(?<![\d.])(8081|8082|5173|10\.0\.2\.2)(?![\d.])/;

  function listSourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (/\.(ts|tsx|js)$/.test(entry.name)) out.push(abs);
      }
    };
    walk(path.join(ROOT, 'scripts'));
    walk(path.join(ROOT, 'src'));
    return out;
  }

  /** 去掉注释，只留代码：注释里写「8082 上残留旧 Metro」是给人看的，不是第二处真源。 */
  function stripComments(source: string): string {
    let out = '';
    let quote: string | null = null;
    let line = false;
    let block = false;
    for (let i = 0; i < source.length; i += 1) {
      const c = source[i];
      const next = source[i + 1];
      if (line) {
        if (c === '\n') {
          line = false;
          out += c;
        }
        continue;
      }
      if (block) {
        // 保留换行，命中行号才对得上源文件
        if (c === '\n') out += c;
        if (c === '*' && next === '/') {
          block = false;
          i += 1;
        }
        continue;
      }
      if (quote) {
        out += c;
        if (c === '\\') {
          out += source[++i] ?? '';
        } else if (c === quote) {
          quote = null;
        }
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        out += c;
        continue;
      }
      if (c === '/' && next === '/') {
        line = true;
        i += 1;
        continue;
      }
      if (c === '/' && next === '*') {
        block = true;
        i += 1;
        continue;
      }
      out += c;
    }
    return out;
  }

  it('scripts/ 与 src/ 的代码里不含裸端口/模拟器地址字面量（真源只有 ports.json）', () => {
    const hits: string[] = [];
    for (const file of listSourceFiles()) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      code.split('\n').forEach((row, i) => {
        if (LITERAL.test(row)) {
          hits.push(`${path.relative(ROOT, file)}:${i + 1} ${row.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
