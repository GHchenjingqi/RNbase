# Phase 00 仓库侦察与基线记录

> 阶段目标：只读审计，不修改任何业务代码 / 依赖。
> 执行日期：2026-10-21
> 依据规范：`docs/voice-accounting/SKILL.md`（v2）
> 环境限制：本机无 Android SDK / Gradle，无法执行 release 构建与真机测试；相关项如实标为「未运行」。

---

## 0. 一句话结论

仓库是一套成熟的 **RN 0.84.1 + WebView(H5) 混合基座**，新架构已开启，Bridge RPC 体系完备且可复用，ABI 已锁定 `arm64-v8a`，release 基线 APK ≈ 25 MB 与文档 §2 基线吻合。

**真正缺失的、也正是本计划要补的能力有两项**：① 语音识别（ASR）——全仓无任何 ASR 引擎，现有 `audio` 模块只做媒体录制（aac/mp3/wav），不能喂 16kHz PCM；② 账单持久化——全仓无任何 SQLite / 数据库。其余 voice 所需的 `voice.*`/`transaction.*` Bridge 方法、模型内置、解析器、H5 UI 都是空白，但都有明确的复用锚点。

---

## 1. 仓库技术栈与架构（证据：package.json / app.json / tsconfig.json）

| 项 | 值 | 证据 |
|---|---|---|
| React Native | **0.84.1** | `package.json` dependencies |
| React | 19.2.3 | `package.json` |
| TypeScript | 6.0.3（devDep，实际继承 `@react-native/typescript-config`） | `package.json` / `tsconfig.json` |
| JS 引擎 | **Hermes 开启** | `platforms/android/gradle.properties` `hermesEnabled=true` |
| 新架构（Fabric/TurboModules） | **已开启** | `platforms/android/gradle.properties` `newArchEnabled=true` |
| 平台 | Android（`platforms/android`）、iOS（`platforms/ios`）、Harmony（OpenHarmony，`@react-native-oh`） | `platforms/` 目录 |
| H5 承载 | `react-native-webview` 加载 `file:///android_asset/index.html` | `platforms/android/app/build.gradle` `assets.srcDirs += ["../../../h5"]` |
| H5 通信 | `postMessage`/`onMessage` + 统一 Bridge RPC | `scripts/api.js`、`src/bridge/*` |

**新架构兼容判断（对应文档 §3.1 / §7 提示）**：虽然新架构开启，但现有所有原生模块（`BaseH5Module`、`BaseCapabilitiesModule`）仍使用 legacy `ReactContextBaseJavaModule` + `@ReactMethod` 模式，并通过新架构的向后兼容 interop 层运行（已随基座编译/打包验证）。因此新增 `VoiceAccountingModule` **沿用同一 legacy 模式风险最低**，文档担心的「传统模块在新架构下需额外处理」在本仓库已被现有代码证明可行；不必强制改写为 TurboModule。

---

## 2. Android Gradle / Kotlin / NDK / AGP（证据：build.gradle、gradle.properties）

- `platforms/android/build.gradle`：`minSdk 24`、`compileSdk 37`、`targetSdk 36`、`ndkVersion 27.1.12297006`、`kotlinVersion 2.2.0`。AGP 版本由 React Native Gradle Plugin 管理，主 build.gradle 未显式钉版本（`classpath("com.android.tools.build:gradle")` 无版本号）。
- `platforms/android/app/build.gradle`：依赖 `com.facebook.react:react-android`、zxing、ML Kit barcode、CameraX、ShortcutBadger、hermes-android。**无 SQLite / sherpa / onnx**。
- Android 工程位置：`platforms/android/`（非标准 `android/`），`root = file("../../../")`，`namespace = "com.qux"`；`applicationId` 由根目录 `version.json` 注入（多 H5 子应用可并排安装）。

