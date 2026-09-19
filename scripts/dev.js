/**
 * 一键启动编译环境：后台拉起 Metro(8082) + 构建安装 Android App。
 *
 * 用法：npm run dev
 *  - 启动前自动释放 8082 端口（结束占用进程），避免端口冲突；
 *  - 自动等待 Metro 就绪后再执行 gradlew installDebug；
 *  - Metro 保持前台运行，可按 Ctrl+C 一并停止。
 */
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { resolveActiveApp, readApplicationId } = require('./active-app');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'platforms', 'android');
const logDir = path.join(root, 'log');
fs.mkdirSync(logDir, { recursive: true });
const isWin = process.platform === 'win32';
const PORT = 8082;

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

/** 释放指定端口：结束占用该端口的进程（Windows: netstat+taskkill；Unix: lsof+kill） */
function killPort(port) {
  const killed = [];
  if (isWin) {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    const lines = (out.stdout || '').split(/\r?\n/);
    const pids = new Set();
    for (const line of lines) {
      // TCP 0.0.0.0:8082 0.0.0.0:0 LISTENING 12345
      const m = line.match(/TCP\s+[^\s]+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (m && Number(m[1]) === port && m[2] !== '0') pids.add(m[2]);
    }
    for (const pid of pids) {
      spawnSync('taskkill', ['/f', '/pid', pid], { stdio: 'ignore' });
      killed.push(pid);
    }
  } else {
    const out = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
    const pids = (out.stdout || '').split(/\s+/).filter(Boolean);
    for (const pid of pids) {
      spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
      killed.push(pid);
    }
  }
  if (killed.length > 0) {
    console.log(`[dev] 已释放端口 ${port}（结束进程: ${killed.join(', ')}）`);
  }
}

/** 检测是否有已连接的 Android 设备（adb devices 状态为 device） */
function hasConnectedDevice() {
  const out = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  const lines = (out.stdout || '').split(/\r?\n/);
  return lines.some(l => /^\S+\s+device$/.test(l.trim()));
}

/** 配置 adb reverse 端口转发：模拟器 8081/8082 -> 宿主机 8082（Metro）
 *  adb reverse 是临时的，设备重启或 adb 重连后会丢失，因此每次 dev 启动时自动设置。
 *  应用内 JS bundle 默认走 8081（通过 reverse 转发到 8082），H5 资源也走相同端口。
 */
function setupAdbReverse() {
  const mappings = [
    ['tcp:8081', `tcp:${PORT}`],
    [`tcp:${PORT}`, `tcp:${PORT}`],
  ];
  for (const [remote, local] of mappings) {
    const r = spawnSync('adb', ['reverse', remote, local], {
      encoding: 'utf8',
    });
    if (r.status === 0) {
      console.log(`[dev] adb reverse ${remote} -> ${local} 已配置`);
    } else {
      console.warn(`[dev] adb reverse ${remote} -> ${local} 配置失败: ${r.stderr || r.stdout}`);
    }
  }
}

function metroReady() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/status`, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve(body.includes('running')));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForMetro(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await metroReady()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  console.log(`[dev] 检查端口 ${PORT} ...`);
  killPort(PORT);
  await new Promise(r => setTimeout(r, 800)); // 等待端口完全释放
  console.log(`[dev] 启动 Metro dev server (port ${PORT}) ...`);
  const metroLog = createTee('metro.log');
  const metro = spawn(
    isWin ? 'npx.cmd' : 'npx',
    ['react-native', 'start', '--port', String(PORT)],
    { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], shell: isWin },
  );
  metro.stdout.on('data', c => metroLog.write(c));
  metro.stderr.on('data', c => metroLog.write(c));

  console.log('[dev] 等待 Metro 就绪 ...');
  const ready = await waitForMetro(90000);
  if (!ready) {
    console.error('[dev] Metro 未在预期时间内就绪，请检查端口占用或依赖安装。');
    metro.kill();
    process.exit(1);
  }
  console.log('[dev] Metro 就绪，检查设备 ...');
  if (!hasConnectedDevice()) {
    console.error(
      '[dev] 未检测到 Android 设备！请先启动模拟器（Pixel_10）或连接真机，再重新运行 npm run dev。',
    );
    console.error('[dev] Metro 仍在运行，可在启动设备后直接重试。');
    process.exit(1);
  }
  console.log('[dev] 设备就绪，配置 adb reverse 端口转发 ...');
  setupAdbReverse();

  // 打包前自动注入唯一源 api.js（scripts/api.js → 基座 h5/js/api.js 与活动子应用产物 js/api.js），
  // 保证打进 APK 的 Bridge 协议始终与基座一致（等价于先执行 node scripts/inject-h5-api.js）。
  // 同时补回安全区修复（sync 覆盖 index.html 后幂等重注入）。
  console.log('[dev] 注入唯一源 api.js + 安全区修复 ...');
  require(path.join(__dirname, 'fix-h5-safearea.js'));
  const injectH5Api = path.join(__dirname, 'inject-h5-api.js');
  const app = resolveActiveApp();
  console.log(`[dev] 活动子应用: ${app.name}（产物 ${app.distDir}）`);
  ['h5', app.distDir].forEach(target => {
    const r = spawnSync(process.execPath, [injectH5Api, target], {
      stdio: 'inherit',
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  });

  console.log('[dev] 开始构建安装 Android App ...');

  const gradlew = isWin ? 'gradlew.bat' : './gradlew';
  const devLog = createTee('dev.log');
  const build = spawn(gradlew, ['installDebug'], {
    cwd: androidDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
  });
  build.stdout.on('data', c => devLog.write(c));
  build.stderr.on('data', c => devLog.write(c));
  build.on('exit', code => {
    devLog.end();
    if (code === 0) {
      console.log('[dev] 安装完成，启动 App ...');
      // 包名（applicationId）由子应用下发，与源码 namespace（com.qux，MainActivity 实际所在包）
      // 不同，必须写成 <applicationId>/<全限定类名>，否则切包名后 am start 找不到 Activity。
      const appId = readApplicationId();
      const launch = spawn('adb', ['shell', 'am', 'start', '-n', `${appId}/com.qux.MainActivity`], {
        stdio: 'inherit',
        shell: isWin,
      });
      launch.on('exit', () => {
        console.log('[dev] App 已启动。Metro 仍在运行，可按 Ctrl+C 停止。');
        // 不调用 process.exit：保持 Metro 子进程运行，父进程随 Metro 生命周期存活
      });
    } else {
      console.log(`[dev] 构建/安装失败 (exit ${code})。`);
      process.exit(code ?? 1);
    }
  });
}

main();
