# 设备能力 API 文档（RN WebView Bridge 基座）

> 适用项目：`jingyi_app_base`（RN 壳 + H5 前端子应用）
> 配套中间件：`h5/js/api.js`（H5 侧统一调用入口，暴露 `window.RN`）
> 最近更新：2026-09-02

本文档说明本基座向 H5 暴露的全部**设备能力**：如何获取、如何调用、调用后返回什么数据结构，
以及 H5 侧推荐的统一调用方式（`RN.CAMERA.TAKEPHOTO()` 范式）。

---

## 1. 架构总览

```
┌────────────────────────────  H5（WebView 内）  ────────────────────────────┐
│                                                                           │
│   H5 页面 (index.html / mode_select.html / *_viewer.html ...)             │
│        │                                                                  │
│        │ 引入 <script src="./js/api.js"></script>                         │
│        ▼                                                                  │
│   window.RN 中间件  ←──── RN.CAMERA.TAKEPHOTO() 等统一调用               │
│        │                                                                  │
│        │ window.ReactNativeWebView.postMessage(JSON)                      │
└────────┼──────────────────────────────────────────────────────────────────┘
         ▼
┌────────────────────────────  RN（App 内）  ────────────────────────────────┐
│   WebViewBridge → webviewMessageHandler → BridgeServer.handle(request)    │
│        │                                                                  │
│        ├── 业务模块  app / auth / permission / system / notification      │
│        │            （RN 侧直接实现）                                      │
│        └── 能力模块  camera / scanner / media / file / location / network │
│                     （经 NativeModules 原生适配器接入，未接入返回           │
│                       DEVICE_UNSUPPORTED）                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

- H5 永远只跟 `window.RN`（或直接 `postMessage`）打交道，不感知 Android/iOS 平台差异。
- 平台差异收敛在 RN 侧与原生模块，H5 侧协议恒定。
- 传输协议定义见 `src/bridge/protocol.ts`，服务端实现见 `src/bridge/BridgeServer.ts`。

---

## 2. 通信协议（H5 ↔ RN）

所有通信为 **JSON 字符串**，经 `postMessage` 双向传递。

### 2.1 请求（H5 → RN）

```json
{
  "type": "request",
  "id": "req_1_1690000000000",
  "version": "1.0.0",
  "module": "camera",
  "action": "takePhoto",
  "params": {}
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 是 | 固定 `"request"` |
| `id` | string | 是 | 请求唯一编号，用于对应响应 |
| `version` | string | 是 | Bridge 协议版本，当前 `1.0.0`；`1.0` 亦兼容 |
| `module` | string | 是 | 模块名（小驼峰），见 §4 |
| `action` | string | 是 | 方法名（小驼峰），见 §4 |
| `params` | object | 否 | 方法入参 |

### 2.2 响应（RN → H5）

成功：

```json
{
  "type": "response",
  "id": "req_1_1690000000000",
  "success": true,
  "data": { "uri": "file:///storage/emulated/0/DCIM/Camera/xxx.jpg" },
  "error": null
}
```

失败：

```json
{
  "type": "response",
  "id": "req_1_1690000000000",
  "success": false,
  "data": null,
  "error": { "code": "PERMISSION_DENIED", "message": "权限被拒绝" }
}
```

> 业务代码**只依赖 `error.code` 判断失败类型**，不解析平台错误文本。错误码表见 §7。

### 2.3 事件（RN → H5 主动推送）

```json
{
  "type": "event",
  "event": "auth.logout",
  "data": { "timestamp": 1690000000000 },
  "timestamp": 1690000000000
}
```

H5 通过 `RN.ON(event, handler)` 订阅，返回取消订阅函数。

---

## 3. 设备能力总览

| 模块 | 方法 | 说明 | 当前接入状态（Android 真机） |
|---|---|---|---|
| APP | GETINFO / GETVERSION / GETCAPABILITIES / READY / LIFECYCLE | App 信息、能力清单、启动握手、生命周期 | ✅ 可用（RN 侧实现） |
| AUTH | GETTOKEN / GETUSER / LOGOUT | 登录态获取与登出 | ✅ 可用（内存态存储） |
| PERMISSION | CHECK / REQUEST / OPENSETTINGS | 权限查询/申请/跳系统设置 | ✅ 可用（RN 侧 PermissionManager） |
| NETWORK | GETSTATUS | 网络状态 | ✅ 可用（原生 `ERPNetwork` 已注册） |
| SYSTEM | VIBRATE / COPY / SHARE | 震动 / 剪贴板 / 分享 | ⚠️ 部分：VIBRATE 可用；COPY/SHARE 未接适配器 |
| NOTIFICATION | GETTOKEN / SETBADGE | 推送 token / 角标 | ⚠️ 未接入（返回 DEVICE_UNSUPPORTED） |
| CAMERA | TAKEPHOTO | 拍照 | ⚠️ 未接入（原生 `ERPCapabilities` 未注册） |
| SCANNER | SCAN | 扫码 | ⚠️ 未接入（同上） |
| MEDIA | PICKIMAGE / SAVEIMAGE | 相册选图 / 保存图片 | ⚠️ 未接入（同上） |
| FILE | PICK / DOWNLOAD / OPEN | 文件选择/下载/打开 | ⚠️ 未接入（同上） |
| LOCATION | GETCURRENTPOSITION | 定位 | ⚠️ 未接入（同上） |

> **说明**：能力模块（CAMERA/SCANNER/MEDIA/FILE/LOCATION）的原生实现 `ERPCapabilitiesModule.kt`
> 已写好，但 `MainApplication.kt` 的 `packageList` 目前只注册了 `ERPNetworkPackage()`，
> **尚未注册 `ERPCapabilitiesPackage()`**。注册后上述能力即生效（各方法返回真实数据）；
> 未注册时统一返回 `DEVICE_UNSUPPORTED`。注册方式见 §10。

---

## 4. 模块详细 API

> 以下所有调用均以 **RN 中间件范式** 给出：`RN.<模块>.<方法>(params)`，返回 `Promise<data>`。
> 失败时 `Promise` reject，错误对象形如 `{ code, message }`。
> 中间件引入方式见 §5。

### 4.1 APP — App 信息与生命周期

**`RN.APP.GETINFO()` → `{ appVersion, bridgeVersion, platform }`**

```js
RN.APP.GETINFO().then((info) => {
  // { appVersion: '0.0.1', bridgeVersion: '1.0.0', platform: 'android' }
});
```

**`RN.APP.GETVERSION()`** — 与 GETINFO 等价（服务端同一实现）。

**`RN.APP.GETCAPABILITIES()` → `{ bridgeVersion, platform, features }`**

```js
RN.APP.GETCAPABILITIES().then((res) => {
  // res.features = { camera, scanner, location, filePicker, share, nfc } 均为 boolean
});
```

**`RN.APP.READY({ h5Version?, bridgeVersion? })` → `{ ok: true }`**

H5 启动握手，告知 RN 当前 H5 版本已就绪（标记版本 stable）。

```js
RN.READY({ h5Version: '1.0.0' });
// 等价于 RN.APP.READY({ h5Version: '1.0.0' })
```

**`RN.APP.LIFECYCLE({ event })` → `{ ok: true }`** — 上报 H5 生命周期事件（`resume` / `pause` 等）。

### 4.2 AUTH — 登录态

**`RN.AUTH.GETTOKEN()` → `{ token: string | null }`**

**`RN.AUTH.GETUSER()` → `{ user: object | null }`**

**`RN.AUTH.LOGOUT()` → `{ ok: true }`** — 登出成功后，RN 会推送事件 `auth.logout`（见 §8）。

### 4.3 PERMISSION — 权限

**`RN.PERMISSION.CHECK({ permission })` → `{ permission, status, granted, canAskAgain }`**

**`RN.PERMISSION.REQUEST({ permission })` → `{ permission, status, granted, canAskAgain }`**

```js
RN.PERMISSION.REQUEST({ permission: 'camera' })
  .then((res) => {
    // res = { permission: 'camera', status: 'granted', granted: true, canAskAgain: true }
  })
  .catch((err) => {
    // err.code 可能是 PERMISSION_DENIED / PERMISSION_BLOCKED / PERMISSION_UNAVAILABLE
  });
```

**`RN.PERMISSION.OPENSETTINGS()` → `{ opened: boolean }`** — 永久拒绝后引导用户前往系统设置。

`permission` 取值：`camera` | `photo` | `location` | `locationWhenInUse` | `notification` | `file` | `microphone`

`status` 取值：`unavailable` | `notDetermined` | `denied` | `blocked` | `granted`

> 申请前建议先 `CHECK`，`blocked` 时引导 `OPENSETTINGS`；拒绝非永久时仍可再次 `REQUEST`。

### 4.4 NETWORK — 网络状态

**`RN.NETWORK.GETSTATUS()` → `{ connected: boolean, type: string }`**

```js
RN.NETWORK.GETSTATUS().then((s) => {
  // type: 'wifi' | 'cellular' | 'wired' | 'none' | 'unknown'
});
```

### 4.5 CAMERA — 拍照

**`RN.CAMERA.TAKEPHOTO()` → `{ uri: string }`**（可传 `{ quality? }`，服务端当前忽略）

```js
RN.CAMERA.TAKEPHOTO().then((res) => {
  // res.uri 为拍照结果文件 URI
});
```

前置：建议先 `RN.PERMISSION.REQUEST({ permission: 'camera' })`。

### 4.6 SCANNER — 扫码

**`RN.SCANNER.SCAN()` → `{ code: string }`**（可传 `{ torch?, continuous? }`，服务端当前忽略）

前置：建议先申请相机权限。

### 4.7 MEDIA — 相册

**`RN.MEDIA.PICKIMAGE({ multiple? })` → `{ files: PickedFile[] }`**

```js
RN.MEDIA.PICKIMAGE({ multiple: false }).then((res) => {
  // res.files = [{ name, size, mimeType, uri }, ...]
});
```

**`RN.MEDIA.SAVEIMAGE({ uri })` → `{ saved: boolean }`** — 将指定 uri 图片保存到系统相册。

`PickedFile` 结构：

```ts
{
  name: string;      // 文件名
  size: number;      // 字节数
  mimeType: string;  // MIME 类型
  uri: string;       // content:// 或 file:// URI
}
```

前置：建议先申请 `photo` 权限。

### 4.8 FILE — 文件

**`RN.FILE.PICK({ accept?, multiple? })` → `{ files: PickedFile[] }`**

**`RN.FILE.DOWNLOAD({ url })` → `{ uri: string }`** — 下载到应用缓存目录并返回本地 uri。

**`RN.FILE.OPEN({ uri })` → `{ opened: boolean }`** — 用系统默认应用打开文件。

> 规范约定：文件一律回传 **URI**，禁止用 Base64 传大文件。

### 4.9 LOCATION — 定位

**`RN.LOCATION.GETCURRENTPOSITION()` → `{ latitude, longitude, accuracy? }`**

```js
RN.LOCATION.GETCURRENTPOSITION().then((pos) => {
  // { latitude: 34.03, longitude: 113.85, accuracy: 25 }
});
```

前置：建议先申请 `location` 权限。

### 4.10 SYSTEM — 系统

**`RN.SYSTEM.VIBRATE({ duration? })` → `{ ok: true }`** — 震动，默认 200ms。

**`RN.SYSTEM.COPY({ text })` → `{ ok: boolean }`** — 复制到剪贴板（未接适配器时 DEVICE_UNSUPPORTED）。

**`RN.SYSTEM.SHARE({ title?, text?, url? })` → `{ ok: boolean }`** — 系统分享（未接适配器时 DEVICE_UNSUPPORTED）。

**`RN.SYSTEM.GETDARKMODE()` → `{ mode: 'dark' | 'light' | 'system' }`** — 当前深色模式。
`'system'` 表示跟随系统（`Appearance.getColorScheme()` 无明确值）。系统切换深色/浅色时，
主动推送事件 `system.darkmodechange`（见 §8）。

**`RN.SYSTEM.GETLANGUAGE()` → `{ language, locale }`** — 系统语言与区域，
如 `{ language: 'zh', locale: 'zh_CN' }`（`language` 为 `locale` 按 `-`/`_` 拆分的首段）。

**`RN.SYSTEM.GETSCREENINFO()` → `{ width, height, scale, fontScale }`** — 屏幕逻辑尺寸（px）、
DPR 缩放比、系统字体缩放（无障碍放大字体时 `fontScale > 1`）。

**`RN.SYSTEM.GETACCESSIBILITY()` → `{ screenReader, reduceMotion, boldText, invertColors }`** —
无障碍状态：读屏 / 减少动态效果 / 粗体 / 反转颜色（均为 boolean）。

**`RN.SYSTEM.GETINFO()` → 汇总**（一次拿全，减少 bridge 往返）：

```json
{
  "os": "android",
  "systemVersion": "33",
  "darkMode": "dark",
  "language": "zh",
  "locale": "zh_CN",
  "screen": { "width": 1080, "height": 2400, "scale": 3, "fontScale": 1.2 },
  "accessibility": { "screenReader": false, "reduceMotion": false, "boldText": false, "invertColors": false },
  "device": { "brand": "vivo", "model": "V2217A", "systemVersion": "13", "sdkInt": 33,
              "batteryLevel": 61, "isCharging": true, "totalStorage": 250000000000,
              "freeStorage": 120000000000, "timezone": "Asia/Shanghai" }
}
```

`device` 字段来自原生 `ERPSystem`，原生未接入时省略（不影响其余字段）。

**`RN.SYSTEM.GETDEVICEINFO()` → `{ brand, model, systemVersion, sdkInt, batteryLevel, isCharging, totalStorage, freeStorage, timezone }`** —
设备硬件信息（品牌/型号/系统版本/SDK/电量/充电/存储/时区），需原生 `ERPSystem` 模块，
未接入时 DEVICE_UNSUPPORTED。

**`RN.SYSTEM.GETBATTERY()` → `{ level: number | null, isCharging: boolean }`** — 电量百分比
（0-100；未知为 `null`）与充电状态，需原生 `ERPSystem`，未接入时 DEVICE_UNSUPPORTED。

### 4.11 NOTIFICATION — 通知

**`RN.NOTIFICATION.GETTOKEN()` → `{ token: string | null }`** — 推送 token（未接通道时 DEVICE_UNSUPPORTED）。

**`RN.NOTIFICATION.SETBADGE({ count })` → `{ ok: boolean }`** — 设置角标，`count` 非负。

---

## 5. H5 如何调用（RN 中间件）

### 5.1 引入中间件

在需要的 H5 页面 `<head>` 中引入（`js/api.js` 与页面同级于 `h5/` 下，已被打进 APK assets）：

```html
<script src="./js/api.js"></script>
```

引入后全局出现 `window.RN`，即可使用 `RN.<模块>.<方法>()`。

### 5.2 推荐范式（统一封装）

```js
// 命名：RN 是接口类名 / 模块大写 / 方法大写
RN.APP.GETINFO();
RN.NETWORK.GETSTATUS();
RN.CAMERA.TAKEPHOTO();
RN.PERMISSION.REQUEST({ permission: 'camera' });
```

### 5.3 能力检测与降级

```js
RN.SUPPORTS('camera').then((ok) => {
  if (ok) {
    return RN.CAMERA.TAKEPHOTO();
  }
  // 降级处理：提示设备不支持拍照
});
```

### 5.4 事件订阅

```js
const off = RN.ON('auth.logout', (data) => {
  // 登录态失效，跳转登录页
  location.href = './login.html';
});
// 页面销毁时：off();
```

### 5.5 一个完整示例

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="./js/api.js"></script>
</head>
<body>
  <button id="btn">拍照并保存</button>
  <script>
    document.getElementById('btn').addEventListener('click', async () => {
      try {
        // 1. 申请相机权限
        await RN.PERMISSION.REQUEST({ permission: 'camera' });
        // 2. 拍照
        const { uri } = await RN.CAMERA.TAKEPHOTO();
        // 3. 保存到相册
        const { saved } = await RN.MEDIA.SAVEIMAGE({ uri });
        // 4. 读取网络状态
        const net = await RN.NETWORK.GETSTATUS();
        alert(`已保存: ${saved}, 网络: ${net.type}`);
      } catch (e) {
        alert(`失败: ${e.code} ${e.message}`);
      }
    });
  </script>
</body>
</html>
```

### 5.6 不走中间件（原始 postMessage 方式）

```js
const id = 'req_' + Date.now();
window.ReactNativeWebView.postMessage(JSON.stringify({
  type: 'request', id, version: '1.0.0', module: 'network', action: 'getStatus',
}));
window.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'response' && msg.id === id) {
    console.log(msg.success ? msg.data : msg.error);
  }
});
```

> 不推荐直接手写协议（编号、超时、事件、错误处理都要自己实现），
> 除非你有特殊的自定义协议需求。

---

## 6. 中间件说明

| 项 | 说明 |
|---|---|
| 文件位置 | `h5/js/api.js` |
| 暴露对象 | `window.RN` |
| 运行环境 | RN WebView（真实桥接）；普通浏览器自动降级 Mock |
| 版本 | `RN.VERSION = '1.0.0'`，与 RN 侧 `src/config` 一致 |
| 环境标识 | `RN.ENV`：`'rn'` 或 `'browser'` |
| 错误码 | `RN.ERRORS.*`（见 §7） |

**RN 对象结构速览**（`RN.<模块>.<方法>(params) → Promise<data>`）：

```
RN.APP            { GETINFO, GETVERSION, GETCAPABILITIES, READY, LIFECYCLE }
RN.AUTH           { GETTOKEN, GETUSER, LOGOUT }
RN.NETWORK        { GETSTATUS }
RN.CAMERA         { TAKEPHOTO }
RN.SCANNER        { SCAN }
RN.MEDIA          { PICKIMAGE, SAVEIMAGE }
RN.FILE           { PICK, DOWNLOAD, OPEN }
RN.LOCATION       { GETCURRENTPOSITION }
RN.SYSTEM         { VIBRATE, COPY, SHARE }
RN.NOTIFICATION   { GETTOKEN, SETBADGE }
RN.PERMISSION     { REQUEST, CHECK, OPENSETTINGS }
RN.READY(info)  RN.ON(evt, fn)  RN.OFF(evt, fn)  RN.ONCE(evt, fn)
RN.GETCAPABILITIES()  RN.SUPPORTS(feature)  RN.VERSION  RN.ENV  RN.ERRORS
```

---

## 7. 错误码表

| 错误码 | 含义 | 建议处理 |
|---|---|---|
| `BRIDGE_NOT_READY` | Bridge 未初始化 / 已清理 | 重新加载页面 |
| `BRIDGE_VERSION_NOT_SUPPORTED` | H5 协议版本与服务端不兼容 | 升级 H5 或 App |
| `METHOD_NOT_FOUND` | 方法不存在 | 检查模块/方法名 |
| `INVALID_PARAMS` | 参数校验失败 | 检查入参 |
| `TIMEOUT` | 调用超时（30s） | 重试或降级 |
| `PERMISSION_DENIED` | 权限被拒绝（可再申请） | 引导再次授权 |
| `PERMISSION_BLOCKED` | 权限被永久拒绝 | 引导 `OPENSETTINGS` |
| `PERMISSION_UNAVAILABLE` | 设备不支持该权限 | 降级提示 |
| `USER_CANCELLED` | 用户取消（拍照/选文件等） | 静默处理 |
| `DEVICE_UNSUPPORTED` | 当前设备/App 未接入该能力 | 降级 UI |
| `NETWORK_ERROR` | 网络错误 | 提示重试 |
| `NATIVE_ERROR` | 原生调用异常 | 上报/提示 |
| `FILE_NOT_FOUND` | 文件不存在 | 提示 |
| `FILE_TOO_LARGE` | 文件过大 | 提示 |
| `SECURITY_BLOCKED` | 安全策略阻止 | 检查来源是否受信 |
| `UNKNOWN_ERROR` | 未知错误 | 兜底处理 |

---

## 8. 事件表（RN → H5）

| 事件名 | data | 触发时机 | 当前状态 |
|---|---|---|---|
| `auth.logout` | `{ timestamp }` | AUTH.LOGOUT 成功后 | 已接通（见下） |
| `system.darkmodechange` | `{ mode: 'dark' \| 'light' \| 'system' }` | 系统切换深色/浅色模式时 | 已接通（见下） |

> 事件经 `BridgeEventBus` 推送。`WebViewBridge.tsx` 挂载时已调用
> `server.eventBus.setGlobalListener((e) => webViewRef.current?.postMessage(JSON.stringify(e)))`
> 将 RN → H5 事件透传到 WebView，H5 侧通过 `RN.ON(event, handler)` 订阅（见 §5.4）。

---

## 9. 权限与原生能力接入说明

### 9.1 权限申请链路

H5 `RN.PERMISSION.REQUEST` → RN `PermissionManager`（跨平台状态机）→ 原生权限适配器 → 返回结构化结果。

Android 侧已声明的系统权限（`AndroidManifest.xml`）：

```
INTERNET / ACCESS_NETWORK_STATE / CAMERA / READ_MEDIA_IMAGES /
READ_EXTERNAL_STORAGE(≤API32) / ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION /
RECORD_AUDIO / POST_NOTIFICATIONS
```

### 9.2 原生能力模块

| 原生模块 | 注册位置 | 对应 Bridge 能力 |
|---|---|---|
| `ERPNetworkModule.kt` + `ERPNetworkPackage` | ✅ 已在 `MainApplication.kt` 注册 | network |
| `ERPCapabilitiesModule.kt` + `ERPCapabilitiesPackage` | ❌ 未注册 | camera / scanner / media / file / location |

### 9.3 接入 ERPCapabilities（启用相机/扫码/相册/文件/定位）

在 `platforms/android/app/src/main/java/com/qux/MainApplication.kt` 的 `packageList` 中追加：

```kotlin
import com.qux.erp.ERPCapabilitiesPackage
// ...
packageList =
  PackageList(this).packages.apply {
    add(ERPNetworkPackage())
    add(ERPCapabilitiesPackage())   // ← 新增此行
  }
