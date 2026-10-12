/**
 * =====================================================================
 * 设备能力 API 中间件（H5 侧统一调用入口）
 * * 请将根目录/scripts/api.js内容复制到此文件
 * =====================================================================
 * 调用范式：RN.<模块大写>.<方法大写>(params) -> Promise<data>
 *    例：RN.APP.GETINFO()
 *        RN.CAMERA.TAKEPHOTO()
 *        RN.PERMISSION.REQUEST({ permission: 'camera' })
 *        RN.NETWORK.GETSTATUS()
 *
 * 命名约定：
 *   - RN              —— 接口类名（顶层门面，挂载在 window.RN）
 *   - CAMERA / APP…   —— 外设/业务模块名（大写，对应 RN 侧 Bridge module）
 *   - TAKEPHOTO…      —— 具体方法（大写，对应 RN 侧 Bridge action 小驼峰）
 *
 * 底层传输：
 *   - RN WebView 内：window.ReactNativeWebView.postMessage 与 RN Bridge 通信，
 *     协议与项目 src/bridge/protocol.ts 完全一致（request / response / event）。
 *   - 普通浏览器内：自动降级为内置 Mock（便于脱离 App 调试页面布局）。
 *
 * 使用方式：H5 页面 <head> 引入本文件后直接调用，例如：
 *   <script src="./js/api.js"></script>
 *   <script>
 *     RN.READY({ h5Version: '1.0.0' }).then(...)
 *     RN.CAMERA.TAKEPHOTO().then((res) => console.log(res.uri))
 *   </script>
 *
 * 详细文档见项目根目录 DEVICE_CAPABILITIES.md。
 * =====================================================================
 */
 