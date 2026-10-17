# 设备能力 API 文档（RN WebView Bridge 基座）

> 适用项目：`rn-base`（RN 壳 + H5 前端子应用）
> 配套中间件：`scripts/api.js`（H5 侧统一调用入口的**唯一真源**，暴露 `window.RN`，
> 由 `npm run sync:api` 同步到各子应用与 `h5/js/api.js`）
> 最近更新：2026-10-10

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
│        ├── 能力模块  camera / scanner / media / file / location / nfc 等  │
│        │            （经 NativeModules 适配器接入，未实现返回 DEVICE_     │
│        │              UNSUPPORTED）                                       │
│        ├── 升级模块  update（整包 APK 自装，仅安卓）/ updater（H5 子包）  │
│        └── 事件回传  native.back / keyboard.change → H5                   │
└────────────────────────────────────────────────────────────────────────────┘
```

- H5 永远只跟 `window.RN`（或直接 `postMessage`）打交道，不感知 Android / iOS / HarmonyOS 平台差异。
- 平台差异收敛在 RN 侧与原生模块，H5 侧协议恒定。原生实现分三套：Android（Kotlin，§9.2）、
  iOS（Swift，§9.5）、鸿蒙（ArkTS TurboModule，§9.6）；**同一方法在三个平台可以「有 / 没有」不同**，
  没有的那一侧统一返回 `DEVICE_UNSUPPORTED`，H5 据此隐藏入口。
- 传输协议定义见 `src/bridge/protocol.ts`，服务端实现见 `src/bridge/bridge-server.ts`。

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
| APP | GETINFO / GETVERSION / GETCAPABILITIES / GETCLIENTID / READY / LIFECYCLE / NATIVEBACKRESULT | App 信息、能力清单、clientId、启动握手、生命周期、返回键回执 | ✅ 可用（RN 侧实现） |
| AUTH | GETTOKEN / GETUSER / LOGOUT | 登录态获取与登出 | ✅ 可用（内存态存储） |
| PERMISSION | CHECK / REQUEST / REQUESTALL / OPENSETTINGS | 权限查询/申请/批量申请/跳系统设置 | ✅ 可用（RN `PermissionManager`：Android 走 `PermissionsAndroid`，iOS 走原生 `BasePermissions`） |
| NETWORK | GETSTATUS | 网络状态 | ✅ 可用（原生 `BaseNetwork` 已注册） |
| SYSTEM | VIBRATE / COPY / SHARE / GETDARKMODE / GETLANGUAGE / GETSCREENINFO / GETSTATUSBARHEIGHT / GETPLATFORM / GETACCESSIBILITY / GETINFO / GETDEVICEINFO / GETBATTERY | 震动 / 剪贴板 / 分享 / 外观 / 屏幕 / 无障碍 / 设备信息汇总 | ✅ 可用（COPY/SHARE 走 RN `Clipboard`/`Share`；GETDEVICEINFO/GETBATTERY 需原生 `BaseSystem`，已注册） |
| NOTIFICATION | GETTOKEN / SETBADGE / PLAYSOUND / SENDNOTIFICATION | 推送 token / 角标 / 提示音 / 本地通知 | ✅ 可用（`BaseCapabilities`）；GETTOKEN 是模拟值，项目未接 FCM/厂商推送 |
| CAMERA | TAKEPHOTO | 拍照 | ✅ 可用（原生 `BaseCapabilities` 已注册） |
| SCANNER | SCAN | 扫码 | ✅ 可用（原生 `MLKitScanActivity`，Google ML Kit） |
| MEDIA | PICKIMAGE / SAVEIMAGE | 相册选图 / 保存图片 | ✅ 可用 |
| FILE | PICK / PICKIMAGE / READASBASE64 / DOWNLOAD / OPEN | 文件选择/读取/下载/打开 | ✅ 可用（READASBASE64 仅限小文件调试，业务仍走 URI） |
| LOCATION | GETCURRENTPOSITION | 定位 | ✅ 可用 |
| CLIPBOARD | GETSTRING / SETSTRING / HASSTRING | 剪贴板读 / 写 / 是否有文本 | ✅ 可用（原生 `BaseCapabilities`；Android 10+ 读剪贴板受焦点限制） |
| APPMANAGER | ISINSTALLED / OPENAPP / OPENAPPSTORE / OPENAPPSETTINGS / OPENSYSTEMSETTINGS / GETINSTALLEDAPPS | 检测安装 / 按包名打开 / 应用市场 / 应用设置 / 系统设置分区 | ✅ 前五项可用；GETINSTALLEDAPPS 未接入（原生不枚举应用列表） |
| UPDATE | GETINFO / STARTDOWNLOAD / GETPROGRESS / CANCELDOWNLOAD / INSTALL / CANREQUESTINSTALL / OPENINSTALLSETTINGS / COPYTODOWNLOADS / CLEANUP | 整包 APK 远程升级（下载→校验→拉起安装器） | ✅ 仅 Android（原生 `BaseUpdate`）；iOS 由 App Store 分发，统一 DEVICE_UNSUPPORTED |
| NFC | AVAILABLE / READTAG / WRITENDEF | NFC 可用性 / 读标签 / 写 NDEF | ✅ 可用（设备需带 NFC 硬件） |
| LOG | INFO / ERROR / WARN / DEBUG | H5 主动打点的事件日志 | ⚠️ 调用一定成功，但**落盘未接原生**：dev 输出到 console、生产走内存适配器（`FileLogWriter` 需注入 RNFS/`BaseLog` 才真正写文件，见 §4.16）。设备调用日志（§12）另走原生 `BaseLog` |
| KEYBOARD | —（无请求方法，仅事件） | 软键盘显隐事件 `keyboard.change` | ✅ 可用（RN 侧 `Keyboard` 监听，见 §8） |

> **说明**：`MainApplication.kt` 的 `packageList` 已注册 6 个原生包
> （`BaseNetwork` / `BaseLog` / `BaseH5` / `BaseSystem` / `BaseCapabilities` / `BaseUpdate`），
> 上表能力在 Android 上均返回真实数据。**鸿蒙与 iOS 上的实际可用性不一样**，
> 分别见 §9.6（鸿蒙差异清单）与 §9.5（iOS 接入状态）。
>
> 桥接层还注册了以下能力模块，但**原生方法尚未实现**，调用统一返回 `DEVICE_UNSUPPORTED`
> （降级不崩，规则 15/16）：brightness / flashlight / sensor / biometric / contacts /
> calendar / bluetooth / audio / storage / networkInfo / qr / image / haptics / speech /
> backgroundTask / inAppReview。补原生方法后即可用，无需改 RN 侧与 H5 侧协议。
>
> 另有纯 RN 容器模块（不经原生）：toast / dialog / orientation / statusBar / navigation /
> webView / device / battery，调用方式与本文范式一致。

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
  // res.features = { camera, scanner, location, filePicker, share, clipboard, openApp, nfc }
  // 均为 boolean；openApp 仅安卓为 true（iOS 无包名概念，只能走 URL scheme）；
  // nfc 由 RN 启动时异步探测，未探完前可能为 false。
});
```

**`RN.APP.GETCLIENTID()` → `{ clientId: string }`** — H5 登录用的设备/客户端标识，按平台返回。

**`RN.APP.READY({ h5Version?, bridgeVersion? })` → `{ ok: true }`**

H5 启动握手，告知 RN 当前 H5 版本已就绪（标记版本 stable）。

```js
RN.READY({ h5Version: '1.0.0' });
// 等价于 RN.APP.READY({ h5Version: '1.0.0' })
```

**`RN.APP.LIFECYCLE({ event })` → `{ ok: true }`** — 上报 H5 生命周期事件（`resume` / `pause` 等）。

**`RN.APP.NATIVEBACKRESULT({ consumed })` → `{ ok: true }`**

容器收到硬件/手势返回时**不直接退出**，先推 `native.back` 事件给 H5；H5 处理完必须回执：
`consumed: true` 表示已被 H5 消化（关弹层/退路由），容器不再走系统返回；
`consumed: false`（或 400ms 内无回执）则由容器执行系统返回（可能退出 App）。