```

重新 `gradlew installDebug` 后，CAMERA/SCANNER/MEDIA/FILE/LOCATION 即返回真实数据。

> 注意：`ERPCapabilitiesModule.kt` 中 `scan()` 目前为占位（reject NOT_IMPLEMENTED），
> 真正扫码需接入第三方扫码库；其余方法（takePhoto/pickImage/saveImage/filePick/fileDownload/
> fileOpen/getCurrentPosition）已有可用实现。

---

## 10. 关键代码位置

| 文件 | 职责 |
|---|---|
| `src/bridge/protocol.ts` | 协议类型（request/response/event、错误码） |
| `src/bridge/BridgeServer.ts` | 服务端：派发、超时、版本/来源校验、事件 |
| `src/bridge/schema.ts` | 消息校验与 requestId |
| `src/bridge/eventBus.ts` | RN→H5 事件总线 |
| `src/bridge/modules/` | 各业务模块（app/auth/permission/system/notification） |
| `src/bridge/modules/capabilities/` | 各能力模块（camera/scanner/media/file/location） |
| `src/middleware/network/` | network 模块 |
| `src/permissions/` | 权限管理器与类型 |
| `src/diagnostics/deviceLogger.ts` | 设备调用日志（级别控制/脱敏/落盘） |
| `src/diagnostics/deviceLogStore.ts` | 日志文件查询/读取/清理（RN 侧） |
| `platforms/android/.../erp/` | Android 原生能力模块（ERPCapabilities/ERPNetwork/ERPLog） |
| `h5/js/api.js` | H5 侧统一 API 中间件（本文档配套） |
| `h5/index.html` | H5 入口页 |

---

## 11. 快速开始（H5 侧）

```html
<script src="./js/api.js"></script>
<script>
  (async () => {
    // 握手
    await RN.READY({ h5Version: '1.0.0' });
    // 能力
    const caps = await RN.GETCAPABILITIES();
    const net = await RN.NETWORK.GETSTATUS();
    console.log('bridge:', RN.VERSION, 'env:', RN.ENV, 'caps:', caps, 'net:', net);
  })();
