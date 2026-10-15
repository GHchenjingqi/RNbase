/**
 * 安卓设备侧的 adb reverse 端口转发（唯一实现，dev.js 与 gradle.js 共用）。
 *
 * adb reverse 是临时的：设备重启、adb 重连后全部丢失，所以每次装机都要重配。
 *   - 设备 8081、8082 -> 宿主机 Metro：debug 包的 RN bundle 从 Metro 拉；
 *   - 设备 5173 -> 宿主机子应用 vite：debug 包的 H5 入口从宿主机 dev server 拉
 *     （src/config/index.ts 的 H5_DEV_SERVER_URL），与鸿蒙 `hdc rport tcp:5173` 用同一端口。
 *
 * 漏配 8081/8082：RN 起不来（红屏 / bundle 拉取失败）。
 * 漏配 5173：RN 正常、H5 永远等不到 app.ready，停在基座诊断页的握手超时（HANDSHAKE_TIMEOUT_MS）。
 */
const { spawnSync } = require('child_process');

/** 子应用 dev server 端口，与 src/config/index.ts 的 H5_DEV_SERVER_PORT 保持一致。 */
const H5_DEV_PORT = 5173;

const MAPPINGS = (metroPort, h5Port) => [
  ['tcp:8081', `tcp:${metroPort}`],
  [`tcp:${metroPort}`, `tcp:${metroPort}`],
  ...(h5Port ? [`tcp:${h5Port}`, `tcp:${h5Port}`] : []),
];

/**
 * @param {number} metroPort Metro 在宿主机上的端口
 * @param {string} tag 日志前缀
 * @param {number|null} h5Port 子应用 dev server 端口；传 null 不配这条转发
 */
function setupAdbReverse(metroPort = 8082, tag = 'adb', h5Port = H5_DEV_PORT) {
  for (const [remote, local] of MAPPINGS(metroPort, h5Port)) {
    const r = spawnSync('adb', ['reverse', remote, local], { encoding: 'utf8' });
    // adb 即使没设备也返回 0 并把错误写在 stderr，失败判据看输出不看退出码。
    if (r.status === 0 && !/\S/.test(r.stderr || '')) {
      console.log(`[${tag}] adb reverse ${remote} -> ${local} 已配置`);
    } else {
      console.warn(
        `[${tag}] adb reverse ${remote} -> ${local} 配置失败: ${(
          r.stderr ||
          r.stdout ||
          '(无输出)'
        ).trim()}`,
      );
    }
  }
}

module.exports = { setupAdbReverse, H5_DEV_PORT };