```js
RN.ON('native.back', async () => {
  if (closeOverlay()) {
    RN.APP.NATIVEBACKRESULT({ consumed: true });
  } else if (history.length > 1) {
    history.back();
    RN.APP.NATIVEBACKRESULT({ consumed: true });
  } else {
    RN.APP.NATIVEBACKRESULT({ consumed: false }); // 交给容器退出
  }
});
```

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

**`RN.PERMISSION.REQUESTALL({ permissions })` → `{ ok: true, results: Record<string, boolean> }`**

批量申请：按数组顺序逐项申请，**单项被拒不中断后续**，`results` 回每一项的最终授权结果。

```js
RN.PERMISSION.REQUESTALL({ permissions: ['camera', 'notification'] }).then((res) => {
  // res = { ok: true, results: { camera: true, notification: false } }
});
```

> 与 `REQUEST` 的关键差异：`REQUESTALL` **不会**因某项被拒而抛 `PERMISSION_DENIED`，
> 而是把每一项结果平铺返回，由 H5 按项决定提示文案（例如相机必需、通知可选）。
> `permissions` 为空数组时返回 `INVALID_PARAMS`。

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

**`RN.FILE.PICKIMAGE({ multiple? })` → `{ uri, name, size, mimeType }`** — 底层走 `media.pickImage`，
只回**第一张**图，返回结构与 `camera.takePhoto` 对齐（H5 头像页可统一处理）；未选图时 `USER_CANCELLED`。

**`RN.FILE.READASBASE64({ uri })` → `{ base64, mimeType, name, size }`** — 读取文件内容为 Base64，
供 H5 转 Blob 后上传（如头像）。**红线**：仅用于小文件，业务文件本体一律走 URI / 受控上传通道。

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

### 4.10 CLIPBOARD — 剪贴板

**`RN.CLIPBOARD.GETSTRING()` → `{ text: string }`** — 读剪贴板文本（无文本回空串）。

**`RN.CLIPBOARD.SETSTRING({ text })` → `{ ok: true }`** — 写文本，`text` 为空时 `INVALID_PARAMS`。

**`RN.CLIPBOARD.HASSTRING()` → `{ has: boolean }`** — 是否含文本，**不读取内容**。

```js
await RN.CLIPBOARD.SETSTRING({ text: 'SN-2026-0001' });
const { text } = await RN.CLIPBOARD.GETSTRING();
```

> Android 10+ 限制：**App 不在前台焦点态时读剪贴板返回空**（系统安全策略，非桥接 bug）。
> 只想判断有没有内容时用 `HASSTRING`，它不受该限制影响那么严格。
> 与 `SYSTEM.COPY` 的区别：`SYSTEM.COPY` 是 RN 侧 `Clipboard`（写入即可）；
> `CLIPBOARD.*` 走原生 `BaseCapabilities`，三端语义一致，推荐新代码用本模块。

### 4.11 APPMANAGER — 应用管理

> 模块名是驼峰 `appManager`，H5 侧由 `api.js` 单独挂载为 `RN.APPMANAGER`
> （通用生成器会把模块名整段小写成 `appmanager`，RN 侧收不到）。

**`RN.APPMANAGER.ISINSTALLED({ packageName })` → `{ installed: boolean }`** — 按包名检测是否安装。

**`RN.APPMANAGER.OPENAPP({ packageName, data? })` → `{ opened: boolean }`** — 拉起外部 App，
`data` 可作为 intent data 传递。

**`RN.APPMANAGER.OPENAPPSTORE({ appId? })` → `{ opened: boolean }`** — 打开应用市场详情页。

**`RN.APPMANAGER.OPENAPPSETTINGS()` → `{ opened: boolean }`** — 打开**本应用**的系统设置页。

**`RN.APPMANAGER.OPENSYSTEMSETTINGS({ action? })` → `{ opened: boolean }`** — 打开系统设置分区；
`action` 不传回设置首页。取值：`location` | `nfc` | `bluetooth` | `wifi` | `app-settings`。

**`RN.APPMANAGER.GETINSTALLEDAPPS()`** — 桥接层已注册，原生未枚举 → `DEVICE_UNSUPPORTED`。

```js
const { installed } = await RN.APPMANAGER.ISINSTALLED({ packageName: 'com.example.pos' });
if (!installed) {
  await RN.APPMANAGER.OPENAPPSTORE({ appId: 'com.example.pos' });
}
```

> iOS 只实现 `openAppSettings`（应用详情/系统设置分区是 Android Intent 概念），
> 其余方法返回 `DEVICE_UNSUPPORTED`；按 URL 打开外部 App 请改用 `file.open`。

### 4.12 UPDATE — 整包远程升级（仅 Android）

与 §13 的「H5 子包增量升级」是**两条独立链路**：`src/updater/*` 换的是 H5 包，
本模块换的是整个 APK。iOS 由 App Store 分发，无自装通道，全部方法返回 `DEVICE_UNSUPPORTED`。

**为什么拆成「起任务 + 轮询」**：H5 侧 Bridge 请求超时是 30s（`api.js TIMEOUT_MS`），
几十 MB 的包必然超时；`STARTDOWNLOAD` 毫秒级返回，原生后台线程继续下载，
`GETPROGRESS` 轮询取进度。用户把 App 切到后台时 H5 定时器会停，但原生下载不停，
回前台再轮一次就能拿到 `completed`。

**`RN.UPDATE.GETINFO()` → `UpdateInfo`**

```json
{
  "platform": "android", "versionName": "1.2.2", "versionCode": 122,
  "apkInstall": true, "canRequestInstall": true,
  "updateDir": "/storage/emulated/0/Android/data/com.qux/files/update",
  "taskState": "idle", "received": 0, "total": 0,
  "errorCode": "", "errorMessage": "", "sha256": "", "apkPath": "", "apkSize": 0
}
```

`taskState`：`idle` | `downloading` | `completed`（下载完成并通过校验）| `failed` | `cancelled`。
失败原因看同级的 `errorCode` / `errorMessage`（见 §9.4）。
`apkInstall` 在安卓恒为 `true`（表示本平台走整包自装通道）；`versionCode` 读不到已装版本时为 `-1`，
H5 比较前要先判 `> 0`，否则会把「读取失败」当成「很老的版本」反复弹升级。

**`RN.UPDATE.STARTDOWNLOAD({ url, version, sha256?, size? })` → `{ started: boolean, taskState: string }`**

```js
await RN.UPDATE.STARTDOWNLOAD({
  url: 'https://ota.example.com/app/qux-1.2.3.apk',
  version: '1.2.3', // 决定落盘文件名 qux-<version>.apk，也是同版本不重复起任务的依据
  sha256: 'e3b0c4…', // 服务端 .sha256.txt 内容；空串表示跳过校验
  size: 62914560, // 仅用于算进度百分比，非法值（字符串/负数）按 0 处理
});
```

`url` 必须是 `http(s)`，否则 `INVALID_PARAMS`。

**`RN.UPDATE.GETPROGRESS()` → `DownloadProgress`** — `{ taskState, received, total, errorCode, errorMessage, sha256, apkPath, apkSize }`

**`RN.UPDATE.CANCELDOWNLOAD()` → `{ ok: true }`** — 取消当前任务（原生用「世代号」丢弃旧任务的回调）。

**`RN.UPDATE.INSTALL()` → `{ launched: boolean, apkPath: string }`** — 用 FileProvider `content://` 拉起系统安装器。
未授予「安装未知应用」权限时返回 `PERMISSION_DENIED`（原生码 `INSTALL_PERMISSION_DENIED` 已映射），
**这不是安装失败**，应引导用户去 `OPENINSTALLSETTINGS` 授权后重试。

**`RN.UPDATE.CANREQUESTINSTALL()` → `{ granted: boolean }`** — 是否可请求安装（`REQUEST_INSTALL_PACKAGES`）。

**`RN.UPDATE.OPENINSTALLSETTINGS()` → `{ opened: boolean }`** — 跳「安装未知应用」授权设置页。

**`RN.UPDATE.COPYTODOWNLOADS()` → `{ ok: boolean, path: string, displayName: string }`** —
把已下载的 APK 导出到系统「下载」目录（MediaStore），便于用户手动安装或换机。

