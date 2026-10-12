# 打包与发布（zip 子包 + manifest）

基座动态升级链路：App 启动 → 拉 `H5_MANIFEST_URL` 的 `manifest.json` → 版本比对 →
下载 `packageUrl` 的 zip → SHA-256 校验 → 解压到私有目录 → 冷启动加载。

## 1. 打包 zip 子包

> **打包前先用基座唯一源覆盖产物内 api.js**（保证子包 Bridge 协议与基座一致，
> 产物中不沿用模板开发期的 `public/js/api.js`）：

```bash
# 在基座项目根执行（<dist> 为子应用构建产物目录）
node scripts/inject-h5-api.js ../jingyi_h5/dist   # 按实际路径填写
# 或手动复制：
#   Copy-Item ..\jingyi_app_base\scripts\api.js dist\js\api.js
```

```bash
cd dist
# 入口 index.html 在 zip 根，entry 填 index.html
zip -r ../h5-subapp.zip .
```

> Windows 可用 `Compress-Archive -Path . -DestinationPath ..\h5-subapp.zip`。
> 确保 `js/api.js` 在 zip 内（应为基座 `scripts/api.js` 的当前版本）。

## 2. 计算 sha256 与 size

```bash
# Linux/macOS
sha256sum h5-subapp.zip        # 小写 hex，填 manifest.sha256
stat -c%s h5-subapp.zip        # 字节数，填 manifest.size
# Windows (PowerShell)
Get-FileHash h5-subapp.zip -Algorithm SHA256   # 转小写
(Get-Item h5-subapp.zip).Length
```

## 3. manifest.json（字段对齐基座 H5Manifest）

```json
{
  "version": "1.0.1",
  "buildId": "20260902-101",
  "entry": "index.html",
  "packageUrl": "https://your-cdn.com/erp-h5/releases/1.0.1/h5-subapp.zip",
  "sha256": "<小写hex>",
  "size": 123456,
  "publishedAt": "2026-09-02T10:00:00Z",
  "minAppVersion": "1.0",
  "bridgeVersion": "1.0.0",
  "forceUpdate": false
}
```

## 4. 发布与升级触发规则

- 将 zip 上传到 `packageUrl`；`manifest.json` 放到基座 `H5_MANIFEST_URL` 指向的地址。
- **版本号必须大于当前激活版本**，否则不触发（如 `1.0 → 1.0.1`）。
- `minAppVersion` > 当前 APK 版本 → 不升级（INCOMPATIBLE）。
- `bridgeVersion` > 当前 Bridge 版本 → 不升级（INCOMPATIBLE）。
- sha256 或 size 与 manifest 不符 → 安装失败自动回滚。
- 安装成功后在下次冷启动加载新包；本次启动仍用旧包。

## 5. 验证升级链路（基座日志）

升级过程状态迁移写入日志（`deviceLogger`）：
`h5.update.state=DOWNLOADING→VERIFYING→INSTALLING→ACTIVATING→SMOKE_TEST→STABLE`
以及 `h5_update_applied` / `h5_update_failed`。真机导出：

```bash
adb shell run-as com.qux cat files/logs/device-$(date +%F).log
```
