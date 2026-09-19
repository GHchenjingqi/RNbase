/**
 * 跨平台执行 Gradle 任务（Android 工程位于 platforms/android）。
 *
 * 用法：node scripts/gradle.js <gradle-task> [args...]
 *   npm run build:android          -> assembleDebug
 *   npm run build:android:release  -> assembleRelease
 *   npm run clean:android          -> clean
 *
 * 打包成功后，会把真实 APK 产物投递到 dist/<applicationId>/ 并打印完整路径
 * （按包名分目录，切换子应用后互不混淆）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveActiveApp } = require('./active-app');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: node scripts/gradle.js <gradle-task> [args...]');
  process.exit(1);
}

const androidDir = path.join(__dirname, '..', 'platforms', 'android');
const rootDir = path.join(__dirname, '..');
const logDir = path.join(rootDir, 'log');
fs.mkdirSync(logDir, { recursive: true });
const isWin = process.platform === 'win32';
const gradlew = isWin ? 'gradlew.bat' : './gradlew';

/** 基座 version.json：由 apply-app-meta.js 从活动子应用 app.config.json 派生。 */
function readVersionInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'version.json'), 'utf8'));
  } catch (e) {
    console.warn('[gradle] 读取 version.json 失败，回退到无版本号命名:', e.message);
    return null;
  }
}

/**
 * 构建产物投递：build.gradle 会把 APK 改名为 `<apkName>-<versionName>-<variant>.apk`
 * （见 android { applicationVariants.all { outputFileName } }），因此不能按固定的
 * `app-<variant>.apk` 猜路径——那样永远复制不到，交付目录留空、构建目录攒一堆同名旧包。
 *
 * 这里扫描 outputs/apk/<variant>/ 的真实产物，并用 AGP 写出的 output-metadata.json
 * 核对 versionName / versionCode / applicationId 与 version.json 一致后再复制，
 * 避免「以为是 A 的包、其实是上一个 App 的残留」。
 *
 * @returns {number} 进程退出码
 */
function collectApk(variant, versionInfo) {
  const outDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', variant);
  if (!fs.existsSync(outDir)) {
    console.error(`[APK] 未找到输出目录: ${outDir}`);
    return 1;
  }
  const apks = fs.readdirSync(outDir).filter(f => f.endsWith('.apk'));
  if (apks.length === 0) {
    console.error(`[APK] ${outDir} 下没有 APK 产物`);
    return 1;
  }

  let expected = apks[0];
  const metaFile = path.join(outDir, 'output-metadata.json');
  if (fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const element = meta.elements && meta.elements[0];
    if (element && element.outputFile) {
      expected = element.outputFile;
    }
    const problems = [];
    if (versionInfo) {
      if (element && String(element.versionName) !== String(versionInfo.versionName)) {
        problems.push(
          `versionName 不一致：APK=${element.versionName} / version.json=${versionInfo.versionName}`,
        );
      }
      if (element && Number(element.versionCode) !== Number(versionInfo.versionCode)) {
        problems.push(
          `versionCode 不一致：APK=${element.versionCode} / version.json=${versionInfo.versionCode}`,
        );
      }
      if (
        meta.applicationId &&
        versionInfo.applicationId &&
        meta.applicationId !== versionInfo.applicationId
      ) {
        problems.push(
          `applicationId 不一致：APK=${meta.applicationId} / version.json=${versionInfo.applicationId}` +
            `（活动子应用切换后需重新打包）`,
        );
      }
    }
    if (problems.length) {
      for (const p of problems) console.error(`[APK] 校验失败：${p}`);
      console.error(
        '[APK] 拒绝投递该产物。请确认已执行品牌下发（npm run app:use <name>），再重新打包。',
      );
      return 1;
    }
  }

  const src = path.join(outDir, expected);
  if (!fs.existsSync(src)) {
    console.error(`[APK] 元数据指向的产物不存在: ${src}`);
    return 1;
  }

  const appId = (versionInfo && versionInfo.applicationId) || 'default';
  const outDirForApp = path.join(rootDir, 'dist', appId);
  fs.mkdirSync(outDirForApp, { recursive: true });
  const dest = path.join(outDirForApp, expected);
  fs.copyFileSync(src, dest);
  const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
  console.log(`\n[APK] 打包完成: ${dest} (${mb} MB)`);

  const stale = apks.filter(f => f !== expected);
  if (stale.length) {
    console.log(
      `[APK] 注意：构建目录另有 ${stale.length} 个历史产物（未被本次构建刷新，勿用于交付）：\n` +
        stale.map(f => `        ${path.join(outDir, f)}`).join('\n'),
    );
  }
  return 0;
}

/** 创建一个 tee 流：同时输出到终端和日志文件（每次运行覆盖） */
function createTee(filename) {
  const stream = fs.createWriteStream(path.join(logDir, filename), {
    flags: 'w',
  });
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

console.log(`[gradle] 工作目录: ${androidDir}`);
console.log(`[gradle] 任务: ${args.join(' ')}`);
console.log(`[gradle] 日志: ${path.join(logDir, 'build.log')}`);

// 打包 APK 前，确保 H5 安全区修复已注入 h5/index.html。
// H5 每次构建会用模板覆盖 index.html，此处幂等补回，保证打进 APK 的是修复版。
// 触发范围：assemble*/install*（installDebug 内部也走 assembleDebug，同样需要注入）。
if (args.some(a => /^(assemble|install|bundle|package)/.test(a))) {
  require(path.join(__dirname, 'fix-h5-safearea.js'));

  // 打包前自动注入唯一源 api.js（scripts/api.js → 基座 h5/js/api.js 与活动子应用产物 js/api.js），
  // 保证打进 APK 的 Bridge 协议始终与基座一致（等价于先执行 node scripts/inject-h5-api.js）。
  // 子应用来自 app-registry.json，不硬编码具体工程路径。
  const { spawnSync } = require('child_process');
  const app = resolveActiveApp();
  console.log(`[gradle] 活动子应用: ${app.name}（产物 ${app.distDir}）`);
  ['h5', app.distDir].forEach(target => {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'inject-h5-api.js'), target], {
      stdio: 'inherit',
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  });
}

const buildLog = createTee('build.log');
const child = spawn(gradlew, args, {
  cwd: androidDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: isWin,
});
child.stdout.on('data', c => buildLog.write(c));
child.stderr.on('data', c => buildLog.write(c));
child.on('exit', code => {
  buildLog.end();
  if (code !== 0) {
    process.exit(code);
  }
  // assemble 任务成功后，把真实产物投递到 dist/<applicationId>/。
  const variants = { assembleDebug: 'debug', assembleRelease: 'release' };
  let exitCode = 0;
  args.forEach(task => {
    const variant = variants[task];
    if (!variant) return;
    exitCode = collectApk(variant, readVersionInfo()) || exitCode;
  });
  process.exit(exitCode);
});