**`RN.UPDATE.CLEANUP()` → `{ ok: boolean, freedBytes: number }`** — 删除已下载的升级包（升级成功后旧包没用了，几十 MB 不能长期占存储）。

推荐调用顺序：

```js
const info = await RN.UPDATE.GETINFO();
if (needUpgrade(info.versionCode)) {
  if (!(await RN.UPDATE.CANREQUESTINSTALL()).granted) {
    await RN.UPDATE.OPENINSTALLSETTINGS();
  }
  await RN.UPDATE.STARTDOWNLOAD({ url, version, sha256, size });
  let p;
  do {
    await new Promise(r => setTimeout(r, 500));
    p = (await RN.UPDATE.GETPROGRESS()).taskState;
  } while (p === 'downloading');
  if (p === 'completed') {
    await RN.UPDATE.INSTALL();
  }
}
```

> APK 的 `sha256` 真源：`npm run build:android` 构建成功后会在 APK 旁写
> `<apk>.sha256.txt`（见 `scripts/apk-hash.js`），把它上传到 OTA 目录即可供本模块校验。

### 4.13 NFC — 近场标签

**`RN.NFC.AVAILABLE()` → `{ available: boolean }`**

**`RN.NFC.READTAG({ timeout? })` → `{ tagId, techTypes, data? }`** — 等待用户贴卡，超时失败。

**`RN.NFC.WRITENDEF({ records })` → `{ ok: true }`** — `records` 为 `[{ type, data }]`，空数组 `INVALID_PARAMS`。

### 4.14 SYSTEM — 系统

**`RN.SYSTEM.VIBRATE({ duration? })` → `{ ok: true }`** — 震动，默认 200ms。

**`RN.SYSTEM.COPY({ text })` → `{ ok: boolean }`** — 复制到剪贴板（RN 侧 `Clipboard` 实现，无需原生模块）。

**`RN.SYSTEM.SHARE({ title?, text?, url? })` → `{ ok: boolean }`** — 系统分享面板（RN 侧 `Share` 实现）；
`text` 与 `url` 不能同时为空，用户在面板上取消时 `ok` 为 `false`（不是错误）。

**`RN.SYSTEM.GETDARKMODE()` → `{ mode: 'dark' | 'light' | 'system' }`** — 当前深色模式。
`'system'` 表示跟随系统（`Appearance.getColorScheme()` 无明确值）。系统切换深色/浅色时，
主动推送事件 `system.darkmodechange`（见 §8）。

**`RN.SYSTEM.GETLANGUAGE()` → `{ language, locale }`** — 系统语言与区域，
如 `{ language: 'zh', locale: 'zh_CN' }`（`language` 为 `locale` 按 `-`/`_` 拆分的首段）。

**`RN.SYSTEM.GETSCREENINFO()` → `{ width, height, scale, fontScale }`** — 屏幕逻辑尺寸（px）、
DPR 缩放比、系统字体缩放（无障碍放大字体时 `fontScale > 1`）。

**`RN.SYSTEM.GETACCESSIBILITY()` → `{ screenReader, reduceMotion, boldText, invertColors }`** —
无障碍状态：读屏 / 减少动态效果 / 粗体 / 反转颜色（均为 boolean）。

**`RN.SYSTEM.GETSTATUSBARHEIGHT()` → `{ statusBarHeight: number }`** — 顶部状态栏高度（dp）。
Android 15+ edge-to-edge 下 `StatusBar.currentHeight` 已废弃返回 0，这里返回容器注入的**真实安全区
顶部 inset**（`WindowInsets`，含刘海 cutout）；未注入/读不到时为 `0`，H5 应回退
`env(safe-area-inset-top)` 或默认值。

**深浅色与安全区的同步取值**：
- H5 加载前容器注入 `window.RN_APPEARANCE`（`'dark' | 'light'`，首载快照），首帧即可同步读取，
  不必先按浅色渲染再等 `GETDARKMODE` 回包；运行期切换仍以 `system.darkmodechange` 事件为准。
- `window.RN_SAFE_AREA` 与 URL query 的 `safeTop` 等都是**首载快照**；旋转 / 分屏 / 折叠屏
  展开 insets 变化时推送事件 `system.safeareachange`
  （payload `{ top, right, bottom, left }`，dp），H5 重排以该事件为准，页面不会因此重载。

**`RN.SYSTEM.GETPLATFORM()` → `{ os: 'android' | 'ios' | 'windows' | 'macos' | 'web' }`** —
取自 RN `Platform.OS`，比 H5 侧 UA 判断更准。

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

`device` 字段来自原生 `BaseSystem`，原生未接入时省略（不影响其余字段）。

**`RN.SYSTEM.GETDEVICEINFO()` → `{ brand, model, systemVersion, sdkInt, batteryLevel, isCharging, totalStorage, freeStorage, timezone }`** —
设备硬件信息（品牌/型号/系统版本/SDK/电量/充电/存储/时区），需原生 `BaseSystem` 模块，
未接入时 DEVICE_UNSUPPORTED。

**`RN.SYSTEM.GETBATTERY()` → `{ level: number | null, isCharging: boolean }`** — 电量百分比
（0-100；未知为 `null`）与充电状态，需原生 `BaseSystem`，未接入时 DEVICE_UNSUPPORTED。

### 4.15 NOTIFICATION — 通知

**`RN.NOTIFICATION.GETTOKEN()` → `{ token: string | null }`** — 推送 token。
项目尚未接入 FCM/厂商推送，当前返回**模拟值**（`mock-token-emulator`）供 H5 联调，
不代表真实通道可用。

**`RN.NOTIFICATION.SETBADGE({ count })` → `{ ok: boolean }`** — 设置角标，`count` 非负（负数 `INVALID_PARAMS`）。
Android 桌面角标受厂商 Launcher 支持度限制，不支持时 `ok` 为 `false`。

**`RN.NOTIFICATION.PLAYSOUND()` → `{ ok: boolean }`** — 播放系统默认通知铃声
（原生 `RingtoneManager`，无播放完成回调，用计时器兜底释放）。

**`RN.NOTIFICATION.SENDNOTIFICATION({ title, content, payload? })` → `{ ok: boolean, notificationId?: number }`** —
发本地通知栏消息（原生通知渠道 `base_notify`，角标渠道 `base_badge`）。前置：Android 13+ 需先申请
`notification` 权限，未授权时原生报 `NATIVE_ERROR`，H5 应先
`RN.PERMISSION.REQUESTALL({ permissions: ['notification'] })`。
同一 `(title, content)` 在 5 秒窗口内重复调用会折叠成同一条通知（复用 `notificationId` 原地更新）。

`payload` 是**通知深链负载**：H5 自己写的不透明字符串（一般是一段 JSON），基座不解析其内容，只随
`PendingIntent` 的 extra 存进启动 Intent；点通知后由 `MainActivity.onCreate`（冷启动）或
`onNewIntent`（App 存活，清单 `launchMode=singleTask`）收进原生 pending。上限 512 字符，超长或非字符串
一律按「不带负载」处理。缺省 / 空串 = 点通知只打开 App。

**`RN.NOTIFICATION.GETPENDINGNOTIFICATION()` → `{ payload: string }`** — 取走待消费的深链负载，**取一次即清**，
无负载时回空串（不回 null）。让 H5 主动拉而不是原生把页面推进去：冷启动拿到 Intent 那一刻 H5 还没起来，
推过去必然丢；一次性消费则天然避免「`notification.tap` 事件」与「`app.resume` 补拉」两条路把同一条通知跳两次。
推荐两条路都订上（`RN.ON('notification.tap', pull)` + `RN.ON('app.resume', pull)`）。
**目前只有 Android 实现**；鸿蒙收下 `payload` 后忽略、也没有本方法，调用得到 `DEVICE_UNSUPPORTED`，
H5 侧应静默退回「点通知只打开 App」。

### 4.16 LOG — H5 事件日志

**`RN.LOG.INFO({ event, page?, button?, fn?, message?, data? })` → `{ ok: true }`**
（`WARN` / `ERROR` / `DEBUG` 同参数）

