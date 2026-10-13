# iOS 待办清单（需 Mac / 真机 / 后端值的全部事项）

> 生成背景：本基座在无 Mac 环境下已把 iOS 链路在 **JS / 工程 / CI** 三层闭环（见
> `docs/提升方案建议.md`）。本文件收录**剩余的、必须依赖 Mac / Xcode / 真机 / 后端
> 分配值**的事项，每项附步骤与验收标准，拿到环境后可逐项勾销。
>
> 维护约定：完成一项打一个 ✅ 并注明日期；新增待办追加到对应分区末尾。

---

## 一、需要后端 / 配置值（非 Mac，但非代码可解）

### 1. 填入真实 `CLIENT_ID.ios` ⬜

- 位置：`src/config/index.ts` → `CLIENT_ID.ios`（当前占位 `PLEASE_SET_IOS_CLIENT_ID`）。
- 值来源：后端（与 android / harmony 的 clientId 同渠道分配）。
- 步骤：拿到值后替换占位串，运行 `npm run ios:doctor` 应不再报「clientId 占位」。
- 验收：`npm run ios:doctor` 该项通过；启动时无 `validateClientIds` 告警。

## 二、需要 Xcode（Mac）

### 2. h5 资源加入 App Target（folder reference） ⬜

- 背景：iOS 本地模式入口为 `.app/h5/index.html`（经 `ERPCapabilities.H5BundleBasePath` 拼接），
  资源必须随包分发；工程侧 `npm run ios:sync-h5` 已把 `h5/` 同步到 `platforms/ios/qux/h5/`。
- 步骤：
  1. Xcode 打开 `platforms/ios/qux.xcodeproj`；
  2. 右键 App target → Add Files to "qux" → 选择 `h5` 目录；
  3. **必须勾选「Create folder references」（蓝色文件夹），不能是 groups（黄色）**；
  4. 确认 Target Membership 勾选了 App target。
- 验收：Build 后检查 `.app` 包内存在 `h5/index.html`（`find ~/Library/Developer/Xcode/DerivedData -name "*.app" -maxdepth 6`）。

### 3. 验证 Swift 新增代码的编译与行为 ⬜

- 本轮在无 Mac 环境下预写了三个原生改动，**全部待 Xcode 编译验证**：
  | 文件 | 改动 | 验收 |
  |---|---|---|
  | `ERPCapabilities.swift` | 新增 `getDeviceIntegrity` 越狱探针（文件存在性 + 沙盒外写入探测） | 编译通过；真机返回 `secure`；越狱设备（如有）返回 `compromised` |
  | `ERPCapabilities.m` | 对应 `RCT_EXTERN_METHOD(getDeviceIntegrity...)` | JS 侧 `NativeModules.ERPCapabilities.getDeviceIntegrity()` 可调用 |
  | `ERPH5.swift` / `ERPH5.m` | 新模块：`verifyPackageSignature(base64Data, signature, publicKey)`（SecKey RSASSA-PKCS1v15-SHA256，PEM/SPKI 公钥） | 编译通过；用 Node 测试向量（见 `__tests__/updater/signature-verify.test.ts` 同源密钥）验证 valid=true；篡改数据后 valid=false |
- 注意：`ERPH5` 若与现有类名冲突（全仓 grep `class ERPH5`），改名并在 JS 侧
  `src/updater/native-signature-verifier.ts` 的 `NATIVE_MODULE_NAME` 常量同步。

### 4. 签名与出 ipa ⬜

- 前置：Apple Developer 账号、Distribution 证书、App ID / provisioning profile。
- 步骤：
  1. `platforms/ios/ExportOptions.plist` 已提供模板，把 `teamID` 与 `method` 改为实际值
     （企业分发 `enterprise` / App Store `app-store` / Ad Hoc `ad-hoc`）；
  2. `npm run build:ios:release`（内部走 `scripts/ios.js build --release`）出 xcarchive；
  3. Xcode Organizer → Distribute App（或
     `xcodebuild -exportArchive -exportOptionsPlist platforms/ios/ExportOptions.plist ...`）；
  4. 产物建议走 `npm run apk:hash` 同款流程登记 SHA-256（整包升级链路依赖哈希校验）。
- 验收：真机安装 ipa 成功启动、远程/本地 H5 均可加载。

## 三、需要真机 / 模拟器验证

### 5. iOS CI 构建跑通 ⬜

- `.github/workflows/ci-ios.yml` 已就绪（macOS runner + pod install + 模拟器 Debug 构建），
  push 到仓库即自动验证；若 runner 报 Pod/签名问题，按日志修 `Podfile` / project 配置。
- 验收：GitHub Actions 上 `ci-ios` workflow 首次绿。

### 6. 本地 H5 模式真机回归 ⬜

- 装包后确认：本地模式加载 `.app/h5/index.html` 正常（对应 `resolve-h5-entry.ts` iOS 分支）；
  无网时远程模式 30s 超时兜底错误页出现（`REMOTE_H5_LOAD_TIMEOUT_MS`）。

### 7. 占位能力接入（产品决策项，非本轮引入） ⬜

- `ERPCapabilities.scan` 当前返回 `NOT_IMPLEMENTED`：需接入 VisionKit
  （`DataScannerViewController`，iOS 16+）或三方扫码方案；
- 通知（`NOTIFICATION.*`）：需接入 APNs / RN 推送库；
- 以上 JS 侧均按 `DEVICE_UNSUPPORTED` 降级，不接入不阻塞基座。

## 四、安全原生接入（对应方案文档 §P2，属加固项非阻塞项）

### 8. SSL Pinning（iOS） ⬜

- 说明：WKWebView 自身不暴露证书回调，标准做法是
  **TrustKit**（`datatheorem/TrustKit-ios`，Info.plist 配置 pin 集合）或对
  RN 网络层（NSURLSession）注入自定义 `urlSession(_:didReceive:completionHandler:)` 校验。
- JS 侧策略已就绪：`src/security/ssl-pinning.ts` 的 `TRUSTED_CERT_PINS`（观察模式，未配置不拦）。
- 建议分两步：先给「更新清单 / 更新包下载」这条高危通道上 pin（自管 URLSession），
  再评估 WebView 通道。

---

## 已完成（无需再动）

- ✅ JS 侧 iOS H5 入口分支（`resolve-h5-entry.ts`，P1）
- ✅ `validateClientIds` 启动校验（P1）
- ✅ `ios:doctor` / `ios:sync-h5` / `ios:pods` / `ios:build` 工程链路（P1）
- ✅ iOS CI workflow（P1，待首跑验证 = 待办 #5）
- ✅ `getDeviceIntegrity` JS 策略层 + 原生 Swift 实现（P2，编译验证 = 待办 #3）
- ✅ `ERPH5.verifyPackageSignature` 原生实现 + JS 适配器（P2，编译验证 = 待办 #3）
