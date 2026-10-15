# Changelog

基座（RNbase）演进记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)，与根目录 `version.json` 的 `versionName` 联动（由 `npm run bump:version` 维护）。

## [Unreleased]

### Fixed（安卓返回键一次误触即退出 App，2026-10-15）
- 根因：容器兜底靠 JS 侧导航事件快照判断 WebView 能否回退，而 react-native-webview v14
  的 ref 上已无 `canGoBack` 命令（命令表只剩 goBack/reload/…）；SPA 同文档路由（`pushState`）、
  hash 路由、错误页重载、回退后再前进等场景快照会过期，快照为 false 时旧实现直接
  `BackHandler.exitApp()` —— 真机表现即「子页面按一次返回键直接退出 App」，
  套壳网站（`remoteUrl` 模式：页面拿不到 Bridge、`native.back` 没人回执）必现。
- Android 新增 `BaseSystem.webViewGoBack()`：在按键那一刻于 UI 线程遍历视图树找到 WebView，
  `canGoBack()` 为真才 `goBack()`，判断与动作在同一原子回调里完成；不依赖 JS 侧 ref 是否已挂上
  （旧实现「WebView 未挂载即退出」也是误杀来源）。
- 新增 `src/webview/back-policy.ts`：退无可退**不再直接退出**，改为提示「再按一次退出应用」
  并给 2s 确认窗口（`EXIT_CONFIRM_WINDOW_MS`）；原生查询失败一律按「退不了」处理，
  宁可多要一次确认也不误杀 App。
- `WebViewBridge`：删除「WebView 尚未挂载就直接退出」分支（改由原生真值兜底）；
  远程模式不再空等 400ms 的 H5 回执（那个 origin 没有 Bridge 通道），直接走容器兜底；
  新增退出提示浮层（不吃事件，2s 自动收起）。
- 单测 `__tests__/webview/back-policy.test.ts` 锁住四条不变量：能回退必回退 /
  第一次按键不退出 / 窗口内二次才退出 / 原生异常不退出。

### Fixed（Android 通知栏重复通知，2026-10-13）
- `BaseCapabilitiesModule.doSendNotification` 修复通知 id 生成缺陷：
  `System.currentTimeMillis() % 10000` 每 10s 回绕，不同通知可能撞 id 相互覆盖
  （通知丢失 + PendingIntent requestCode 互顶），改为进程内 AtomicInteger 自增。
- 新增同 (title, content) 5s 滑动窗口去重：窗口内重复调用（H5 双发、消息重复派发等）
  复用同一 notificationId 原地更新 + `setOnlyAlertOnce` —— 通知栏只保留一条、不重复响铃；
  窗口外视为新消息正常新开一条。去重表按 12 个窗口周期自动清理防内存增长。
- 说明：原生侧无任何「恢复已删通知」机制（全仓库唯一 notify() 调用点，无持久化/重放/重试）；
  若每次进 App 通知重新出现，为 H5 侧在 ready/resume 时重新调用了 SENDNOTIFICATION，
  可查 `filesDir/logs/device-*.log` 的 `notification.sendNotification` 调用记录定位调用来源与次数。

### Changed（ERP→Base 全平台命名去业务化，2026-10-13）
- 依据 ADR-0003 判定线清理业务语义残留（源自抽离前宿主项目「精易ERP」）：
  `ERPCapabilities/ERPNetwork/ERPPermissions/ERPH5/ERPLog/ERPSystem/ERPUpdate` → `Base*`；
  Android 包 `com.qux.erp` → `com.qux.base`；Harmony `ets/erp/` → `ets/base/`；
  占位域名 `mobile-erp.example.com` → `mobile-base.example.com`；`erp://` 示例 → `base://`。
- JS↔原生模块名字符串三平台同步（src 15 文件 + Kotlin 12 + Swift/.m 7 + ets/cpp 8）；
  用户可见权限文案「精易ERP」→「本应用」；`ios.js` doctor 正则同步。
- 收尾清理（第二轮）：修复 `PackageProvider.ets` 残留 `./erp/BasePackage` 断链导入；
  Android 渠道/文件前缀 `erp_notify`/`erp_badge`/`erp_photo_`/`erp_pick_`/`erp_clipboard`/`erp_*` → `base_*`；
  Harmony 蜂鸣资产 `rawfile/erp_beep.wav` → `base_beep.wav`（git mv）及 `erp_*` 临时文件前缀 → `base_*`；
  iOS Info.plist 定位/相机用途描述去除 ERP 业务措辞；
  DEVICE_CAPABILITIES.md、h5-subapp-setup 文档（SKILL/bridge-upgrade-plan/packaging）中
  jingyi/ERP 命名与参数说明同步为 `base_*`/`RNbase`/`__H5_APP_ID__`。