```js
RN.LOG.INFO({ event: 'button_click', page: '/login', button: '登录', fn: 'handleLogin' });
RN.LOG.ERROR({ event: 'api_error', page: '/login', message: '请求失败', data: { code: 500 } });
```

- 分类为 `h5_event_log`，按天分文件（`h5_event_log_YYYY-MM-DD.log`）。
- `data` 会走脱敏层（token/手机号等自动掩码），可以放心传结构化上下文。
- **落盘现状**：`createDefaultLogManager()` 在 dev 用 `ConsoleFileSystemAdapter`（打到 console），
  生产用 `MemoryFileSystemAdapter`（只在内存里，进程退出即丢）。要真正写文件需给 `FileLogWriter`
  注入 RNFS 或原生 `BaseLog` 适配器 —— 这是当前未接的一项，不代表日志功能报错。
- 与 §12 的「设备调用日志」是两类：§12 由容器自动记录 Bridge 调用并经原生 `BaseLog` 落盘，
  本节是 H5 主动打点。

---

## 5. H5 如何调用（RN 中间件）

### 5.1 引入中间件

在需要的 H5 页面 `<head>` 中引入（`js/api.js` 与页面同级；构建产物整目录打进 APK assets，
WebView 以 `file:///android_asset/index.html` 加载）：

```html
<script src="./js/api.js"></script>
```

引入后全局出现 `window.RN`，即可使用 `RN.<模块>.<方法>()`。

> `api.js` 的唯一真源是本仓库 `scripts/api.js`，**不要直接改 `h5/js/api.js`**：
> 改完 `npm run sync:api` 分发（模板 / 活动子应用 / `h5/`），`npm run dev` 与打包前也会自动注入。
> `h5/` 本身不在仓库里，是 `npm run app:use <子应用> -- --sync` 从子应用产物拷进基座的 assets 源目录
> （`build.gradle` 里 `assets.srcDirs += ["../../../h5"]`）。
>
> 因此 `h5/` 为空时打包**不会报错、只会打出没有 H5 页面的 APK**（`scripts/fix-h5-safearea.js` 与
> `inject-h5-api.js` 都按「缺产物就跳过」处理，避免把 gradlew 一起杀掉）。打包前先跑
> `npm run doctor`，它会把「活动子应用不在盘上 / 没有 h5/ / api.js 副本漂移」这些静默前置状态一次报完。

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

`feature` 取值（= `app.getCapabilities().features` 的键）：
`camera` | `scanner` | `location` | `filePicker` | `share` | `clipboard` | `openApp` | `nfc`。

> `SUPPORTS` 只看**能力清单**，不等于「这次调用一定成功」：例如 `nfc` 为 true 但设备没贴卡会超时，
> `openApp` 在非安卓为 false（iOS 只能走 URL scheme，见 §4.11）。
> 一次拿全部：`RN.GETCAPABILITIES()`；`RN.HASCAPABILITY(feature)` 是 `SUPPORTS` 的别名（同样返回 Promise，
> 握手前会先等 ready），未握上手时也可用 `RN.STATE()` / `RN.ISREADY()` 判断连接阶段。

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
RN.APP            { GETINFO, GETVERSION, GETCAPABILITIES, GETCLIENTID, READY, LIFECYCLE,
                    NATIVEBACKRESULT }
RN.AUTH           { GETTOKEN, GETUSER, LOGOUT }
RN.NETWORK        { GETSTATUS }
RN.CAMERA         { TAKEPHOTO }
RN.SCANNER        { SCAN }
RN.MEDIA          { PICKIMAGE, SAVEIMAGE }
RN.FILE           { PICK, PICKIMAGE, READASBASE64, DOWNLOAD, OPEN }
RN.LOCATION       { GETCURRENTPOSITION }
RN.CLIPBOARD      { GETSTRING, SETSTRING, HASSTRING }
RN.APPMANAGER     { ISINSTALLED, OPENAPP, OPENAPPSTORE, OPENAPPSETTINGS, OPENSYSTEMSETTINGS,
                    GETINSTALLEDAPPS }   ← 桥接模块名是驼峰 appManager，单独挂载
RN.UPDATE         { GETINFO, STARTDOWNLOAD, GETPROGRESS, CANCELDOWNLOAD, INSTALL,
                    CANREQUESTINSTALL, OPENINSTALLSETTINGS, COPYTODOWNLOADS, CLEANUP }
RN.NFC            { AVAILABLE, READTAG, WRITENDEF }
RN.SYSTEM         { VIBRATE, COPY, SHARE, GETDARKMODE, GETLANGUAGE, GETSCREENINFO,
                    GETSTATUSBARHEIGHT, GETPLATFORM, GETACCESSIBILITY, GETINFO, GETDEVICEINFO,
                    GETBATTERY }
RN.NOTIFICATION   { GETTOKEN, SETBADGE, PLAYSOUND, SENDNOTIFICATION }
RN.PERMISSION     { REQUEST, REQUESTALL, CHECK, OPENSETTINGS }
RN.LOG            { INFO, ERROR, WARN, DEBUG }
RN.READY(info)  RN.ON(evt, fn)  RN.OFF(evt, fn)  RN.ONCE(evt, fn)
RN.GETCAPABILITIES()  RN.SUPPORTS(feature)  RN.HASCAPABILITY(feature)
RN.STATE()  RN.ISREADY()  RN.WAITUNTILREADY(ms)  RN.QUEUESIZE()
RN.VERSION  RN.SDK_VERSION  RN.PROTOCOL_VERSION  RN.APP_ID  RN.ENV  RN.PLATFORM  RN.ERRORS
```

> `keyboard` / `toast` / `dialog` / `orientation` / `statusBar` / `navigation` / `webView` /
> `device` / `battery` 等 RN 侧模块**不在 `api.js` 的模块表里**（容器内部使用或调试页直连），
> H5 若需调用请按 §5.6 的原始 `postMessage` 方式，或先在本仓库 `scripts/api.js` 补表再同步。

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

> 两条常见误判：
> 1. **原生 reject 不会被吞成「未知错误」**：适配器统一用 `wrapNativeError` 把原生异常包成
>    `NATIVE_ERROR`，message 保留原生真实文案；只有桥接层之外的意外异常才是 `UNKNOWN_ERROR`。
> 2. **`DEVICE_UNSUPPORTED` ≠ 出错**：表示该能力在**当前平台/当前原生版本**未实现（例如 iOS 调
>    `update.*`、Android 调 `appManager.getInstalledApps`），H5 应据此隐藏入口而非弹错误提示。
>    整包升级里 `INSTALL_PERMISSION_DENIED` 会被映射成 `PERMISSION_DENIED`，含义是「未授予安装
>    未知应用权限」，应引导去 `RN.UPDATE.OPENINSTALLSETTINGS()` 而不是报安装失败。

---

## 8. 事件表（RN → H5）

| 事件名 | data | 触发时机 | 当前状态 |
|---|---|---|---|
| `bridge.ready` | `{ protocolVersion, bridgeVersion, appVersion, appId, capabilities, h5Version }` | `app.ready` 握手成功 | 已接通（与 `RN.READY()` 的响应双路径，任一先到即 ready） |
| `auth.logout` | `{ timestamp }` | AUTH.LOGOUT 成功后 | 已接通 |
| `app.resume` / `app.background` | `{ timestamp }` | App 前后台切换 | 已接通（`AppState` 监听） |
| `system.darkmodechange` | `{ mode: 'dark' \| 'light' \| 'system' }` | 系统切换深色/浅色模式时 | 已接通 |
| `keyboard.change` | `{ height: number（dp）, visible: boolean }` | 软键盘弹出/收起 | 已接通（`modules/keyboard.ts`） |
| `native.back` | `{ ts }` | 用户按硬件/手势返回键 | 已接通（需 H5 用 `RN.APP.NATIVEBACKRESULT` 回执，见 §4.1） |
| `notification.tap` | `{ ts }` | 用户点通知栏消息（仅 Android） | 已接通（只当「有货」信号，负载由 H5 调 `NOTIFICATION.GETPENDINGNOTIFICATION` 取，见 §4.15） |

> **`keyboard.change` 为什么要 H5 自己避让**：Android 15+（targetSdk 35+）edge-to-edge 让
> `adjustResize` 失效，布局视口不再随键盘缩小，键盘只能由 H5 让——把 `height` 写进 CSS 变量，
> **只抬抽屉/弹层，常驻底栏不抬**；原生侧不要再加 padding，否则与 H5 的避让叠加。
>
> **`native.back` 的决策权在 H5**：容器不再让系统直接 finish Activity，而是先问 H5
> （关弹层 → 退路由 → 退出确认）。400ms（`NATIVE_BACK_ACK_TIMEOUT_MS`）内无回执按未消化处理，
> 由容器兜底（见下方「返回键兜底」）。键盘弹出时返回键**先收键盘**（容器消化，不推 `native.back`），
> 与原生页面行为一致。
>
> **返回键兜底（`src/webview/back-policy.ts`）**：H5 回执 `consumed=false`、超时未回执，
> 或远程模式没有 Bridge 通道时，容器按两级处理 ——
> ① 先问原生「WebView 还能回退吗」：安卓走 `BaseSystem.webViewGoBack`，在按键那一刻读
> `WebView.canGoBack()`，为真才 `goBack()`（判断与动作在 UI 线程同一回调里原子完成）；
> 鸿蒙 / iOS 没有该原生接口，退回 JS 侧导航事件快照；
> ② 退无可退**不立刻退出**：先提示「再按一次退出应用」，2 秒（`EXIT_CONFIRM_WINDOW_MS`）内
> 再按一次才真正退出。
>
> **为什么必须这么做**：react-native-webview v14 删掉了 ref 上的 `canGoBack()` 命令
> （命令表只剩 goBack/reload/…），JS 只能读导航事件里的快照，而快照在 SPA 同文档路由
> （`pushState`）、hash 路由、错误页重载、回退后再前进等场景会过期 —— 快照说「退不了」，
> 旧实现就直接 finish Activity，真机表现即「子页面按一次返回键直接退出 App」，
> 套壳网站（`remoteUrl` 模式）里必现。

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
RECORD_AUDIO / POST_NOTIFICATIONS / VIBRATE / NFC / REQUEST_INSTALL_PACKAGES
```