</script>
```

至此，H5 已具备对基座全部设备能力的统一访问能力。

---

## 12. 设备调用日志

每次 Bridge 设备能力调用（H5 通过 `RN.*` 或原始 postMessage 调用）都会自动记录日志，
便于追溯问题。H5 侧无需任何额外操作。

### 12.1 记录内容

| 字段 | 说明 |
|---|---|
| 时间戳 | `yyyy-MM-dd HH:mm:ss.SSS` |
| 级别 | `INFO` / `SUCCESS` / `WARN` / `ERROR` / `DEBUG` |
| requestId | 调用唯一编号（与 Bridge 响应对应） |
| 调用 | `module.action`，如 `camera.takePhoto` |
| 参数 | 脱敏后的入参 JSON（token/手机号/身份证自动掩码） |
| 结果 | 成功时脱敏后的返回 JSON |
| 错误 | 失败时的 `code:message`，成功为 `-` |
| 耗时 | `durationMs` |

真实日志示例：

```
[2026-09-02 09:52:55.679] [INFO] bridge.ready entry=file:///android_asset/index.html bridgeVersion=1.0.0
[2026-09-02 09:52:56.090] [SUCCESS] h5_1788313976061 app.getVersion params={} result={"appVersion":"0.0.1","bridgeVersion":"1.0.0","platform":"android"} error=- durationMs=1
[2026-09-02 09:53:28.223] [SUCCESS] h5_1788314008211 permission.check params={"permission":"camera"} result={"permission":"camera","status":"denied","granted":false,"canAskAgain":true} error=- durationMs=8
[2026-09-02 09:53:28.871] [SUCCESS] h5_1788314018865 network.getStatus params={} result={"type":"wifi","connected":true} error=- durationMs=2
```

级别规则：调用成功→`SUCCESS`；方法不存在→`WARN`；其他失败→`ERROR`。

### 12.2 日志级别控制

级别优先级：`debug(10) < info(20) = success(20) < warn(30) < error(40)`。
**默认 `info`**：记录 info / success / warn / error（忽略 debug）；**设为 `error`** 时仅记录 error。

控制方式：

1. **编译期默认**：`src/config/index.ts` 的 `LOG_LEVEL`（当前 `'info'`）。
2. **运行期调整**（RN 侧）：

```ts
import { deviceLogger } from '../src/diagnostics/deviceLogger';
deviceLogger.setLevel('error');   // 仅记录 error
deviceLogger.setLevel('info');    // 恢复默认
```

### 12.3 按日期分包

日志按日期写入独立文件：`<filesDir>/logs/device-YYYY-MM-DD.log`（同一天一个文件，
每天自动切换，单文件不会无限增长）。App 私有目录，无需额外权限。

### 12.4 查看 / 导出 / 清理

**方式一：adb 直接导出（debug 构建）**

```bash
adb shell run-as com.qux ls -la files/logs
adb shell run-as com.qux cat files/logs/device-2026-09-02.log
# 导出到电脑
adb shell run-as com.qux cat files/logs/device-2026-09-02.log > device.log
```

**方式二：RN 侧 API**（`src/diagnostics/deviceLogStore.ts`）

```ts
import { deviceLogStore } from '../src/diagnostics/deviceLogStore';
const dir = await deviceLogStore.getLogDir();          // 日志目录绝对路径
const files = await deviceLogStore.listLogs();          // [{name, date, size, path}]
const text = await deviceLogStore.readLog('device-2026-09-02.log'); // 文件内容
await deviceLogStore.clearLogs();                       // 清空，返回 { cleared }
```

### 12.5 实现说明

- RN 侧：`BridgeServer` 新增 `onCall` 观测钩子（`src/bridge/BridgeServer.ts`），
  `WebViewBridge` 注入 `logDeviceCall`（`src/diagnostics/deviceLogger.ts`），
  记录每次调用的参数/结果/耗时/错误（参数与结果均经现有脱敏逻辑处理）。
- 原生侧：`ERPLogModule.kt`（`ERPLog` 模块）追加写入 `filesDir/logs/device-YYYY-MM-DD.log`，
  已注册到 `MainApplication.kt`。原生模块未接入时日志降级到 console，不影响业务。
- 日志写入失败不影响主流程（fire-and-forget）。

## 13. 动态 H5 子包升级（Phase 7）

### 13.1 概述

APK 自带一个内置 H5 子包（`h5/` 目录，经 `build.gradle` 打进 APK `assets/`，
入口 `file:///android_asset/index.html`）。当后端发布新版本时，App 启动后会在后台
拉取 manifest → 下载 zip 子包 → SHA-256 校验 → 解压安装到私有目录 → 激活，
**下次冷启动**加载新子包（本次启动仍用旧包，不打断用户）。

