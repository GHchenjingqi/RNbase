/**
 * 跨平台执行 Hvigor 任务（鸿蒙工程位于根目录 harmony/）。
 *
 * 用法：node scripts/hvigor.js <hvigor-task> [args...] [--release] [--install]
 *   npm run build:harmony          -> assembleHap (debug)
 *   npm run build:harmony:release  -> assembleHap (release)
 *   npm run install:harmony        -> assembleHap + 安装到设备/模拟器并启动
 *   npm run clean:harmony          -> clean
 *
 * 构建成功后把 HAP 复制到 dist/<applicationId>/（与 APK 同一分目录规则：
 * 切换子应用后产物互不混淆），命名沿用 `<apkName>-<versionName>-<mode>.hap`。
 *
 * 出包前先跑 scripts/harmony-ready.js 的版本闸：RNOH 与 react-native 版本不配套时
 * 直接打印判据退出，不让 hvigorw 抛「找不到 oh_modules / 未知插件」这种看不出根因的错。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertHarmonyReady, discoverTools, readBundleName } = require('./harmony-ready');
const { check: checkHermesc } = require('./check-hermesc');

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('用法: node scripts/hvigor.js <hvigor-task> [args...] [--release] [--install]');
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const logDir = path.join(rootDir, 'log');
fs.mkdirSync(logDir, { recursive: true });
const isWin = process.platform === 'win32';

const isRelease = argv.includes('--release');
const wantInstall = argv.includes('--install');
const tasks = argv.filter(a => !a.startsWith('--'));

/** Metro 端口，与 scripts/dev.js / gradle.js 保持一致；设备上 RNOH 固定请求 8081。 */
const METRO_PORT = 8082;
/** 宿主机 vite（debug 下 H5 走它），与 src/app/resolve-h5-entry.ts 的 HARMONY_DEV_ENTRY 对齐。 */
const H5_DEV_PORT = 5173;

const tools = discoverTools(rootDir);
const { harmonyDir } = tools;

function readVersionInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'version.json'), 'utf8'));
  } catch (e) {
    console.warn('[hvigor] 读取 version.json 失败，回退到无版本号命名:', e.message);
    return null;
  }
}

/** HAP 文件名前缀与 APK 同源（version.json 的 apkName），没有 version.json 时退回包名。 */
function artifactName(versionInfo) {
  const fallback = require(path.join(rootDir, 'package.json')).name || 'app';
  return (versionInfo && versionInfo.apkName) || fallback;
}

function hapFileName(versionInfo) {
  const mode = isRelease ? 'release' : 'debug';
  const name = artifactName(versionInfo);
  return versionInfo && versionInfo.versionName
    ? `${name}-${versionInfo.versionName}-${mode}.hap`
    : `${name}-${mode}.hap`;
}

function createTee(filename) {
  const stream = fs.createWriteStream(path.join(logDir, filename), { flags: 'w' });
  return {
    write(chunk) {
      process.stdout.write(chunk);
      stream.write(chunk);
    },
    end() {
      stream.end();
    },
  };
}

/**
 * hvigor 子进程环境：缺 DEVECO_SDK_HOME / NODE_HOME 时 hvigorw 直接失败。
 * 这几个开关都是本机踩出来的，删任一条都会以看不懂的方式挂掉：
 */