除 `VIBRATE` / `NFC` / `INTERNET` 等安装即授予的正常签名权限外，其余都要运行时申请。
`REQUEST_INSTALL_PACKAGES` 是**特殊访问权限**：清单声明不生效，必须由用户到
「安装未知应用」页面逐项授予（用 `RN.UPDATE.CANREQUESTINSTALL()` 检测、
`RN.UPDATE.OPENINSTALLSETTINGS()` 引导）。

还有一段**包可见性**声明，容易漏且漏了不报错只误判：

```xml
<!-- Android 11+（targetSdk 30+）不声明 <queries> 时，
     getLaunchIntentForPackage / getPackageInfo 对外部 App 恒返回 null，
     appManager.isInstalled 会把「已安装」判成未安装。 -->
<queries>
  <intent>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
  </intent>
  <intent>
    <action android:name="android.intent.action.VIEW" />
    <data android:scheme="market" />
  </intent>
</queries>
```

### 9.2 原生模块注册情况

`platforms/android/app/src/main/java/com/qux/MainApplication.kt` 的 `packageList` 当前注册 6 个包：

| 原生模块 | 状态 | 对应 Bridge 能力 |
|---|---|---|
| `BaseNetworkModule.kt` + `BaseNetworkPackage` | ✅ 已注册 | network |
| `BaseLogModule.kt` + `BaseLogPackage` | ✅ 已注册 | log、设备调用日志落盘 |
| `BaseH5Module.kt` + `BaseH5Package` | ✅ 已注册 | H5 子包本地版本管理（§13） |
| `BaseSystemModule.kt` + `BaseSystemPackage` | ✅ 已注册 | system.getDeviceInfo / getBattery |
| `BaseCapabilitiesModule.kt` + `BaseCapabilitiesPackage` | ✅ 已注册 | camera / scanner / media / file / location / clipboard / appManager / nfc / notification |
| `BaseUpdateModule.kt` + `BaseUpdatePackage` | ✅ 已注册 | update（整包 APK 远程升级，仅 Android） |

新增原生包时在 `packageList` 里 `add(XxxPackage())` 即可，RN 侧与 H5 侧协议不用改（规则 10）。

### 9.3 原生能力实现说明（逐方法）

`src/middleware/native/capability-native-adapters.ts` 按**原生方法是否存在**逐项挂适配器：
原生模块整体缺失 → 返回空适配器；单个方法缺失 → 该动作 `DEVICE_UNSUPPORTED`。
因此下表就是当前真实可用性，H5 侧无需再做平台判断。（**鸿蒙** 那一列不在这里，逐条见 §9.6。）

| Bridge 方法 | Android 原生 | iOS 原生 | 实现要点 |
|---|---|---|---|
| `scanner.scan` | ✅ `scan` | ❌ 占位（reject `NOT_IMPLEMENTED`） | Android 走 `MLKitScanActivity`（CameraX + ML Kit），ZXing `CaptureActivity` 保留为降级 |
| `camera.takePhoto` | ✅ `takePhoto` | ✅ `takePhoto` | Android 输出到 app 专属目录，经 FileProvider `content://` 回传，不需要 `WRITE_EXTERNAL_STORAGE` |
| `media.pickImage` / `saveImage` | ✅ | ✅ | Android 用 PhotoPicker；保存走 MediaStore |
| `file.pick` / `readAsBase64` / `download` / `open` | ✅ | ✅（iOS 无 `readFileAsBase64`） | `download` 用 `HttpURLConnection` 直写 `cacheDir`（不依赖 DownloadManager），回传 `file://` uri；`open` 走 `ACTION_VIEW` |
| `location.getCurrentPosition` | ✅ | ✅ | 原生 `getCurrentPosition(promise)` 只接受 promise，**opts 不透传**（高精度/超时参数当前忽略） |
| `clipboard.getString` / `setString` / `hasString` | ✅ | ✅ | Android 10+ 非焦点态读取受限；iOS 用 `UIPasteboard` |
| `appManager.isInstalled` / `openApp` / `openAppStore` / `openSystemSettings` | ✅ | ❌ | 包名/Intent 分区是 Android 概念；iOS 的 `canOpenURL` 需 `LSApplicationQueriesSchemes` 白名单，结果不可信，故**故意不实现** |
| `appManager.openAppSettings` | ✅ | ✅ | iOS 用 `UIApplication.openSettingsURLString`（唯一入口） |
| `appManager.getInstalledApps` | ❌ | ❌ | 原生不枚举应用列表（隐私 + 11+ 可见性噪音） |
| `notification.setBadge` / `playSound` / `sendNotification` | ✅ | ❌ | 渠道 `base_notify` / `base_badge`；提示音用 `RingtoneManager` 默认通知铃声；同 (title, content) 5s 滑动窗口去重（复用 id 原地更新 + `setOnlyAlertOnce`，重复调用不叠条不重响） |
| `notification.getToken` | ✅（模拟值） | ✅（模拟值） | 项目未接 FCM/厂商推送，返回 `mock-token-emulator` 供 H5 联调 |
| `nfc.isAvailable` / `readTag` / `writeNdef` | ✅ | ❌ | iOS 未接 CoreNFC |
| brightness / flashlight / sensor / biometric / contacts / calendar / bluetooth / audio / storage / networkInfo / qr / image / haptics / speech / backgroundTask / inAppReview | ❌ | ❌ | 桥接层已注册、原生方法未实现 → 一律 `DEVICE_UNSUPPORTED` |

### 9.4 整包远程升级（update）链路

```
RN.UPDATE.STARTDOWNLOAD → BaseUpdateModule（后台线程 HttpURLConnection 写
                        <externalFilesDir>/update/qux-<version>.apk.<gen>.part，
                        无外部存储时回落 cacheDir/update）
                        ↓ 每写一块累计 received；取消/新任务用「世代号 generation」让旧回调失效
                        ↓ 尺寸核对 → zip 魔数 looksLikeApk → SHA-256 比对 → rename
RN.UPDATE.GETPROGRESS   → taskState: downloading → completed
RN.UPDATE.INSTALL       → FileProvider.getUriForFile + FLAG_GRANT_READ_URI_PERMISSION 拉起系统安装器
```