### 13.2 manifest 地址服务配置在哪里

**唯一配置点：`src/config/index.ts` 的 `H5_MANIFEST_URL`**（已预留，当前为占位地址）：

```ts
// src/config/index.ts
export const H5_MANIFEST_URL = 'https://mobile-erp.example.com/manifest.json';
```

真正启用动态升级时，把该值替换为你的 manifest 服务地址，例如：

```ts
export const H5_MANIFEST_URL = 'https://your-cdn.com/erp-h5/manifest.json';
```

消费链路：`createRealRuntime.ts` → `new ManifestClient({ latestUrl: H5_MANIFEST_URL })`
→ `H5VersionManager.manifestProvider.fetchManifest()`。

> 当前占位地址 `*.example.com` 无法解析，App 启动时会拉取失败并写日志
> （`h5_update_failed`），**不影响**内置包正常加载。把地址换成真实服务即可生效。

### 13.3 子包发布要求

manifest 服务需返回 `manifest.json`，字段与 `src/updater/types.ts` 的 `H5Manifest` 对齐：

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | 是 | 语义化版本号，如 `1.0.1`（数字比较，版本号大于当前才更新） |
| `buildId` | 是 | 构建唯一标识 |
| `entry` | 是 | 入口文件名，默认 `index.html` |
| `packageUrl` | 是 | 子包 zip 的下载地址（https） |
| `sha256` | 是 | 子包 zip 的 SHA-256（小写 hex），安装前强校验 |
| `size` | 是 | 子包 zip 字节数 |
| `publishedAt` | 是 | 发布时间（ISO 8601） |
| `minAppVersion` | 否 | 最低 APK 版本（App 版本过低则不升级） |
| `bridgeVersion` | 否 | 最低 Bridge 版本（Bridge 不兼容则不升级） |
| `forceUpdate` | 否 | 是否强制升级 |

