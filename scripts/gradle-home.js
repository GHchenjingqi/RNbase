/**
 * 解析基座 Android 构建使用的 Gradle 用户主目录（gradle home）。
 *
 * 为什么要显式钉住：终端里常见的 GRADLE_USER_HOME 指向其它 RN 版本的共享 home，
 * 不同 AGP 版本往同一个 caches/<ver>/transforms 写会撞
 * "The contents of the immutable workspace '…' have been modified" 而构建失败。
 *
 * 优先级：QUX_GRADLE_USER_HOME 环境变量 > platforms/android/local.properties 的
 * qux.gradleUserHome > 不覆盖（Gradle 默认）。
 * local.properties 是 gitignored 的本机文件，所以机器相关的绝对路径不会进版本库。
 */
const fs = require('fs');
const path = require('path');

/** 从 java properties 文件里取一个 key（只做本脚本需要的简单解析） */
function readProperty(file, key) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    // java properties 会把 \ 转义成 \\、: 转义成 \:
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/\\:/g, ':')
      .replace(/\\\\/g, '\\');
  }
  return null;
}

/** 返回要追加给 gradlew 的参数；未配置时返回空数组 */
function gradleHomeArgs(androidDir) {
  const fromEnv = process.env.QUX_GRADLE_USER_HOME;
  const home =
    fromEnv || readProperty(path.join(androidDir, 'local.properties'), 'qux.gradleUserHome');
  if (!home) return [];
  if (!fs.existsSync(home)) {
    console.error(
      `[gradle] gradle home 不存在: ${home}\n` +
        '  该目录用于隔离本仓的 Gradle 缓存，避免与其它 RN 版本的共享 home 撞 AGP artifact transform。\n' +
        '  请新建该目录，并把 caches/modules-2 与 wrapper/dists 用 junction 指向已有 home 的同名目录（零重下载），\n' +
        '  或在 platforms/android/local.properties 里改 qux.gradleUserHome。',
    );
    process.exit(1);
  }
  console.log(`[gradle] gradle home: ${home}`);
  return ['--gradle-user-home', home];
}

/**
 * 返回要钉住 aapt2 的 -P 参数；本机未配置 qux.aapt2FromMaven 时返回空数组（用 maven 版本）。
 *
 * 为什么要能钉：这台机子装了个机器级的 exe 包装器，会把 Gradle 从 maven 解压出来的
 * caches/<ver>/transforms/…/aapt2-…-windows/aapt2.exe 换成一个 GUI 启动器（真身改名 gaapt2.exe，
 * 旁边留个 0 字节的 gaapt2.ico）。启动器另起控制台，stdin/stdout 管道断掉，AGP 的 AAPT2 daemon
 * 拿不到握手输出，就报 "AAPT2 … Daemon startup failed / Not ready within 30 seconds"（release 打包必挂）。
 * 缓存一清、换 gradle home 都会重新解压，所以只修缓存不持久；改成指向一份可用的 aapt2 才能挡住复发。
 */
function aapt2OverrideArgs(androidDir) {
  const bin = readProperty(path.join(androidDir, 'local.properties'), 'qux.aapt2FromMaven');
  if (!bin) return [];
  if (!fs.existsSync(bin)) {
    console.error(
      `[gradle] aapt2 覆盖路径不存在: ${bin}\n` +
        '  该路径来自 platforms/android/local.properties 的 qux.aapt2FromMaven，用于绕开被安全软件替换过的 maven aapt2。\n' +
        '  请重新放一份可用的 aapt2，或删掉这行改用 maven 版本。',
    );
    process.exit(1);
  }
  console.log(`[gradle] aapt2: ${bin}`);
  return ['-Pandroid.aapt2FromMavenOverride=' + bin];
}

module.exports = { gradleHomeArgs, aapt2OverrideArgs, readProperty };