> zip 魔数这道闸是必须的：后端常只给 `{version,url}` 没有指纹，200 回来的可能是 nginx
> 错误页/登录页，不挡住的话用户只会看到系统安装器报「解析软件包时出现问题」。

`GETPROGRESS` / `GETINFO` 里的 `errorCode` 是**原生下载链路码**（不是 Bridge 错误码，调用本身是成功的）：
`NO_SPACE` / `HTTP_<code>` / `SIZE_MISMATCH` / `NOT_APK` / `SHA256_MISMATCH` / `RENAME_FAILED` /
`TIMEOUT` / `NETWORK_UNREACHABLE` / `CONNECT_FAILED` / `SSL_ERROR` / `DOWNLOAD_FAILED`，`errorCode` 为空表示无异常。

原生 reject 的错误码 → Bridge 错误码映射（`src/middleware/native/update-native-adapter.ts`，
`BridgeErrorCode` 是封闭联合，原生自定义码不能直接透传，原始文案拼进 `message`）：

| 原生码 | Bridge 码 | H5 处理 |
|---|---|---|
| `INSTALL_PERMISSION_DENIED` | `PERMISSION_DENIED` | 引导 `RN.UPDATE.OPENINSTALLSETTINGS()`，**不要报「安装失败」** |
| `APK_MISSING` | `FILE_NOT_FOUND` | 还没下载完/包被清理，重新 `STARTDOWNLOAD` |
| `INSTALL_FAILED` | `SECURITY_BLOCKED` | 系统安全策略拦截（如华为纯净模式），给「复制到下载目录后手动安装」兜底 |
| `NO_INSTALLER` | `NATIVE_ERROR` | 设备上没有能打开安装包的应用，提示人工处理 |
| `SETTINGS_UNAVAILABLE` / `COPY_FAILED` | `NATIVE_ERROR` | 上报 + 提示 |
| `UNSUPPORTED` | `DEVICE_UNSUPPORTED` | 隐藏升级入口 |
| 其他 / 无码异常 | `NATIVE_ERROR` | 上报 + 提示重试 |

`GETINFO` 顺带做一件事：若升级目录里那个包的版本号已等于当前已装版本名，直接删掉它
（升级装上之后进程重启、内存态清零，而 H5 的 `CLEANUP` 会被 24h 节流挡在门外，
不这样处理几十 MB 的旧包最坏要在机上留一整天以上）。

校验用 `sha256` 的来源：`npm run build:android` / `:release` 成功后在 APK 旁写
`<apk>.sha256.txt`（`scripts/apk-hash.js`），把 APK + 该 txt 一起发到 OTA 目录，
H5 取 txt 内容作为 `STARTDOWNLOAD` 的 `sha256`。传空串表示跳过校验（不建议）。

`npm run apk:hash` 末尾还会打印一行 `{"version","url","sha256","size"}` —— 正是
`STARTDOWNLOAD` 的四个入参，`url` 手工替换成 OTA 地址即可，省掉手抄 64 位 hex
（抄错一次 = 一次 `SHA256_MISMATCH`，且只有下载完才暴露）。

### 9.5 iOS 侧接入清单

`platforms/ios/qux/` 下的 `BaseCapabilities.swift` / `BaseCapabilities.m` / `BasePermissions.swift` /
`BaseNetwork.swift` / `BaseNetwork.m` 是 iOS 原生实现，但 **`qux.xcodeproj` 的 Sources 构建阶段目前
只编了 `AppDelegate.swift`**（本仓与上游基座都一样）。在 Xcode 里把上述文件加入 App Target 后，
iOS 侧的 camera / media / file / location / clipboard / appManager.openAppSettings 才会真正生效，
否则 `NativeModules.BaseCapabilities` 为 `undefined`，全部能力按 `DEVICE_UNSUPPORTED` 降级。

Swift 模块必须经 `RCT_EXTERN_MODULE` 导出（`BaseCapabilities.m` 已补齐 12 个方法声明）：
**Swift 加方法 ≠ JS 能调到**，两边要同步改，否则该单项在 JS 侧不存在、静默降级。

### 9.6 鸿蒙（RNOH）差异清单

鸿蒙侧走 `harmony/entry/src/main/ets/base/*.ets` 的自研 TurboModule + `cpp/BaseTurboModules.h` 注册表，
**方法名以 RNbase 的 JS 契约为准**（不是照抄安卓的 `BaseCapabilitiesModule.kt`）：JS 侧按「方法存在与否」
挂适配器，名字对不上就等于该能力不存在 → `DEVICE_UNSUPPORTED`。基座抽离时改过名：
`copy→clipboardSetString`、`paste→clipboardGetString`、`openSystemSettings→appOpenSystemSettings`。

> 前置条件：本仓库当前**没有装 RNOH**（0.84.4 的 peer 精确锁 RN 0.84.1，与主干 0.87.1 冲突），
> 所以下表描述的是「装上并出包后」的状态；没装时 `Platform.OS` 永远不会是 `harmony`，
> 所有鸿蒙分支保持惰性，行为与安卓链路一致。

#### 能力有无

| Bridge 方法 | 鸿蒙 | 说明 |
|---|---|---|
| `camera.takePhoto` | ✅ | `cameraPicker` 拉起系统相机，不走自研预览页 |
| `scanner.scan` | ⚠️ | Scan Kit 懒加载，**只在真机生效**；模拟器上会失败 |
| `media.pickImage` / `saveImage` | ✅ | `photoAccessHelper` 选图；保存写 MediaToolbox/相册 |
| `file.pick` / `readAsBase64` / `download` / `open` | ✅ | 选中文件先 `copyIntoSandbox` 进应用沙箱再回 URI |
| `location.getCurrentPosition` | ✅ | 权限/定位服务未开时分别抛中文错误；与安卓一样**不透传 opts** |
| `clipboard.setString` / `getString` / `hasString` | ✅ | 自研 `clipboardSetString/GetString/HasString`，**不走 RN `Clipboard`**（RNOH 不保证实现它）；读失败回空串而不是抛错 |
| `system.copy` | ✅ | 优先原生 `clipboardSetString`，拿不到才回落 RN `Clipboard` |
| `system.share` | ✅ | 走 RN `Share`（RNOH 有 `ShareTurboModule`），**不经过** `BaseCapabilities.share`；ArkTS 侧那个 `share` 注册了但基座不用 |
| `appManager.openAppSettings` | ✅ | `settings` ability：`application_info_entry` + 本包 detail |
| `appManager.openSystemSettings` | ✅ | 只有**两个落点**：`application_details`/空/`notification` → 应用详情页，其余 → 设置首页。安卓那种按分区跳的语义拿不到 |
| `appManager.isInstalled` | ❌ | 需系统级 `GET_BUNDLE_INFO_PRIVILEGED`，公开 API 做不到 → `DEVICE_UNSUPPORTED` |
| `appManager.openApp` / `openAppStore` | ❌ | 鸿蒙没有「按包名拉起/跳市场」的公开入口 → `DEVICE_UNSUPPORTED` |
| `notification.setBadge` / `playSound` / `sendNotification` | ✅ | 角标走 `notificationManager.setBadgeNumber`（免权限，失败回 `ok:false` 不抛错，免得刷未读数把设备日志淹掉）；提示音是先把 rawfile 里的 beep 资源写进 cacheDir 再用 `media.AVPlayer` 播（默认 3s，`duration` 可覆盖），**不是**系统通知铃声；通知未授权时会拉起系统授权弹窗 |
| `notification.getToken` | ❌ | 未注册（项目本来也没接 FCM/厂商推送，安卓返回的是模拟值） |
| `nfc.*` | ❌ | 读标签要 system API + 真机标签，故意不注册 → `DEVICE_UNSUPPORTED` |
| `update.*`（整包升级） | ❌ | `BaseUpdate` 未移植；鸿蒙整包分发归 AppGallery，H5 应隐藏升级入口 |
| H5 子包动态升级（§13） | ❌ | `BaseH5` 未移植，`createRealRuntime()` 检测不到即降级为内存演示运行时（不崩） |
| `network.getStatus` / `log.*` / `system.getDeviceInfo` | ✅ | 对应 `BaseNetwork` / `BaseLog` / `BaseSystem`；容器退出用 `BaseSystem.exitApp`（RNOH 没有安卓的 `ExitApp`） |
| `permission.*` | ⚠️ | 见下 |