- 验证：tsc/eslint/jest 492/492 全绿；Android gradle 在本机存在预存在的
  settings-plugin Kotlin 编译环境问题（未改动 HEAD 同样失败，与本次无关）。

### Added（P3-3 Bridge 能力清单生成器，2026-10-13）
- `scripts/gen-api-doc.js`：从 `api.js` 注册表生成 `docs/BRIDGE_API.generated.md`（59 方法 + 6 APPMANAGER 特例），
  与 RN 侧注册交叉比对漂移（RN 侧 25 模块未在 H5 SDK 暴露）；`--check` 门禁已接入主 CI。

### Added（iOS 原生预实现 + 真机待办收敛，2026-10-13）
- `platforms/ios/TODO.md`：全部需 Mac/真机/后端值的待办（步骤 + 验收标准），原生待办单一真源。
- `platforms/ios/ExportOptions.plist`：出 ipa 的 `xcodebuild -exportArchive` 模板。
- `BaseCapabilities.swift` 新增 `getDeviceIntegrity` 越狱探针（特征文件 + 沙盒外写入探测，待真机验证）。
- 新增 `BaseH5.swift/.m`：`verifyPackageSignature`（SecKey RSASSA-PKCS1v15-SHA256 + SPKI→PKCS#1 走查，待 Xcode 编译验证）。
- `src/updater/native-signature-verifier.ts`：原生校验适配器（探测 NativeModules.BaseH5 + 手写 base64 + 大包防护阈值），
  orchestrator 校验器优先级：注入 > 原生 > Web Crypto > 无。

### Added（P2 安全与可观测深化，2026-10-13）
- **H5 包签名强制校验**：`H5Manifest.signature` 字段；`H5_UPDATE_PUBLIC_KEY` 配置（version.json `h5PublicKey` 注入）；
  `verifier.ts` 支持 `off/optional/required` 三策略；Web Crypto 版 `defaultSignatureVerifier`（RN 环境需注入原生校验器）；
  `UpdateOrchestrator` 接入签名校验。
- **崩溃上报闭环**：结构化 `CrashRecord` + 可注入 `CrashUploader` + 离线环形缓冲（50）+ `flushCrashReports`
  + 无依赖 `createHttpCrashUploader` 工厂；`CRASH_REPORT_ENDPOINT` 配置。
- **设备完整性/证书锁定策略层**：`src/security/device-integrity.ts`（root/jailbreak 守卫探测，原生未实现降级 unknown）、
  `src/security/ssl-pinning.ts`（`validatePinning` 纯函数，观察模式不误拦）、`TRUSTED_CERT_PINS` 配置。
- **Maestro e2e 脚手架**：`maestro/flows/boot.yaml` + `.github/workflows/ci-e2e.yml`（manual/非阻塞）。

### Added（P1 补齐 iOS，2026-10-13）
- iOS H5 入口分支：原生 `H5BundleBasePath` 拼本地入口，未就绪回退远程/渲染配置缺失错误页。
- `validateClientIds()` 启动校验：占位 clientId 装机前告警。
- `BaseCapabilities.swift` 暴露 `H5BundleBasePath` 常量。
- `scripts/ios-sync-h5.mjs` 资源同步 + `ios.js` doctor/build 增强 + `ios:sync-h5` 脚本。
- `.github/workflows/ci-ios.yml`（macOS runner，独立不阻塞主 CI）。

### Added（P0 韧性地基，2026-10-13）
- `AppErrorBoundary` + `crash-reporter.ts`：渲染期异常兜底、`ErrorUtils` 全局处理器、unhandledrejection 监听。
- `.github/workflows/ci.yml`：typecheck + lint + test PR 门禁。
- `.husky/pre-commit` + `.lintstagedrc.json`：暂存文件检查 + 自动格式化。
- 远程模式主资源加载超时兜底（`REMOTE_H5_LOAD_TIMEOUT_MS`）。
- 配置修复：新增 `.prettierrc`（printWidth:100）、`.eslintignore` 补 RNOH 第三方源码。

### Added（P3 基座能力补全，2026-10-13）
- `src/config/remote-config.ts`：Feature Flag 远程配置（TTL 缓存 + last-known-good 降级 + 类型收窄）。
- `docs/ADR/`：0001（RN 0.84.1 固定）、0002（两条升级链路）、0003（基座/业务范围边界）。

### Changed
- 范围裁定（ADR-0003）：i18n / 主题 Design Token / 业务埋点**不做**，归 H5 业务层职责。

### 测试基线
- 全量 `npm test`：**492 用例**（P0 前 439 → P0 后 443 → P1 后 449 → P2 后 472 → P3 后 479 → P3-3 后 484 → iOS 原生预实现后 492）。
