# Changelog

基座（RNbase）演进记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)，与根目录 `version.json` 的 `versionName` 联动（由 `npm run bump:version` 维护）。

## [Unreleased]

### Added（P3-3 Bridge 能力清单生成器，2026-10-13）
- `scripts/gen-api-doc.js`：从 `api.js` 注册表生成 `docs/BRIDGE_API.generated.md`（59 方法 + 6 APPMANAGER 特例），
  与 RN 侧注册交叉比对漂移（RN 侧 25 模块未在 H5 SDK 暴露）；`--check` 门禁已接入主 CI。

### Added（iOS 原生预实现 + 真机待办收敛，2026-10-13）
- `platforms/ios/TODO.md`：全部需 Mac/真机/后端值的待办（步骤 + 验收标准），原生待办单一真源。
- `platforms/ios/ExportOptions.plist`：出 ipa 的 `xcodebuild -exportArchive` 模板。
- `ERPCapabilities.swift` 新增 `getDeviceIntegrity` 越狱探针（特征文件 + 沙盒外写入探测，待真机验证）。
- 新增 `ERPH5.swift/.m`：`verifyPackageSignature`（SecKey RSASSA-PKCS1v15-SHA256 + SPKI→PKCS#1 走查，待 Xcode 编译验证）。
- `src/updater/native-signature-verifier.ts`：原生校验适配器（探测 NativeModules.ERPH5 + 手写 base64 + 大包防护阈值），
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
- `ERPCapabilities.swift` 暴露 `H5BundleBasePath` 常量。
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
