# iOS 待办清单（需 Mac / 真机 / 后端值的全部事项）

> 生成背景：本基座在无 Mac 环境下已把 iOS 链路在 **JS / 工程 / CI** 三层闭环（见
> `docs/提升方案建议.md`）。本文件收录**剩余的、必须依赖 Mac / Xcode / 真机 / 后端
> 分配值**的事项，每项附步骤与验收标准，拿到环境后可逐项勾销。
>
> 维护约定：完成一项打一个 ✅ 并注明日期；新增待办追加到对应分区末尾。
>
> **进展（2026-11-11）：iOS 原生能力整体对齐上游基座最新实现**——qux/ 下按上游同款
> 架构重写/新增 7 个 Swift 模块 + 1 个桥接声明：
> `BaseCapabilities`（扫码自建页 / PHPicker 多选 / 定位超时与权限 / NFC / 通知深链
> `baseNotificationTap` / 角标 / 提示音 / `H5BundleBasePath` 常量 / `getDeviceIntegrity`）、
> `BaseH5`（H5 子包版本管理 + zip 解压 + `sha256` + `getBundledEntry` + 包签名校验）、
> `BasePermissions`（通知权限真实异步查询 / 定位 manager 成员化防提前释放）、
> `BaseLog` / `BaseSystem` / `BaseUpdate` / `BaseNetwork`（保持不变）、
> `BaseBridge.m`（统一 RCT_EXTERN_MODULE 声明，取代原三个散装 .m；旧
> BaseCapabilities.m / BaseH5.m / BaseNetwork.m 已删除）。
> 工程：新增 "Copy H5 Assets" 构建阶段（仓库根 h5/ 自动拷进 .app，替代手工
> folder reference）、PrivacyInfo.xcprivacy 挂进 Resources、Info.plist 补
> LSApplicationQueriesSchemes / NFCReaderUsageDescription / RCTNewArchEnabled、
> project 级构建配置对齐 RN 0.84 模板（RCT_REMOVE_LEGACY_ARCH 等）。
> 方法名全部以本仓 JS 适配器契约为准（与上游的 ERP 前缀差异已逐一映射）。

---

## 一、需要后端 / 配置值（非 Mac，但非代码可解）

### 1. 填入真实 `CLIENT_ID.ios` ⬜

- 位置：`src/config/index.ts` → `CLIENT_ID.ios`（当前占位 `PLEASE_SET_IOS_CLIENT_ID`）。
- 值来源：后端（与 android / harmony 的 clientId 同渠道分配）。
- 步骤：拿到值后替换占位串，运行 `npm run ios:doctor` 应不再报「clientId 占位」。
- 验收：`npm run ios:doctor` 该项通过；启动时无 `validateClientIds` 告警。

## 二、需要 Xcode（Mac）

### 2. h5 资源加入 App Target（folder reference） ✅ 2026-11-11（改为构建阶段方案）

- 原方案（Xcode 手工加 folder reference）已废弃：project.pbxproj 新增
  **"Copy H5 Assets" 构建阶段**，每次构建把仓库根 `h5/` 拷进 `.app/h5/`
  （`${SRCROOT}/../../h5`，缺目录时只 warning 不 fail）。上游基座同款做法，
  无需 Mac 手工操作，`npm run ios:doctor` 的 h5 检查项仍有效（本地调试可继续用
  `npm run ios:sync-h5` 同步到 platforms/ios/qux/h5）。
- 验收：Build 后检查 `.app` 包内存在 `h5/index.html`
  （`find ~/Library/Developer/Xcode/DerivedData -name "*.app" -maxdepth 6`）。

### 3. 验证 Swift 新增代码的编译与行为 ⬜

- **2026-11-11 更新**：上一轮「无 Mac 预写的 7 个源文件」已整体替换为上游基座
  在 MacBook 模拟器上跑通的同一套实现（口径 2026-11-11，方法名按本仓 JS 契约
  改成 Base 前缀）。上游侧的已知编译坑（SecKeyVerify、CFError→NSError、
  self. 显式引用、SPKI DER 解析、CLLocationManager import 等）已随实现一并规避；
  本仓工程侧差异：Podfile 未 use_frameworks!（静态库），Swift 仍依赖
  `qux/qux-Bridging-Header.h`（SWIFT_OBJC_BRIDGING_HEADER），文件里 `import React`
  才能解析 RCTEventEmitter / RCTPromiseResolveBlock。
- **仍待跑一轮 `build-ios` 并读 annotations**：改动原生后必须编译验证，
  别把「上游能编译」当本仓能编译（xcconfig / SDK 版本可能有差异）。
- 验收：`ci-ios` workflow 绿；JS 侧 `NativeModules.Base*` 各方法可调用。

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
- 日志可读性：`npm ci` / `pod install` 在该 job 都能过，失败点只在 `xcodebuild`；而 Actions 的
  日志正文需要登录才读得到，无 Mac 的人此前只能看到「exit code 65」。现在构建步骤 `tee` 出
  `/tmp/xcodebuild.log`，失败时把其中的 `error:` 行逐条提成 **annotation**（公开 API 可读）。
- 验收：GitHub Actions 上 `ci-ios` workflow 首次绿。

### 6. 本地 H5 模式真机回归 ⬜

- 装包后确认：本地模式加载 `.app/h5/index.html` 正常（对应 `resolve-h5-entry.ts` iOS 分支）；
  无网时远程模式 30s 超时兜底错误页出现（`REMOTE_H5_LOAD_TIMEOUT_MS`）。

### 7. 占位能力接入（产品决策项，非本轮引入） ⬜（部分完成）

- ✅ 2026-11-11：`BaseCapabilities.scan` 已接入 AVFoundation 自建扫码页
  （格式参数→AVMetadataObject 映射齐全，UPC-A 走 EAN-13 兜底），不再是
  `NOT_IMPLEMENTED` 占位；NFC 读写（`nfcAvailable / nfcReadTag / nfcWriteNdef`）
  已接 CoreNFC——iOS 拿不到标签 UID，`tagId` 恒为空串、内容放 `data.content`。
- ⬜ 通知（`NOTIFICATION.*`）仍需 APNs / RN 推送库接入（本地通知与通知点击
  深链已实现，见 `AppDelegate` 的 UNUserNotificationCenterDelegate）；
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
- ✅ `BaseH5.verifyPackageSignature` 原生实现 + JS 适配器（P2，编译验证 = 待办 #3）
- ✅ iOS 原生能力对齐上游基座最新实现（2026-11-11，见文件头「进展」与待办 #2/#3/#7）
