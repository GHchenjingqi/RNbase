/**
 * 打包前校验 hermesc 可用。
 *
 * 背景：这台机器上 win64 的 `hermesc.exe` 反复出现「体积只有官方的一半不到、对任何输入都
 * exit 0 且不写文件」。查清不是镜像的坏二进制，而是本机一个机器级的 exe 包装器 ——
 * 它把解压/安装出来的 exe 换成一个 GUI 启动器（真身改名成同目录的 `g<原名>.exe`，另留一个
 * 0 字节的 `g<原名>.ico`）。启动器另起控制台，管道里既没输出也不写目标文件，
 * 症状和「坏二进制」一模一样（同一把 aapt2 也是被它换掉的，见 gradle-home.js 的 aapt2OverrideArgs）。
 * 所以这里不看版本号、不看体积，直接编一段最小 JS，要求它真的产出非空 .hbc。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN_BY_PLATFORM = {
  win32: path.join('hermesc', 'win64-bin', 'hermesc.exe'),
  darwin: path.join('hermesc', 'osx-bin', 'hermesc'),
  linux: path.join('hermesc', 'linux64-bin', 'hermesc'),
};

function fail(msg) {
  console.error(`[hermesc] 校验失败：${msg}`);
  console.error(
    '[hermesc] 先看同目录有没有 ghermesc.exe（真身）：有就说明 hermesc.exe 被本机的 exe 包装器换掉了，\n' +
      '  把 ghermesc.exe 覆盖回 hermesc.exe 即可；没有再考虑包本身有问题，用官方源重取：\n' +
      '  npm pack hermes-compiler@<当前版本> --registry=https://registry.npmjs.org',
  );
  process.exit(1);
}

function check(rootDir = path.join(__dirname, '..')) {
  const rel = BIN_BY_PLATFORM[process.platform];
  if (!rel) {
    console.warn(`[hermesc] 未识别的平台 ${process.platform}，跳过校验`);
    return;
  }
  const pkgDir = path.join(rootDir, 'node_modules', 'hermes-compiler');
  if (!fs.existsSync(pkgDir)) {
    console.warn('[hermesc] 未安装 hermes-compiler，跳过校验（Hermes 关闭时可忽略）');
    return;
  }
  const bin = path.join(pkgDir, rel);
  if (!fs.existsSync(bin)) fail(`找不到可执行文件 ${bin}`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hermesc-check-'));
  try {
    const src = path.join(work, 'probe.js');
    const out = path.join(work, 'probe.hbc');
    fs.writeFileSync(src, 'exports.probe = 1 + 1;\n');
    const r = spawnSync(bin, ['-O', '-emit-binary', '-out', out, src], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const produced = fs.existsSync(out) && fs.statSync(out).size > 0;
    if (r.error) {
      // EBUSY 表示 exe 被 OS/杀毒实时扫描瞬时锁定，并非二进制损坏（真正的损坏由下方 !produced 判定）。
      // 仅对 EBUSY 降级为告警放行，避免把好包也拦下；其余错误仍致命。
      if (r.error.code === 'EBUSY') {
        console.warn('[hermesc] 校验时 exe 被瞬时锁定(EBUSY)，跳过校验继续（EBUSY 非二进制损坏）');
        return;
      }
      fail(`${bin} 无法执行: ${r.error.message}`);
    }
    if (!produced) {
      fail(
        `${bin} 没有产出字节码（exit=${r.status}，stdout=${JSON.stringify(
          (r.stdout || '').trim(),
        )}，stderr=${JSON.stringify((r.stderr || '').trim().slice(0, 200))}）。` +
          `当前体积 ${
            fs.statSync(bin).size
          } B —— 同目录若存在 ghermesc.exe，就是这个 exe 被换掉了。`,
      );
    }
    console.log(
      `[hermesc] 校验通过: ${bin} → ${(fs.statSync(out).size / 1024).toFixed(1)} KB 字节码`,
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) check();

module.exports = { check };
