/**
 * 子进程日志的 tee：同时写终端与 log/<filename>（每次运行覆盖）。
 *
 * 终端那一侧必须允许「随时消失」，因为那不代表构建失败：
 *  - RNBuild Studio / CI 用管道读 stdout，用户切页、关窗，或命令行被 `| head`
 *    截断，读端一关，再写就触发 EPIPE；
 *  - 桌面端按了「停止」，管道同样立刻断开。
 *
 * EPIPE 是 socket 上 emit 的 'error' 事件，没有任何监听时 Node 直接抛
 * uncaughtException，包装进程当场崩掉——gradle / hvigor 子进程被丢下，
 * 现象是「打包报错」，可构建本身往往还在跑、甚至已经跑完，只是没人收尾
 * （APK 不投递、dist 为空）。所以这里把终端侧的 EPIPE 吞掉：
 * 断了就只记文件，构建照常跑完、照常收尾。
 */
const fs = require('fs');
const path = require('path');

/** 日志目录（四个脚本共用 <root>/log）。 */
const LOG_DIR = path.join(__dirname, '..', 'log');

/**
 * 「读端没了」可以忽略；其它 IO 错误（磁盘满、权限）不能静默，照样抛出去。
 * @param {NodeJS.EventEmitter & {on: Function}} stream
 */
function onStreamError(stream) {
  stream.on('error', err => {
    if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) {
      return;
    }
    throw err;
  });
}

let stdioGuarded = false;
/** 给 process.stdout / stderr 装上 EPIPE 兜底（只需一次）。 */
function guardStdio() {
  if (stdioGuarded) {
    return;
  }
  stdioGuarded = true;
  onStreamError(process.stdout);
  onStreamError(process.stderr);
}

/**
 * @param {string} filename log/ 下的文件名
 * @returns {{write: (chunk: any) => void, end: () => void}}
 */
function createTee(filename) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  guardStdio();

  const stream = fs.createWriteStream(path.join(LOG_DIR, filename), { flags: 'w' });
  // 日志文件写不进去也不该打断构建：报一次就够，后续静默。
  let fileWarned = false;
  stream.on('error', err => {
    if (fileWarned) {
      return;
    }
    fileWarned = true;
    console.error(`[log-tee] 写入 ${filename} 失败：${err && err.message}`);
  });

  let stdoutAlive = true;
  return {
    write(chunk) {
      if (stdoutAlive) {
        try {
          process.stdout.write(chunk);
        } catch (err) {
          if (err && err.code === 'EPIPE') {
            stdoutAlive = false;
          } else {
            throw err;
          }
        }
      }
      // 写失败由上面的 error 监听处理（已装监听，write 不会抛）。
      stream.write(chunk);
    },
    end() {
      stream.end();
    },
  };
}

module.exports = { createTee, LOG_DIR };