### ABI 拆分策略（文档 §3.3 重点）
- **仅 `arm64-v8a`**：`gradle.properties` → `reactNativeArchitectures=arm64-v8a`。
- 实测 `dist/com.rnbaseh5.app/rnbaseh5-0.0.2-release.apk` 的 `lib/` 目录**仅含 `arm64-v8a`**（13 个 `.so`）。
- **结论**：文档 §3.3 担心「未配置 ABI 拆分」在本仓库已通过 `reactNativeArchitectures` 满足，**无需新增 `splits{abi{}}`**。预算中「先优化 ABI（只保留 arm64-v8a）」一项已前置完成，利好 60 MB 体积目标。

### 其它 Gradle 现状
- `enableProguardInReleaseBuilds=false`（release 未开混淆）。
- **未配置 `aaptOptions { noCompress "onnx" }`** → Phase 05 必须补（模型按 assets 加载的关键）。
- `org.gradle.workers.max=2`（防止 release 打包打满 CPU/内存）。

---

## 3. 基线 APK 体积（实测，证据：`find dist -iname "*.apk"` + `du -m`）

| APK | 体积 |
|---|---|
| `RNBase-1.0.0-debug.apk` | 44 MB（debug：含 dev bundle + 全符号） |
| `rnbaseh5-0.0.2-release.apk` | 25 MB |
| `com.qux.guyun/GuYunShiJian-1.0.4-release.apk` | 25 MB |
| 其它 release APK | 25–27 MB |

**结论**：文档 §2 基线「约 25 MB 未含语音」与实测一致（release，arm64-v8a）。体积预算 ≈ 55.1 MB 成立，余量 4.9 MB 充足。

---

## 4. Bridge 现状（复用清单核心，证据：src/bridge/*、scripts/api.js、scripts/dev.js）

这是本计划能否「复用既有 Bridge、不建第二套协议」的关键，已确认如下：

1. **RPC 服务端（唯一）**：`src/bridge/bridge-server.ts` —— module/action 注册、`requestId` 去重、`timeout`、origin 校验、`version` 兼容、`BridgeEventBus` 事件推送、`clearPending()`（reload / 切后台清理悬空 Promise）。**任何 `voice.*` / `transaction.*` 都必须复用它，禁止另建协议。**
2. **H5 SDK 唯一真源**：`scripts/api.js` → 注入 H5 产物（`inject-h5-api.js`）。门面范式 `RN.<MODULE>.<METHOD>(params)`（如 `RN.CAMERA.TAKEPHOTO()`），已含握手（READY）、能力检测、未 ready 请求队列、事件订阅。→ 新增语音只需在 `api.js` 增加 `RN.VOICE` / `RN.TRANSACTION` 门面即可。
3. **RN 侧模块注册中枢**：`src/bridge/index.ts` 已 `import { registerAudioModule }` / `registerSpeechModule` 并在 `createBridgeServer` 中调用（line 119 / 125）。新增 `voice`/`transaction` 须按同模式新增 `registerVoiceModule` / `registerTransactionModule` 并在此注册。
4. **适配器层**：`src/bridge/modules/capabilities/types.ts`（`CapabilityAdapters` 接口）+ `src/middleware/native/capability-native-adapters.ts`（把 `NativeModules.BaseCapabilities` 包成 adapters；原生方法缺失时整块降级为 `undefined` → 桥层回 `DEVICE_UNSUPPORTED`）。→ 新增 voice/transaction 的原生方法按同一降级模式接入。
5. **原生侧**：Android 全部能力集中在单一 `BaseCapabilitiesModule.kt`（`ReactContextBaseJavaModule`，方法名如 `audioStartRecording` / `speechSpeak`）；Harmony 侧为 `BaseCapabilitiesTurboModule.ets`。→ voice/transaction 的原生方法可并入 `BaseCapabilitiesModule.kt`（延续单模块约定），或新建 `VoiceAccountingModule.kt`；两者都走同一 `BridgeServer`，**不算第二套协议**。具体取舍建议 Phase 04 前定（倾向沿用现有单模块以最小改动）。
6. **H5 注入已接进 dev 流程**：`scripts/dev.js:98-111` 在打包前自动执行 `inject-h5-api.js`（覆盖 `scripts/api.js` 到 `h5/` 与活动子应用产物）。→ 扩展 `api.js` 后无需手动注入。