#### 行为差异（不是「能不能」，是「不一样」）

- **权限**：`harmony-permission-adapter` 只处理 `openSettings()`（`Linking.openSettings()`）。
  camera / photo / file / location / notification 这五类**由原生在使用时自行申请**，适配器直接返回 granted；
  `microphone` 明确不可用。所以 H5 侧 `PERMISSION.REQUEST(camera)` 在鸿蒙上是「已通过」的语义，
  真正的授权弹窗出现在第一次调用该能力时。
- **安全区**：`metro.config.js` 在 `platform=harmony` 时把 `react-native-safe-area-context` 换成
  纯 JS 替身 `src/platform/harmony/safe-area-context.harmony.tsx`。原因是移植包的 ArkTS 组件仍按
  RNOH 0.72 的组件 ABI 写，0.84 的 C-API 会报 `Couldn't find ComponentJSIBinder for: RNCSafeAreaProvider`
  并让整棵子树白屏。替身取 RNOH 自带 `SafeAreaTurboModule.getInitialInsets()`（含 CUTOUT +
  导航条，单位 vp ≈ CSS px，并跟随旋转/状态栏变化）。
- **H5 入口**：release 用 `asset://h5/index.html`（映射到 `rawfile/assets/h5/`），**不能带 cache-bust query**
  ——移植的 webview 拿整串 URL 当 rawfile 键名查；debug 用宿主机 vite `http://127.0.0.1:5173/`。
  裸 `file://` 会被 ArkWeb 拒掉（17100003，直接崩进程）。导航白名单相应放行 `asset://` / `resource://`。
- **WebView 容器**：鸿蒙侧不因 `source.uri` 变化重建 source（ArkWeb 会因此重载，navigationId 1→2）；
  `onHttpError` **只记日志不弹错误页**（ArkWeb 会把子资源失败也报上来，按主帧判不可靠）。
- **返回键**：只有页面级返回（RNOH 没有安卓 `BackPressedDispatcher` 那条全局链路），
  `Index.ets` 的 `onBackPress` 往 JS 发 `hardwareBackPress`。容器兜底用 JS 侧导航事件快照
  （鸿蒙暂无 `webViewGoBack` 那条原生真值接口，见 §4.2「返回键兜底」）；快照为假时也只提示
  「再按一次退出应用」，不会一次误触就退出。
- **原生方法注册是双份的**：ArkTS 的 `public async` 方法 + `cpp/BaseTurboModules.h` 的
  `ARK_ASYNC_METHOD_METADATA(名字, 参数个数)`，两边必须逐一对应，且**全部方法都是 async**
  （同步方法会在 JS 线程上等主线程 → 死锁）。改签名忘了改 C++ 的表现是「方法存在但一调就抛」。
- **自检通道**：`App.tsx` 启动时跑 `runHarmonyNativeSelfTest()`（仅鸿蒙、仅一次），逐项探测
  `BaseSystem` / `BaseNetwork` / `BaseLog` / 剪贴板 / `fileDownload` / `setBadge` 并写设备日志，
  登录前就能用 `hdc` 取回结果。会抢前台的动作（拍照、选图、扫码、播放提示音、通知）不在其中，需人工点。

---

### 9.7 「基座 + URL」远程模式：Bridge 整体不启用

`version.json` 的 `remoteUrl` 非空时（开关与限制见 README「基座 + URL（远程站点模式）」），
容器只负责把页面加载出来，本文档描述的能力链路全部不在场：

- `WebViewBridge` 收到 `bridgeEnabled=false`：不注入 `window.ReactNativeWebView`、不处理 `onMessage`、
  不注册事件总线的全局转发。H5 侧任何 `RN.*` 调用拿到的是 `undefined`，**不是** `DEVICE_UNSUPPORTED`
  ——协议压根没进那个 origin。
- `trustedOrigins` 收窄到站点自身 origin，域外跳转仍走系统浏览器（不继承容器权限）。
- 安全区换路：本地模式是「注入 `window.RN_SAFE_AREA` + URL query，页面自己留白」，远程模式改成
  只往页面里注入一条纯 `<style>`（`html{padding-top/padding-bottom:…!important}`）——第三方页不认注入
  的 JS 变量，`targetSdk 36` 又强制 edge-to-edge，不留白就是页头被状态栏压住。留白交给页面背景绘制才
  跟站点配色一致（容器 `paddingTop` 试过，透出 RN 窗口背景会切出一条白条）。这条注入不写任何
  `window.*`，给第三方 origin 的能力面仍是零。两条路由 `bridgeEnabled` 二选一，不会同时生效。
- 握手与 H5 子包更新检查跳过：第三方页不会发 `app.ready`，等握手就是 10s 后进诊断页。
- 硬件返回键只剩容器兜底（`native.back` 没人回执）：先在按键那一刻按**原生真值**判断
  WebView 还能不能回退（`BaseSystem.webViewGoBack`，内部读 `WebView.canGoBack()` 并原子 goBack），
  能就 `goBack()`；退无可退**不直接退出**，只提示「再按一次退出应用」，2 秒内再按一次才退出。
  站点不写浏览器历史（纯组件切换的单页）时返回键同样是「先提示、再退出」，
  不会一次误触就把 App 杀掉（决策与状态在 `src/webview/back-policy.ts`，有单测）。
- 需要原生能力请回到本地 H5 子应用 + `api.js` 协议，本文档其余章节讲的都是那条链路。

---

## 10. 关键代码位置

