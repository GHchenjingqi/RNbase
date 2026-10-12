/**
 * 释放被占用的端口：结束在该端口上 LISTENING 的进程**及其子进程**。
 *
 * dev.js 起 Metro 之前先腾端口，stop.js 收尾时结束 Metro。
 * 8082 上残留上一趟没退干净的 Metro 时，新起的那个会直接失败。
 */
const { spawnSync } = require('child_process');

const isWin = process.platform === 'win32';

/** 进程是否还活着（Windows 上 signal 0 只做存在性检查） */
function isAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** 释放指定端口：结束占用该端口的进程，返回被结束的 PID 列表 */
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
      // /t 连子进程一起结束：Metro 的 transform worker 挂在这个监听进程下面，
      // 只杀它自己会把 worker 全变成孤儿（每个还占一个控制台窗口）。
      const r = spawnSync('taskkill', ['/t', '/f', '/pid', pid], { stdio: 'ignore' });
      if (r.status === 0) {
        killed.push(pid);
      } else if (isAlive(pid)) {
        // taskkill 失败但进程还在 —— 别谎报已释放，否则下一趟 Metro 依旧起不来
        console.warn(
          `[free-port] taskkill /t /pid ${pid} 未成功（exit ${r.status}），请手动结束该进程树`,
        );
      } else {
        killed.push(pid);
      }
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
    console.log(`[free-port] 已释放端口 ${port}（结束进程: ${killed.join(', ')}）`);
  }
  return killed;
}

module.exports = { killPort };