function toolEnv() {
  const env = { ...process.env };
  if (tools.sdkHome && !env.DEVECO_SDK_HOME) env.DEVECO_SDK_HOME = tools.sdkHome;
  if (tools.nodeHome && !env.NODE_HOME) env.NODE_HOME = tools.nodeHome;
  // ohpm.bat / hvigorw.bat 用 if "%OS%"=="Windows_NT" 决定是否 setlocal enabledelayedexpansion；
  // OS 缺失时其内部 !VAR! 不展开，会在字符裁剪循环里无限递归（BATCH RECURSION exceeds STACK limits）。
  if (isWin && !env.OS) env.OS = 'Windows_NT';
  // release 包由 hvigor 插件调 `react-native bundle-harmony` 生成 HBC。RN 0.84 的 hermesc 在
  // hermes-compiler 包里，而该 CLI 只认这个环境变量来决定路径；不设则去找
  // react-native/sdks/hermesc（0.84 已无此目录）并报 "Couldn't find hermesc"。
  if (!env.HERMES_V1_ENABLED) env.HERMES_V1_ENABLED = 'true';
  // RNOH 原生库默认开 LTO + PGO（CMake 的 ENABLE_COMPILE_OPTIMIZATIONS=ON），单个 clang++
  // 可达 1-2GB；按 24 核并发直接在 arm64 编译期 OOM（本机 32GB 实测）。
  // 这里限制原生编译并发，可用 HVIGOR_JOBS 覆盖，设成 0 表示不干预。
  const jobs = process.env.HVIGOR_JOBS || '6';
  if (Number(jobs) > 0 && !env.CMAKE_BUILD_PARALLEL_LEVEL) {
    env.CMAKE_BUILD_PARALLEL_LEVEL = jobs;
  }
  const binDirs = [tools.nodeHome, tools.hdc && path.dirname(tools.hdc)].filter(Boolean);
  if (binDirs.length) {
    const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
    env[key] = [...binDirs, env[key]].join(path.delimiter);
  }
  return env;
}

/**
 * build-profile.json5 含各人独立的签名配置，按 RNOH 模板约定不入库；
 * 首次构建时从模板生成，避免新克隆直接报错。
 */
function ensureBuildProfile() {
  const target = path.join(harmonyDir, 'build-profile.json5');
  if (fs.existsSync(target)) return;
  const template = path.join(harmonyDir, 'build-profile.template.json5');
  if (!fs.existsSync(template)) {
    console.error(`[hvigor] 缺少 ${target}，且未找到模板 ${template}`);
    process.exit(1);
  }
  fs.copyFileSync(template, target);
  console.log(
    '[hvigor] 已从模板生成 harmony/build-profile.json5（未配置签名，产物为 unsigned HAP）',
  );
}

/**
 * 鸿蒙离线 H5 包：把根目录 h5/ 快照（与安卓 APK assets 同一份产物）拷进 HAP 的 rawfile 资源树。
 *
 * 移植版 webview 自带映射：`asset://X` → `$rawfile(getAssetsDest() + X)`，
 * DEFAULT_ASSETS_DEST = 'assets/'，即 entry/src/main/resources/rawfile/assets/。
 * 这里刻意放进 assets/h5/ 子目录：bundle-harmony 也会往 rawfile/assets/ 写 RN 图片资源，
 * 分目录互不干扰，且 JS 侧入口固定为 `asset://h5/index.html`（resolve-h5-entry.ts）。
 *
 * 每次先清空再拷：vite 产物文件名带内容 hash，增量覆盖会让旧 chunk 永久留在包里。
 */
function ensureHarmonyH5Assets() {
  const srcDir = path.join(rootDir, 'h5');
  const destDir = path.join(
    harmonyDir,
    'entry',
    'src',
    'main',
    'resources',
    'rawfile',
    'assets',
    'h5',
  );
  if (!fs.existsSync(path.join(srcDir, 'index.html'))) {
    console.error(
      `[hvigor] 缺少 ${path.join(srcDir, 'index.html')}，鸿蒙离线包无法构建。\n` +
        '[hvigor] 请先同步子应用产物：npm run app:use <子应用> -- --sync（或先 npm run build:h5）',
    );
    process.exit(1);
  }

  let files = 0;
  let bytes = 0;
  let newest = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      const st = fs.statSync(p);
      files += 1;
      bytes += st.size;
      newest = Math.max(newest, st.mtimeMs);
    }
  })(srcDir);

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true });

  const built = new Date(newest);
  const ageDays = (Date.now() - newest) / 86400000;
  console.log(
    `[hvigor] H5 离线包: h5/ -> resources/rawfile/assets/h5/ ` +
      `(${files} 个文件 / ${(bytes / 1048576).toFixed(2)} MB，` +
      `快照构建于 ${built.toISOString().slice(0, 16).replace('T', ' ')})`,
  );
  if (ageDays > 3) {
    console.warn(
      `[hvigor] 提醒: h5/ 快照已 ${ageDays.toFixed(1)} 天未更新，` +
        '如与 H5 源码不一致请在子应用重跑 npm run sync:base',
    );
  }
}