版本目录约定：`{base}/manifest.json` 为 latest manifest；单版本 manifest 模板
`{base}/releases/{version}/manifest.json`（`ManifestClient.versionUrlTemplate`，可选）。

### 13.4 本地版本管理（原生 ERPH5 模块）

落盘位置：`<filesDir>/h5-versions/`（App 私有目录，无需额外权限）。

```
h5-versions/
  current.json                 # current 指针：{"current":"1.0.1","previous":"1.0"}
  1.0.0/                       # 已安装版本（解压后的子包）
    manifest.json
    index.html ...
  1.0.1/
    manifest.json
    index.html ...
```

- 安装：`ERPH5.install(version, base64Zip, manifestJson)` — 解压 zip（含路径穿越防护）并写 manifest。
- 激活：`ERPH5.activate(version)` — 原子写 `current.json`（tmp 文件 + rename），`previous` 记为旧版本。
- 入口：`ERPH5.getActiveEntry()` — 返回 `file:///data/user/0/com.qux/files/h5-versions/<version>/<entry>`。
- 校验：`ERPH5.sha256(base64)` — MessageDigest SHA-256，返回小写 hex。

原生模块：`platforms/android/app/src/main/java/com/qux/erp/ERPH5Module.kt` + `ERPH5Package.kt`，
已注册到 `MainApplication.kt`。

