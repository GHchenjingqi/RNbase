# Changelog

基座（RNbase）演进记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)，与根目录 `version.json` 的 `versionName` 联动（由 `npm run bump:version` 维护）。

## [Unreleased]

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
- 全量 `npm test`：**479 用例**（P0 前 439 → P0 后 443 → P1 后 449 → P2 后 472 → P3 后 479）。
