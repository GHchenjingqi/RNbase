/**
 * 端口与设备侧地址的唯一落点（ports.json 的读取器）。
 *
 * 为什么单独一层：出包/dev 脚本是 Node，src/config 是 Metro 打进 bundle 的 RN 代码，
 * 两边直接 require 同一个 JSON 会把「读文件」这件事复制两份。这里收口一次读取 +
 * 一次校验，脚本侧 require 本模块，RN 侧（src/config/index.ts）按 version.json 的
 * 同样的方式直接 import JSON —— 真值只有一份，都在 ports.json。
 *
 * 校验放在读取时：漏键会让 adb reverse / hdc fport 拼出 `tcp:undefined`，
 * 命令照样退 0，设备侧静默拿到错映射，表现为「RN 红屏但脚本说一切正常」。
 */
const path = require('path');

const PORTS_FILE = path.join(__dirname, '..', 'ports.json');

/** ports.json 必须存在的键：新增端口往这里加，守卫测试按这份清单逐条查。 */
const REQUIRED_KEYS = ['metroHostPort', 'metroDevicePort', 'h5DevPort', 'androidEmulatorHostIp'];

function load() {
  let raw;
  try {
    raw = JSON.parse(require('fs').readFileSync(PORTS_FILE, 'utf8'));
  } catch (e) {
    throw new Error(`[ports] 读取 ${PORTS_FILE} 失败：${e.message}`);
  }
  const missing = REQUIRED_KEYS.filter(k => raw[k] === undefined || raw[k] === null);
  if (missing.length > 0) {
    throw new Error(`[ports] ports.json 缺少键：${missing.join(', ')}`);
  }
  const numbers = REQUIRED_KEYS.filter(k => k !== 'androidEmulatorHostIp');
  const bad = numbers.filter(k => !Number.isInteger(raw[k]) || raw[k] < 1 || raw[k] > 65535);
  if (bad.length > 0) {
    throw new Error(`[ports] ports.json 的端口非法（需 1..65535 整数）：${bad.join(', ')}`);
  }
  return raw;
}

const ports = load();

module.exports = {
  PORTS_FILE,
  REQUIRED_KEYS,
  ports,
  /** Metro 在宿主机监听的端口。 */
  METRO_HOST_PORT: ports.metroHostPort,
  /** 设备上 RN/RNOH 固定请求的 Metro 端口（靠 reverse / fport 映射到宿主机）。 */
  METRO_DEVICE_PORT: ports.metroDevicePort,
  /** 三端统一的子应用 vite 端口。 */
  H5_DEV_PORT: ports.h5DevPort,
  /** 安卓模拟器访问宿主机的特殊地址。 */
  ANDROID_EMULATOR_HOST_IP: ports.androidEmulatorHostIp,
  loadPorts: load,
};
