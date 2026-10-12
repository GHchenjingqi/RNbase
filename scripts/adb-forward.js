/**
 * 安卓设备侧的 adb reverse 端口转发（唯一实现，dev.js 与 gradle.js 共用）。
 *
 * adb reverse 是临时的：设备重启、adb 重连后全部丢失，所以每次装机都要重配。
 *   - 设备 8081、8082 -> 宿主机 Metro：debug 包的 RN bundle 从 Metro 拉，
 *     H5 调试入口同样指向 Metro（导航白名单见 src/config/index.ts 的 8081/8082 段）；
 *     基座没有独立的 H5 dev server 端口，所以只有这两条转发。
 *
 * 漏配的表现：RN 正常、H5 永远等不到 app.ready，停在基座诊断页的握手超时（HANDSHAKE_TIMEOUT_MS）。
 */
const { spawnSync } = require('child_process');

const MAPPINGS = metroPort => [
  ['tcp:8081', `tcp:${metroPort}`],
  [`tcp:${metroPort}`, `tcp:${metroPort}`],
];

/** @param {number} metroPort Metro 在宿主机上的端口 @param {string} tag 日志前缀 */
function setupAdbReverse(metroPort = 8082, tag = 'adb') {
  for (const [remote, local] of MAPPINGS(metroPort)) {
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

module.exports = { setupAdbReverse };