---

## 5. 现有能力清单与缺口（证据：src/bridge/modules/capabilities/*、grep 全仓 ASR/SQLite）

**已实现（Bridge 能力模块）**：scanner(QR)、camera、media、file、location、notification、clipboard、brightness、flashlight、sensor、biometric、contacts、calendar、nfc、bluetooth、**audio（录制/播放）**、storage、networkInfo、qr、image、haptics、**speech（TTS 仅合成）**、appManager、backgroundTask、inAppReview。

**缺失（本计划要补）**：
- **语音识别 ASR**：全仓 grep `sherpa|onnx|vosk|whisper|asr` 仅在 `package-lock.json`、无关 `.kt/.ets` 注释中命中，**无任何 ASR 引擎**。现有 `audio` 模块输出 aac/mp3/wav（媒体用途，见 `capability-native-adapters.ts` `AudioAdapter`），不是 16kHz PCM 16-bit，**不能直接喂 sherpa** → 需独立 `AudioRecord(16kHz, PCM16)` 链路。
- **账单持久化**：全仓 grep `sqlite|SQLite|SQLiteOpenHelper|room|database` **零命中** → 无任何数据库。Phase 07 必须引入。

---

## 6. 权限与清单（证据：platforms/android/app/src/main/AndroidManifest.xml）

- 已声明：`RECORD_AUDIO`、`INTERNET`、`ACCESS_NETWORK_STATE`、`CAMERA`、`READ_MEDIA_IMAGES`、`ACCESS_FINE/COARSE_LOCATION`、`POST_NOTIFICATIONS`、`NFC`、`REQUEST_INSTALL_PACKAGES` 等。→ **`RECORD_AUDIO` 已声明**，语音只需运行时请求 + 拒绝引导。
- **缺失**：录音 > 30s 的 Foreground Service（`foregroundServiceType="microphone"` + 通知渠道）；Android 14+ 还需 `FOREGROUND_SERVICE_MICROPHONE` 权限 → Phase 03 补。
- 离线规则注意：清单中的 `INTERNET` / `ACCESS_NETWORK_STATE` 是既有「远程全量升级」功能所用，**语音链路不得调用**；Phase 09/10 的网络隔离验证须确认语音路径零网络访问。

---

## 7. H5 现状（证据：h5/ 目录、h5-subapp-setup/、scripts/dev.js）

- `h5/` 仅含**构建产物**（`index.html` + hash 资源 `assets/*` + `js/api.js`），**H5 源码不在本仓库**（模板在 `h5-subapp-setup/assets/{vue,react}-template`）。语音记账 UI（Phase 08）需新建 H5 子应用或并入 H5 源仓，**具体源仓位置待 Phase 08 前与项目方确认**。
- H5 以 `file:///android_asset/index.html` 本地加载 → 离线可用（与文档 §2 结论一致）。
- 开发/构建注入已就绪（`npm run dev` 自动 `inject-h5-api`）；扩展 `scripts/api.js` 后自动注入，无需手工。

---

## 8. 数据库策略（Phase 07 决策建议）

全仓无 SQLite。建议：**原生 `SQLiteOpenHelper`（新建 `TransactionRepository.kt`）**，理由：
1. 完全离线、零外部依赖、体积可控，契合 60 MB 预算；
2. 与现有「原生能力集中在 `Base*` 模块」的架构一致；
3. 新架构下第三方 RN SQLite 库（如 `react-native-sqlite-storage`）存在新架构兼容风险，引入反而增加不确定性与体积。
数据访问统一在 `TransactionRepository`，H5 不经手数据库（符合文档 §3.1 约束）。若 Phase 00 后项目方坚持用 JS 库，再在 Phase 07 重新评估。

---

## 9. 兼容性 / 风险表

