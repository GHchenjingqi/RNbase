# H5 子应用必备条件清单

> 按维度逐项核对。任一不满足会导致 WebView 白屏、Bridge 不通或动态升级失败。

## A. 运行环境（基座侧，通常已具备）

| 条件 | 说明 | 核验 |
|---|---|---|
| 基座为 RN WebView 承载 | 子应用是 Web 页面，非 RN 原生页面 | 基座用 react-native-webview |
| WebView 允许 file:// | `allowFileAccess` / `allowFileAccessFromFileURLs` / originWhitelist 含 `file://` | 基座 `WebViewBridge` 配置 |
| Bridge 中间件就绪 | 基座侧注入 `js/api.js`，暴露 `window.RN` | `h5/js/api.js` 存在 |
| 动态升级链路就绪（可选） | 基座 `src/updater` + manifest 配置 | `H5_MANIFEST_URL` 已配置 |

## B. 子应用产物（必备）

| 条件 | 说明 | 失败表现 |
|---|---|---|
| 纯静态产物 | 无 SSR/服务端依赖，dist 可直接被 WebView 加载 | 白屏 |
| hash 路由 | `#/` 形式路由 | history 路由在 file:// 白屏 |
| 相对路径资源 | 构建 `base:'./'`，无 `/assets/` 绝对根路径 | 资源 404、样式丢失 |
| 相对引入 api.js | `<script src="./js/api.js">`，随包分发 | `window.RN` undefined |
| 字体/图片可访问 | 相对路径或内联（base64） | file:// 跨目录加载失败 |

## C. Bridge 调用规范

- 调用：`RN.<模块大写>.<方法大写>(params)` 返回 Promise。
  例：`RN.SYSTEM.GETDARKMODE()`、`RN.APP.GETINFO()`、`RN.NETWORK.GETSTATUS()`。
- 事件：`RN.ON('system.darkmodechange', ({ mode }) => ...)`，返回取消订阅函数。
- 能力检测：`RN.GETCAPABILITIES()` / `RN.SUPPORTS('camera')` 后降级。
- 错误：统一 `{ code, message }`，如 `DEVICE_UNSUPPORTED`；页面应 catch。
- 协议版本：`RN.VERSION`；请求带 `version` 供基座兼容性校验。

## D. 动态升级兼容（若启用）

- 可打包为 zip（入口 `index.html`，扁平或带目录均可，entry 指向入口）。
- manifest 必填字段：`version`、`buildId`、`entry`、`packageUrl`、`sha256`、`size`、`publishedAt`。
- `sha256` 为 zip 小写 hex；`size` 为 zip 字节数；`version` 需大于当前激活版本。
- `minAppVersion` / `bridgeVersion` 可选；不满足则不升级。

## E. 本地开发检查命令

```bash
# 1. 产物无绝对路径（grep 相对根路径引用，应无输出）
grep -r "src=\"/" dist/ ; grep -r "href=\"/" dist/
# 2. index.html 包含 api.js 且为相对路径
grep "js/api.js" dist/index.html
# 3. 路由为 hash（构建配置确认），产物含 # 路由即可
# 4. 静态起服自测（模拟 WebView 加载，无需服务器 rewrite）
npx serve dist
# 5. zip 包校验信息与 manifest 一致
sha256sum subapp.zip   # 与 manifest.sha256 比对
stat -c%s subapp.zip   # 与 manifest.size 比对
```

## F. 常见失败 → 根因对照

| 现象 | 根因 |
|---|---|
| 白屏 | history 路由 / 绝对路径 / api.js 缺失 |
| 样式丢失 | base 未设 `./`，CSS 走了绝对根路径 |
| `RN` undefined | api.js 未引入或未随包分发 |
| 图片不显示 | 相对路径写错，或 assetsInlineLimit 过小走独立文件 |
| 动态升级不触发 | version 不大于当前 / sha256/size 与 manifest 不符 / packageUrl 不可达 |