/**
 * DevEco 的 CLI 都是 .bat 且安装路径含空格。Node 会对 spawn 的参数逐个转义，
 * 内层引号被写成 \" 后 cmd 认不出路径，因此 Windows 下拼成整条命令串并交给 shell 执行。
 */
function toCommand(exe, args) {
  if (!isWin) return { cmd: exe, args, opts: {} };
  const line = [`"${exe}"`, ...args.map(a => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
  return { cmd: line, args: [], opts: { shell: true } };
}

/** oh_modules 是 hvigor 解析 @rnoh/react-native-openharmony 等 HAR 依赖的前提。 */
function ensureOhModules() {
  if (fs.existsSync(path.join(harmonyDir, 'oh_modules'))) return;
  if (!tools.ohpm) {
    console.error('[hvigor] 未找到 ohpm，请先设置 OHPM 环境变量或安装 DevEco Studio');
    process.exit(1);
  }
  console.log(`[hvigor] oh_modules 缺失，执行 ohpm install: ${tools.ohpm}`);
  const cmd = toCommand(tools.ohpm, ['install']);
  const r = spawnSync(cmd.cmd, cmd.args, {
    cwd: harmonyDir,
    stdio: 'inherit',
    env: toolEnv(),
    ...cmd.opts,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function bundleName() {
  const name = readBundleName(rootDir);
  if (!name) {
    console.error('[hvigor] harmony/AppScope/app.json5 未找到 bundleName');
    process.exit(1);
  }
  return name;
}

/**
 * debug 包运行要的两条设备侧端口反向转发（幂等）：
 *  - 设备 8081 -> 宿主机 Metro：RN bundle 从 Metro 拉；
 *  - 设备 5173 -> 宿主机 vite：src/app/resolve-h5-entry.ts 的 HARMONY_DEV_ENTRY 就是
 *    http://127.0.0.1:5173/，缺这条则 H5 永远等不到 app.ready，停在基座诊断页。
 * 安卓侧的等价物是 scripts/dev.js 里的 adb reverse，两端都要有 5173 这条，行为才一致。
 * release 包读包内离线包，这两条都用不上，但配上也不影响。
 */
function ensureDevForwards() {
  if (!tools.hdc) return;
  const mappings = [
    ['tcp:8081', `tcp:${METRO_PORT}`],
    [`tcp:${H5_DEV_PORT}`, `tcp:${H5_DEV_PORT}`],
  ];
  for (const [remote, local] of mappings) {
    const cmd = toCommand(tools.hdc, ['rport', remote, local]);
    const r = spawnSync(cmd.cmd, cmd.args, { encoding: 'utf8', env: toolEnv(), ...cmd.opts });
    // hdc 即使没配成功也返回 0，失败只体现在输出里的 [Fail]；重复注册同一端口就是这个情况。
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    if (r.status === 0 && !/\[Fail\]/i.test(out)) {
      console.log(`[hvigor] hdc rport ${remote} -> ${local} 已配置`);
    } else {
      console.warn(
        `[hvigor] hdc rport ${remote} -> ${local} 未新注册` +
          `（端口已被本次开机占用则属正常，重启模拟器后必须重跑）: ${out || '(无输出)'}`,
      );
    }
  }
}

function installAndStart(hapPath) {
  if (!tools.hdc) {
    console.error('[hvigor] 未找到 hdc，无法安装；请设置 HDC 环境变量');
    process.exit(1);
  }
  const remote = `/data/local/tmp/${artifactName(readVersionInfo())}.hap`;
  const run = args => {
    const cmd = toCommand(tools.hdc, args);
    const r = spawnSync(cmd.cmd, cmd.args, { encoding: 'utf8', env: toolEnv(), ...cmd.opts });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    // 同样不能只看 exit code：hdc 失败也回 0。
    if (r.status !== 0 || /\[Fail\]/i.test(out)) {
      console.error(`[hvigor] hdc ${args.join(' ')} 失败: ${out || '(无输出)'}`);
      process.exit(r.status ?? 1);
    }
    if (out) console.log(`[hvigor] ${out}`);
  };
  ensureDevForwards();
  run(['file', 'send', hapPath, remote]);
  run(['shell', 'bm', 'install', '-p', remote]);
  run(['shell', 'aa', 'start', '-a', 'EntryAbility', '-b', bundleName()]);
  console.log(
    '[hvigor] 已安装并启动（debug 包需 Metro 处于运行状态，鸿蒙侧用 npm run dev:harmony 起）',
  );
}

/**
 * 与安卓打包链对齐：出包前把 h5/ 快照修到「可交付」状态（安全区注入 + api.js 唯一源），
 * 并先验 hermesc —— 坏 hermesc 会打出「构建成功」但没有字节码的 release 包。
 */
function prepareH5Snapshot() {
  checkHermesc(rootDir);
  require(path.join(__dirname, 'fix-h5-safearea.js'));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'inject-h5-api.js'), 'h5'], {
    stdio: 'inherit',
    cwd: rootDir,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

assertHarmonyReady(rootDir, 'hvigor');
ensureBuildProfile();
ensureOhModules();
// 只有出包任务需要离线 H5；clean 等非打包任务不该被 h5/ 快照缺失卡住。
if (tasks.some(t => /assembleHap|packageHap|^build$/.test(t))) {
  prepareH5Snapshot();
  ensureHarmonyH5Assets();
}

if (!tools.hvigorw) {
  console.error('[hvigor] 未找到 hvigorw，请设置 DEVECO_HOME 或 HVIGORW 环境变量');
  process.exit(1);
}

const buildArgs = [
  ...tasks,
  '--mode',
  'module',
  '-p',
  'product=default',
  '-p',
  `buildMode=${isRelease ? 'release' : 'debug'}`,
  '--no-daemon',
];

console.log(`[hvigor] 工作目录: ${harmonyDir}`);
console.log(
  `[hvigor] 工具链: hvigorw=${tools.hvigorw || '(未找到)'} ` +
    `NODE_HOME=${tools.nodeHome || '(未设置)'} ` +
    `DEVECO_SDK_HOME=${tools.sdkHome || '(未设置)'} hdc=${tools.hdc || '(未设置)'}`,
);
console.log(`[hvigor] 命令: ${tools.hvigorw} ${buildArgs.join(' ')}`);
console.log(`[hvigor] 目标 bundleName: ${bundleName()}`);
console.log(`[hvigor] 日志: ${path.join(logDir, 'hvigor.log')}`);

const buildLog = createTee('hvigor.log');
const buildCmd = toCommand(tools.hvigorw, buildArgs);
const child = spawn(buildCmd.cmd, buildCmd.args, {
  cwd: harmonyDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: toolEnv(),
  ...buildCmd.opts,
});
child.stdout.on('data', c => buildLog.write(c));
child.stderr.on('data', c => buildLog.write(c));
child.on('exit', code => {
  buildLog.end();
  if (code !== 0) {
    console.log(`[hvigor] 失败 (exit ${code})`);
    process.exit(code ?? 1);
  }
  if (!tasks.some(t => /assembleHap|packageHap/.test(t))) return;

  const outDirHap = path.join(harmonyDir, 'entry', 'build', 'default', 'outputs', 'default');
  const signedPath = path.join(outDirHap, 'entry-default-signed.hap');
  const hapPath = [signedPath, path.join(outDirHap, 'entry-default-unsigned.hap')].find(p =>
    fs.existsSync(p),
  );
  if (!hapPath) {
    console.log(`[HAP] 未找到产物目录中的 .hap: ${outDirHap}`);
    return;
  }
  const versionInfo = readVersionInfo();
  const appId = (versionInfo && versionInfo.applicationId) || 'default';
  const outDir = path.join(rootDir, 'dist', appId);
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, hapFileName(versionInfo));
  fs.copyFileSync(hapPath, dest);
  const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
  console.log(`\n[HAP] 打包完成: ${dest} (${mb} MB)`);
  if (hapPath !== signedPath) {
    console.log(
      '[HAP] 注意: 这是未签名包，只有模拟器接受，真机会验签失败。' +
        '签名材料请填 harmony/build-profile.json5 的 signingConfigs（该文件不入库，密码不会泄漏到仓库）。',
    );
  }
  if (wantInstall) installAndStart(dest);
});