### 13.5 升级流程（自动触发）

App 启动后（`AppRoot.tsx` 后台 useEffect）自动执行：

```
启动 → resolveH5Source 加载当前版本（内置包或已激活子包）
     → 后台 checkForUpdate()：拉 manifest，比较版本号/minAppVersion/bridgeVersion
     → 有可用版本 → update()：
          DOWNLOADING → PackageDownloader(RN fetch，带重试/进度)
          VERIFYING    → 原生 SHA-256 与 manifest.sha256 比对
          INSTALLING   → ERPH5 解压落盘
          ACTIVATING   → 原子切换 current 指针
          SMOKE_TEST   → 刷新 WebView 用新包
     → H5 握手 READY → markReady() 标记 STABLE（冒烟通过）
     → H5 启动失败   → markFailed() / 回滚到 previous 版本
```

- 状态机：`src/updater/H5VersionManager.ts`（IDLE→CHECKING→AVAILABLE→DOWNLOADING→…→STABLE）。
- 每次状态迁移写日志：`h5.update.state=<STATE>`（`deviceLogger.info`）。
- 更新成功/失败追加事件日志：`h5_update_applied` / `h5_update_failed`（`logger.log`）。

### 13.6 回滚

- 启动失败：H5 未能在握手窗口内发送 `app.ready` → 触发诊断页，可回滚到 `previous`。
- 安装/校验失败：`update()` 内部自动 `rollbackToPrevious()`，恢复上一版本。