| 项 | 状态 | 对计划影响 |
|---|---|---|
| RN 0.84.1 + 新架构开启 | 已确认 | 新模块沿用 legacy 模式即可（已验证可行） |
| ABI 仅 arm64-v8a | 已锁定 | 体积预算利好，Phase 10 无需再优化 ABI |
| `noCompress "onnx"` | 缺失 | Phase 05 补；否则模型被压缩/随机访问失败 |
| SQLite | 缺失 | Phase 07 引入（建议原生 SQLiteOpenHelper） |
| ASR 引擎 | 缺失 | 全计划核心；Phase 01 阻塞性门槛 |
| `RECORD_AUDIO` 已声明 | OK | 仅需运行时请求 + 拒绝引导 |
| 前台服务 mic 类型 / 权限 | 缺失 | Phase 03 补（Android 12+ / 14+） |
| H5 源码不在本仓 | 注意 | Phase 08 前需定位源仓 |
| Harmony / iOS 并存 | 注意 | 新增能力不破坏既有（Android 本期优先） |
| 既有 `audio` 模块不能喂 PCM | 注意 | 语音需独立 AudioRecord，不复用 `audio.*` |

---

## 10. 复用清单（供后续阶段直接照抄）

- `BridgeServer` RPC、`BridgeEventBus`、`requestId`/`timeout`/`origin`/`version` 机制 → 全部复用。
- `scripts/api.js` 门面 + 注入流程 → 扩展而非新建。
- `BaseCapabilitiesModule.kt` 单模块约定 + `capability-native-adapters.ts` 降级模式 → 照抄。
- `src/bridge/index.ts` 注册入口 → 新增 `registerVoiceModule` / `registerTransactionModule`。
- `BaseCapabilitiesModule.kt` 中的 `PermissionAwareActivity` 权限请求范式 → 麦克风权限照抄。

---

## 11. 已运行的检查 / 未运行的检查

**已运行（本环境可执行）**
- `npm run typecheck`（`tsc --noEmit`）：**通过，0 错误**（基线健康）。
- 全仓文件/命令级侦察：RN 版本、新架构标志、ABI、Bridge 结构、能力清单、权限、H5 注入流程、SQLite 缺失 —— 全部基于实际文件与命令输出。
- `find dist -iname "*.apk"` + `du -m`：基线 APK 实测体积。

**未运行（环境限制，如实标注，非跳过）**
- **Android `assembleRelease` 构建**：本机无 Android SDK / Gradle，未运行；体积结论取自既有 `dist/` 产物。
- **真机测试 / 飞行模式测试**：无设备，未运行（含 Phase 01 的全部 50 条真人录音评测）。
- **Jest 全量**：46 个测试文件存在、结构健全，但未整体跑；后续阶段按需执行。

---

## 12. Phase 00 DoD 逐项

| DoD | 通过？ | 说明 |
|---|---|---|
| 未修改核心业务逻辑 | ✅ | 纯只读审计，仅新增 `docs/voice-accounting/` 文档 |
| 每结论有文件/命令依据 | ✅ | 上文均附路径与命令输出 |
| RN 版本与新架构状态已明确 | ✅ | 0.84.1 / `newArchEnabled=true` |
| 基线 APK 体积已实测 | ✅ | release 25–27 MB（arm64-v8a） |
| 无法执行的检查明确说明原因 | ✅ | 见 §11 未运行项 |

---

## 13. 下一阶段入口

- **Phase 01（阻塞性门槛：模型基准测试）** 必须在**真机环境**执行：50 条真人录音 + zipformer-zh-14M int8 离线推理，按 §9 Phase 01 七项阈值逐项判定。本环境无法执行，需项目方在真机环境按 SKILL.md 推进。
- Phase 00 已确认：模型选型、assets + `noCompress` 加载方式、ABI（arm64-v8a）、Bridge 复用锚点、SQLite 引入方案等**前置条件在仓库层面均无阻碍**，Phase 01 之后可平滑进入 Phase 02–10。
- **建议**：在真机跑通 Phase 01（金额准确率 ≥ 90%）前，不要开始 Phase 02 的代码集成——这是文档「最终原则」的硬性门槛，跳过会让后续所有工作置于风险中。