| 文件 | 职责 |
|---|---|
| `src/bridge/protocol.ts` | 协议类型（request/response/event、错误码、`BRIDGE_EVENTS`） |
| `src/bridge/bridge-server.ts` | 服务端：派发、超时、版本/来源校验、事件 |
| `src/bridge/index.ts` | 装配入口：注册全部 41 个模块 + 注入原生适配器 |
| `src/bridge/schema.ts` | 消息校验与 requestId |
| `src/bridge/event-bus.ts` | RN→H5 事件总线 |
| `src/bridge/modules/` | 业务/容器模块（app/auth/permission/system/notification/log/keyboard/toast/dialog/navigation…） |
| `src/bridge/modules/update.ts` | 整包远程升级模块（拆「起任务 + 轮询」，见 §4.12） |
| `src/bridge/modules/capabilities/` | 能力模块（camera/scanner/media/file/location/clipboard/appManager/nfc 适配器契约 `types.ts`） |
| `src/middleware/native/capability-native-adapters.ts` | `NativeModules.BaseCapabilities` → 能力适配器（逐项探测，缺失降级） |
| `src/middleware/native/system-native-adapter.ts` | `BaseSystem` 设备信息 + copy（优先原生 `clipboardSetString`，回落 RN `Clipboard`）/ share（RN `Share`） |
| `src/middleware/native/update-native-adapter.ts` | `NativeModules.BaseUpdate` → update 模块适配器 + 原生码映射 |
| `src/middleware/network/` | network 模块与原生适配器 |
| `src/platform/os.ts` | 平台判定唯一入口（`currentOs` / `isHarmony` / `isIos`）——`Platform.OS` 是封闭联合，鸿蒙分支只能从这里走 |
| `src/platform/harmony/safe-area-context.harmony.tsx` | 鸿蒙安全区纯 JS 替身（metro 按 platform 换包名，见 §9.6） |
| `src/permissions/` | 权限管理器、Android / iOS / 鸿蒙权限适配器 |
| `src/webview/WebViewBridge.tsx` | WebView 容器：消息派发、事件透传、返回键拦截（`native.back`）、前后台事件、安全区两条路（本地注入 `window.RN_SAFE_AREA` / 远程只注入 `<style>`，见 §9.7） |
| `src/diagnostics/device-logger.ts` | 设备调用日志（级别控制/脱敏/落盘） |
| `src/diagnostics/device-log-store.ts` | 日志文件查询/读取/清理（RN 侧） |
| `platforms/android/.../base/` | Android 原生模块（BaseCapabilities / BaseNetwork / BaseLog / BaseH5 / BaseSystem / BaseUpdate / MLKitScanActivity） |
| `platforms/android/.../AndroidManifest.xml` | 权限声明、FileProvider、`<queries>` 包可见性、扫码 Activity |
| `platforms/ios/qux/BaseCapabilities.swift` + `.m` | iOS 能力实现 + `RCT_EXTERN_MODULE` 导出（见 §9.5） |
| `harmony/entry/src/main/ets/base/` | 鸿蒙自研 TurboModule（BaseCapabilities / BaseSystem / BaseLog / BaseNetwork + `BaseScanCapability.ets`） |
| `harmony/entry/src/main/cpp/BaseTurboModules.h` | 方法注册表（`ARK_ASYNC_METHOD_METADATA`），必须与 ArkTS 的 `public async` 方法逐一对应 |
| `harmony/oh-package.json5` | 用 `file:../node_modules/...` 指到 RNOH HAR —— 这就是 `harmony/` 必须在仓库根的原因 |
| `src/config/index.ts` | 集中配置；`REMOTE_H5_URL` / `IS_REMOTE_H5` / `REMOTE_H5_ORIGIN` 是远程模式开关（scheme 白名单校验在这里） |
| `src/app/resolve-h5-source.ts` | H5 入口决策：远程模式直接返回 `remoteUrl`，否则本地激活版本 → 内置兜底页 |
| `src/webview/web-view-controller.ts` | WebView 加载状态机；`canGoBack()` 的状态从导航事件里取（v14 无该命令），返回键兜底的快照来源 |
| `src/webview/back-policy.ts` | 返回键兜底策略：原生真值回退 → 「再按一次退出应用」二次确认（`EXIT_CONFIRM_WINDOW_MS`） |
| `src/diagnostics/harmony-native-self-test.ts` | 上机后的原生能力自检（写设备日志，`App.tsx` 自动触发一次） |
| `scripts/harmony-ready.js` | 鸿蒙版本闸的唯一判据（RNOH / CLI / HAR / DevEco 工具位置），`hvigor.js`、`harmony-dev.js`、`doctor.js` 共用 |
| `scripts/hvigor.js` | 跨平台跑 hvigorw：出包前拷 `h5/` 进 rawfile、校验 hermesc、注入 api.js，产物投递 `dist/<applicationId>/`，`--install` 走 hdc 装包并拉起 |
| `scripts/harmony-dev.js` / `scripts/harmony-emulator.js` | 鸿蒙 Metro(8082) + 两条 `hdc rport` + 模拟器启动与 boot 等待 |
| `scripts/ios.js` | iOS 命令入口：`doctor` 任何平台可读，其余在非 macOS 明确拒绝并列出缺口 |
| `scripts/api.js` | **H5 中间件唯一真源**（`npm run sync:api` 分发到模板/活动子应用与 `h5/js/api.js`） |
| `scripts/free-port.js` | 释放端口（Windows 连进程树 `taskkill /t /f`，Unix `lsof`+kill） |
| `scripts/adb-forward.js` | `adb reverse` 映射 Metro（`tcp:8081` → dev server） |
| `scripts/doctor.js` | `npm run doctor`：只读的构建前环境自查（依赖/活动子应用/version.json/h5 产物/api.js 漂移/qux.* + 末尾「平台链路」三平台可用性） |
| `scripts/check-hermesc.js` | 构建前校验 hermesc 是否产出真字节码（被 `doctor` 与 gradle.js 复用） |
| `scripts/gradle-home.js` | 隔离 gradle 缓存 / 指定 aapt2（`local.properties` 的 `qux.*` 键） |
| `scripts/apk-hash.js` | 构建产物旁写 `<apk>.sha256.txt`，并打印 `STARTDOWNLOAD` 的四个入参（见 §9.4） |
| `h5/js/api.js` | H5 侧统一 API 中间件（本文档配套，由 `scripts/api.js` 同步而来） |
| `h5/index.html` | H5 入口页（能力调试页） |

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
import { deviceLogger } from '../src/diagnostics/device-logger';
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

**方式二：RN 侧 API**（`src/diagnostics/device-log-store.ts`）

```ts
import { deviceLogStore } from '../src/diagnostics/device-log-store';
const dir = await deviceLogStore.getLogDir();          // 日志目录绝对路径
const files = await deviceLogStore.listLogs();          // [{name, date, size, path}]
const text = await deviceLogStore.readLog('device-2026-09-02.log'); // 文件内容
await deviceLogStore.clearLogs();                       // 清空，返回 { cleared }
```

### 12.5 实现说明

- RN 侧：`BridgeServer` 新增 `onCall` 观测钩子（`src/bridge/bridge-server.ts`），
  `WebViewBridge` 注入 `logDeviceCall`（`src/diagnostics/device-logger.ts`），
  记录每次调用的参数/结果/耗时/错误（参数与结果均经现有脱敏逻辑处理）。
- 原生侧：`BaseLogModule.kt`（`BaseLog` 模块）追加写入 `filesDir/logs/device-YYYY-MM-DD.log`，
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
export const H5_MANIFEST_URL = 'https://mobile-base.example.com/manifest.json';
```

真正启用动态升级时，把该值替换为你的 manifest 服务地址，例如：

```ts
export const H5_MANIFEST_URL = 'https://your-cdn.com/base-h5/manifest.json';
```

消费链路：`create-real-runtime.ts` → `new ManifestClient({ latestUrl: H5_MANIFEST_URL })`
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

### 13.4 本地版本管理（原生 BaseH5 模块）

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

- 安装：`BaseH5.install(version, base64Zip, manifestJson)` — 解压 zip（含路径穿越防护）并写 manifest。
- 激活：`BaseH5.activate(version)` — 原子写 `current.json`（tmp 文件 + rename），`previous` 记为旧版本。
- 入口：`BaseH5.getActiveEntry()` — 返回 `file:///data/user/0/com.qux/files/h5-versions/<version>/<entry>`。
- 校验：`BaseH5.sha256(base64)` — MessageDigest SHA-256，返回小写 hex。

原生模块：`platforms/android/app/src/main/java/com/qux/base/BaseH5Module.kt` + `BaseH5Package.kt`，
已注册到 `MainApplication.kt`。

### 13.5 升级流程（自动触发）

App 启动后（`AppRoot.tsx` 后台 useEffect）自动执行：

```
启动 → resolveH5Source 加载当前版本（内置包或已激活子包）
     → 后台 checkForUpdate()：拉 manifest，比较版本号/minAppVersion/bridgeVersion
     → 有可用版本 → update()：
          DOWNLOADING → PackageDownloader(RN fetch，带重试/进度)
          VERIFYING    → 原生 SHA-256 与 manifest.sha256 比对
          INSTALLING   → BaseH5 解压落盘
          ACTIVATING   → 原子切换 current 指针
          SMOKE_TEST   → 刷新 WebView 用新包
     → H5 握手 READY → markReady() 标记 STABLE（冒烟通过）
     → H5 启动失败   → markFailed() / 回滚到 previous 版本
```

- 状态机：`src/updater/h5-version-manager.ts`（IDLE→CHECKING→AVAILABLE→DOWNLOADING→…→STABLE）。
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
| 下载（RN fetch + 重试） | `src/updater/native-http.ts` + `src/updater/downloader.ts` |
| SHA-256（原生） | `src/updater/native-sha256.ts` + `BaseH5.sha256` |
| 本地版本存储 | `src/storage/native-h5-storage.ts` + `BaseH5Module.kt` |
| 生产装配 | `src/app/create-real-runtime.ts` |
| 自动触发与状态机 | `src/app/AppRoot.tsx` + `src/updater/h5-version-manager.ts` |
| WebView 放行 | `src/webview/navigation.ts` |