### 13.7 WebView 安全放行

动态子包通过 `file://` 加载，`src/webview/navigation.ts` 仅放行应用私有目录
`h5-versions/` 前缀（两种 Android 路径形式），其余 `file://` 仍拦截：

```ts
// navigation.ts — 放行动态子包
url.startsWith('file:///data/user/0/com.qux/files/h5-versions/')
url.startsWith('file:///data/data/com.qux/files/h5-versions/')
```

`WebViewBridge` 已开启 `allowFileAccess` / `allowFileAccessFromFileURLs` /
`allowUniversalAccessFromFileURLs`，`originWhitelist` 含 `file://`。

### 13.8 如何发布一个新版本（H5 侧操作）

1. 打包子包：将 H5 静态文件压缩为 zip（入口文件名写入 `entry`，建议 `index.html`）。
2. 计算 SHA-256（小写 hex）与字节数（`size`）。
3. 上传 zip 到 `packageUrl`，放置/更新 `manifest.json` 到 `H5_MANIFEST_URL`。
4. 版本号必须大于当前已激活版本（如 `1.0 → 1.0.1`），否则不会触发更新。
5. 安装新 APK 或重新启动 App → 观察日志 `h5.update.state=DOWNLOADING→…→STABLE` 与 `h5_update_applied`。

### 13.9 关键代码位置

| 职责 | 位置 |
|---|---|
| manifest 地址配置 | `src/config/index.ts` → `H5_MANIFEST_URL` |
| manifest 拉取 | `src/updater/manifest-client.ts` → `ManifestClient` |
| 下载（RN fetch + 重试） | `src/updater/nativeHttp.ts` + `src/updater/downloader.ts` |
| SHA-256（原生） | `src/updater/nativeSha256.ts` + `ERPH5.sha256` |
| 本地版本存储 | `src/storage/NativeH5Storage.ts` + `ERPH5Module.kt` |
| 生产装配 | `src/app/createRealRuntime.ts` |
| 自动触发与状态机 | `src/app/AppRoot.tsx` + `src/updater/H5VersionManager.ts` |
| WebView 放行 | `src/webview/navigation.ts` |
