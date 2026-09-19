/**
 * 一键停止开发环境：关闭 App + 释放 Metro 端口 + 停止 Gradle 守护进程 + 清理残留构建进程。
 *
 * 用法：npm run stop
 *  - adb force-stop 关闭 App（包名取活动子应用下发的 applicationId）
 *  - 杀掉占用 8082 的进程（Metro）
 *  - gradlew --stop 停止 Gradle 守护进程
 *  - 杀掉残留的 Gradle/AAPT2 相关 java 进程（避免 AAPT2 Daemon 崩溃导致下次构建失败）
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { readApplicationId } = require('./active-app');

const isWin = process.platform === 'win32';
const PORT = 8082;
const APP_ID = readApplicationId();
const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'platforms', 'android');

/** 释放指定端口：结束占用该端口的进程，返回被结束的 PID 列表 */
function killPort(port) {
  const killed = [];
  if (isWin) {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    const lines = (out.stdout || '').split(/\r?\n/);
    const pids = new Set();
    for (const line of lines) {
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
  return killed;
}

/** 停止 Gradle 守护进程 */
function stopGradleDaemons() {
  if (!fs.existsSync(androidDir)) {
    console.log('[stop] 未找到 Android 工程目录，跳过 Gradle 停止。');
    return;
  }
  const gradlew = isWin ? 'gradlew.bat' : './gradlew';
  const gradlewPath = path.join(androidDir, gradlew);
  if (!fs.existsSync(gradlewPath)) {
    console.log('[stop] 未找到 gradlew，跳过 Gradle 停止。');
    return;
  }
  console.log('[stop] 停止 Gradle 守护进程 ...');
  const r = spawnSync(gradlew, ['--stop'], {
    cwd: androidDir,
    encoding: 'utf8',
    shell: isWin,
  });
  const output = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status === 0) {
    const lines = output.split(/\r?\n/).filter(l => l.trim());
    console.log(
      lines.length > 0 ? `[stop] ${lines[lines.length - 1]}` : '[stop] Gradle 守护进程已停止。',
    );
  } else {
    console.log('[stop] Gradle --stop 执行失败（可能无守护进程在运行）。');
  }
}

/**
 * 杀掉残留的 Gradle 构建相关 java 进程。
 * 通过命令行参数识别：包含 GradleDaemon / gradle / aapt2 的 java 进程。
 * 只杀构建相关进程，不影响用户的 IDE（Android Studio / IntelliJ）等其他 java 程序。
 */
function killResidualBuildProcesses() {
  const killed = [];
  if (isWin) {
    // Windows: 用 wmic 获取所有 java 进程的 PID 和命令行
    const out = spawnSync(
      'wmic',
      ['process', 'where', "name='java.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'],
      { encoding: 'utf8' },
    );
    const lines = (out.stdout || '').split(/\r?\n/).filter(l => l.trim());
    // CSV 格式: Node,CommandLine,ProcessId
    for (const line of lines) {
      if (line.startsWith('Node') || !line.includes(',')) continue;
      const parts = line.split(',');
      const pid = parts[parts.length - 1].trim();
      const cmd = parts.slice(1, -1).join(',').toLowerCase();
      // 识别 Gradle 守护进程和构建相关进程
      const isBuildProcess =
        cmd.includes('gradledaemon') ||
        cmd.includes('gradle.launcher') ||
        (cmd.includes('gradle') && cmd.includes('-Dorg.gradle')) ||
        cmd.includes('aapt2');
      if (isBuildProcess && pid && !isNaN(Number(pid))) {
        const r = spawnSync('taskkill', ['/f', '/pid', pid], {
          stdio: 'ignore',
        });
        if (r.status === 0) killed.push(pid);
      }
    }
  } else {
    // macOS/Linux: 用 ps 获取
    const out = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf8' });
    const lines = (out.stdout || '').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!m) continue;
      const pid = m[1];
      const cmd = m[2].toLowerCase();
      const isBuildProcess =
        cmd.includes('gradledaemon') ||
        cmd.includes('gradle.launcher') ||
        (cmd.includes('gradle') && cmd.includes('-Dorg.gradle')) ||
        cmd.includes('aapt2');
      if (isBuildProcess && cmd.includes('java')) {
        spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
        killed.push(pid);
      }
    }
  }
  return killed;
}

function main() {
  console.log('[stop] 关闭 App ...');
  const app = spawnSync('adb', ['shell', 'am', 'force-stop', APP_ID], {
    stdio: 'ignore',
    shell: isWin,
  });
  console.log(
    app.status === 0 ? '[stop] App 已关闭。' : '[stop] 未检测到设备或 App 未运行（跳过）。',
  );

  console.log(`[stop] 释放端口 ${PORT} ...`);
  const killedPort = killPort(PORT);
  console.log(
    killedPort.length > 0
      ? `[stop] 已结束 Metro 进程: ${killedPort.join(', ')}`
      : `[stop] 端口 ${PORT} 无占用。`,
  );

  // 停止 Gradle 守护进程
  stopGradleDaemons();

  // 清理残留构建进程
  console.log('[stop] 清理残留构建进程 ...');
  const killedBuild = killResidualBuildProcesses();
  console.log(
    killedBuild.length > 0
      ? `[stop] 已结束残留构建进程: ${killedBuild.join(', ')}`
      : '[stop] 无残留构建进程。',
  );

  console.log('[stop] 全部完成。下次可直接 npm run dev。');
}

main();
