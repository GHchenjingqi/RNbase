# RN + H5 基座（qux）

React Native + WebView + H5 混合架构。RN 作为稳定的 App Runtime / Native Container，WebView 承载 H5 子应用，Native Bridge 是两者之间唯一受控的能力边界。本项目为通用基座，不承载业务功能，仅持续扩展 RN 设备能力。

## 配套仓库（两仓配合使用）

| 仓库 | 角色 | 与基座的关系 |
|---|---|---|
| **RNbase**（本仓库） | RN 基座 / Native Container | 提供 WebView 容器、Bridge 服务端与全部原生能力 |
| [RN_h5](https://github.com/GHchenjingqi/RN_h5) | **能力测试子应用**（`base_h5`） | 构建产物同步进本仓库 `h5/`，随 APK 打进 assets，WebView 以 `file:///android_asset/index.html` 加载 |

约束与契约：

- H5 侧**只能**通过 `window.RN` 中间件调原生，能力清单的唯一真源是本仓库 `scripts/api.js`；
  子应用的 `public/js/api.js` 与产物 `dist/js/api.js` 都由它同步而来，**md5 必须一致**
  （`npm run sync:api` / `node scripts/inject-h5-api.js <dist>`）。
- 本地开发请把两仓放在同级目录，基座名 `app_base`、子应用名 `app_h5`；
  子应用侧的注入/下发脚本按同级 `app_base` 定位基座，目录名不同或缺失时用 `BASE_DIR` 指定。
- 子应用的品牌与版本（应用名/包名/图标/闪屏）由子应用自己持有，基座不内置具体 App 值，
  详见「子应用品牌与版本」。

## 功能模块

### M1 基座能力（P2-P6）

- **WebView 基座**：`WebViewController` 状态机（idle/loading/loaded/error）、域名白名单导航、结构化错误分类、加载中/错误页组件
- **Bridge 协议**：版本解析与兼容性、协议校验（RequestIdTracker 防重放）、事件总线、BridgeServer（timeout/origin 白名单/version 检查/pending 管理/event 推送/listMethods）
- **H5 SDK**：BridgeClient（事件订阅 on/off/once + 能力检测 getCapabilities/supports + 握手态机
  `STATE/ISREADY/WAITUNTILREADY/QUEUESIZE`）、Native 门面（`scripts/api.js`：15 个模块 + `RN.APPMANAGER`
  驼峰特例挂载）、mockTransport（可配置场景）、环境自动探测
- **Native 能力**：41 个 Bridge 模块注册（`src/bridge/index.ts`）。业务侧 auth / system（vibrate/copy/share/
  darkmode/language/screen/accessibility/deviceInfo/battery）/ notification（getToken/setBadge/playSound/
  sendNotification）/ permission（check/request/**requestAll** 批量）/ log；能力侧 camera / scanner（ML Kit）/
  media / file / location / **clipboard** / **appManager**（检测安装·拉起外部 App·应用市场·系统设置分区）/
  nfc / **update**（整包 APK 远程升级，仅 Android）；容器侧 toast / dialog / orientation / statusBar /
  **keyboard** / navigation / webView / device / battery
- **返回键与键盘**：硬件/手势返回不再直接 finish Activity，改推 `native.back` 事件给 H5 决策，
  H5 用 `app.nativeBackResult({ consumed })` 回执（400ms 超时由容器兜底 goBack/退出）；
  软键盘显隐推 `keyboard.change`，edge-to-edge 下避让交给 H5
- **H5 Runtime**：H5VersionManager（checkForUpdate/update/markReady/markFailed/rollback）、H5Runtime、BootStateMachine、InMemoryH5Storage

### M2 动态化运行时（P7-P8）

- **动态 H5 更新（P7）**：8 个组件
  - `update-state.ts`：更新状态机（IDLE→CHECKING→AVAILABLE→DOWNLOADING→VERIFYING→INSTALLING→READY_TO_ACTIVATE→ACTIVATING→SMOKE_TEST→STABLE，含 7 个失败态）
  - `manifest-client.ts`：Manifest 拉取（latest/版本 manifest、短缓存、字段校验）
  - `update-checker.ts`：版本比较 + minAppVersion/maxAppVersion/bridgeVersion 兼容性判定 + 灰度识别（百分比/租户/用户/设备/平台）
  - `downloader.ts`：包下载（指数退避重试、进度回调、网络策略 Wi-Fi/蜂窝/后台/充电）
  - `verifier.ts`：SHA-256 校验 + 包大小校验 + 可选数字签名校验
  - `installer.ts`：staging 安装 → 解压 → 文件完整性检查 → 提交到 versions（绝不覆盖 current）
  - `activator.ts`：原子切换 current 指针（切换失败自动回滚到 previous）
  - `update-orchestrator.ts`：编排器（协调全链路 + 检查节流 24h + 冷启动激活策略 + 强制更新检测）
- **失败回滚（P8）**：3 个组件
  - `rollback-manager.ts`：版本状态记录（current/previous/pending/launchStatus）+ testing→stable 启动确认 + 自动回滚 + 熔断黑名单 + 连续回滚保护（超阈值进 fallback）+ 持久化
  - `boot-failure-detector.ts`：启动失败检测（WebView load error / JS crash / handshake 失败 / READY 超时）+ 触发自动回滚 + WebView 事件适配器
  - `WebViewErrorPage.tsx`：错误页升级（「重新加载」「使用上一版本」「联系客服」三按钮 + 版本/网络状态展示）

### 整包远程升级（与 H5 子包更新是两条链路）

- **桥接模块**：`src/bridge/modules/update.ts`（getInfo / startDownload / getProgress / cancelDownload /
  install / canRequestInstall / openInstallSettings / copyToDownloads / cleanup）
- **为什么拆「起任务 + 轮询」**：H5 侧 Bridge 请求超时 30s，几十 MB 的 APK 必然超时；
  `startDownload` 毫秒级返回，原生后台线程继续下载，`getProgress` 轮询取状态
- **原生实现**：`ERPUpdateModule.kt`（HttpURLConnection → `.part` 落盘 → 尺寸核对 → zip 魔数 →
  SHA-256 → rename → FileProvider 拉起安装器），任务用「世代号」取消，旧回调自动失效
- **权限**：`REQUEST_INSTALL_PACKAGES` 属特殊访问权限，需 `canRequestInstall` 检测 +
  `openInstallSettings` 引导用户授予；未授权原生回 `INSTALL_PERMISSION_DENIED`，
  适配层映射为 `PERMISSION_DENIED`（不是安装失败）
- **仅 Android**：iOS 由 App Store 分发，适配器缺失 → 全部方法 `DEVICE_UNSUPPORTED`
- **校验值来源**：`npm run build:android` 成功后在 APK 旁写 `<apk>.sha256.txt`（`scripts/apk-hash.js`）

### P11 文件与图片

- **图片链路**：拍照/相册统一入口、图片压缩（质量/最大尺寸/EXIF 方向校正）、多选/预览/保存、内存控制、临时文件清理
- **文件链路**：file.pick 统一选择（name/size/mimeType/uri 元数据）、file.download（进度/通知/断点策略）、file.open（系统能力打开）、Android Scoped Storage/iOS 差异收敛到 platform adapter
- **上传体验**：基于 URI 走受控上传通道、上传进度（200ms 节流）、取消/失败重试/弱网续传、多图批量上传队列、并发控制、上传前校验（类型/大小 FILE_TOO_LARGE/数量上限）
- **红线落实**：全链路无 Base64 穿桥，Bridge 只传 URI/元数据，文件本体走 Native 文件能力或受控上传通道

### P13 可观测性

- **统一日志模型**：timestamp/appVersion/bridgeVersion/h5Version/platform/requestId/event/errorCode/duration（+ module/action/networkType 按需）
- **五类日志采集**：
  - App Log：启动状态机、生命周期、崩溃、网络切换
  - Bridge Log：请求/响应/事件、耗时、错误码（requestId 贯穿）
  - H5 Error：window error / unhandledrejection / 资源加载失败（经 Bridge 上报）
  - Update Log：更新状态机每次流转、下载/校验/安装/回滚结果
  - WebView Error：onError/onHttpError/白屏/READY 超时统一归类
- **日志脱敏层**：敏感 key 替换（token/password/身份证/手机号/邮箱等）、字符串值自动掩码、URL query 参数脱敏、允许字段跳过脱敏
- **本地环形缓冲 + 批量/节流上报**：限制内存占用（默认 1000 条）、批量阈值（默认 20 条）、上报间隔（默认 5s）、弱网缓存 + 恢复后补报、最大重试（默认 3 次）
- **诊断查询**：最近错误、更新历史、requestId 全链路追踪

### P14 性能优化

- **性能监控器**：指标采集（start/end/record）、8 项默认基线（冷启动/热启动/首屏/Bridge/下载/压缩/上传/JS 长任务）、告警（超过阈值 warning/critical）、性能报告（P50/P95/P99 统计）
- **高频事件节流器**：leading/trailing/maxWait 配置，禁止每 10ms 级别的穿桥事件（规范 §61 红线）
- **批量请求合并器**：减少 Bridge 往返，可合并的请求提供批量接口（maxBatchSize/maxWaitMs）
- **内存监控器**：定期采样、警告/严重阈值告警、内存泄漏检测（持续增长率）、JS 堆大小采集
- **临时文件清理器**：过期文件清理（默认 24 小时）、超容量清理（默认 100MB）、定期清理（默认 1 小时）

## 目录结构

```
qux/
├── platforms/                  # 原生平台工程（跨平台）
│   ├── android/                #   Android 原生工程（Gradle，已从根目录移入）
│   └── ios/                    #   iOS 原生工程（Xcode / CocoaPods）
├── harmony/                    # 鸿蒙原生工程（RNOH / DevEco，hvigor 构建）
│   ├── AppScope/               #   bundleName（com.qux.hmos）、应用级字符串
│   ├── entry/                  #   主 Module：ArkTS 自研 TurboModule（ets/）+ C++ 注册表（cpp/）
│   │   └── src/main/resources/rawfile/assets/h5/   # 内置 H5（由根 h5/ 在构建时拷入）
│   ├── build-profile.template.json5  # 入库模板（无签名）；实际 build-profile.json5 不入库
│   └── oh-package.json5        #   指向 node_modules 里的 RNOH HAR（路径是 hvigor 硬约束，故工程必须在根目录）
├── h5/                         # H5 子应用产物（仅保留 RN 通信能力 + 设备能力调试台）
│   └── index.html              #   H5 入口；由活动子应用构建产物同步而来（不在仓库内）
├── h5-subapp-setup/            # H5 子应用 Skill（必备条件/搭建/打包 + Vue/React 模板）
├── src/                        # RN 侧源码（App Runtime）
│   ├── app/                    #   应用装配：组合根、启动状态机、Bridge 组装、H5 入口解析
│   ├── webview/                #   WebView 容器：加载 H5、消息桥接、错误页
│   ├── bridge/                 #   Bridge 协议：server / client / modules（H5↔RN 唯一通道）
│   │   ├── client/             #     H5 SDK：BridgeClient / Native 门面 / mockTransport
│   │   └── modules/            #     41 个 Native 模块（业务 / 能力 / 容器，见上）+ capabilities/ 适配器契约
│   ├── middleware/             #   原生能力中间件
│   │   ├── network/            #     网络状态（nativeNetworkAdapter / networkModule）
│   │   └── native/             #     设备能力适配（capability / system / update 原生适配器，缺失逐项降级）
│   ├── media/                  #   文件与图片（P11）
│   │   ├── image-service.ts    #     图片服务：拍照/相册/压缩/多选/预览/保存
│   │   ├── file-service.ts     #     文件服务：选择/下载/打开/校验
│   │   ├── upload-queue.ts     #     上传队列：进度/取消/重试/弱网续传/批量
│   │   ├── mock-adapter.ts     #     Mock 平台适配器（可替换为真实原生实现）
│   │   └── types.ts            #     统一类型定义
│   ├── observability/          #   可观测性（P13）
│   │   ├── log-manager.ts      #     日志管理器：环形缓冲/批量上报/诊断查询
│   │   ├── collectors.ts       #     五类日志采集器（App/Bridge/H5/Update/WebView）
│   │   ├── redact.ts           #     日志脱敏层
│   │   └── log-entry.ts        #     统一日志模型
│   ├── performance/            #   性能优化（P14）
│   │   ├── performance-monitor.ts  # 性能监控器：指标采集/基线/告警/报告
│   │   ├── optimizers.ts       #     节流器 + 批量请求合并器
│   │   ├── memory-and-cleanup.ts   # 内存监控器 + 临时文件清理器
│   │   └── types.ts            #     性能类型定义
│   ├── updater/                #   H5 动态更新（M2 P7-P8）
│   │   ├── update-state.ts     #     更新状态机
│   │   ├── manifest-client.ts  #     Manifest 客户端
│   │   ├── update-checker.ts   #     更新检查器（版本/兼容性/灰度）
│   │   ├── downloader.ts       #     下载器（重试/进度/网络策略）
│   │   ├── verifier.ts         #     校验器（SHA-256/大小/签名）
│   │   ├── installer.ts        #     安装器（staging/解压/完整性）
│   │   ├── activator.ts        #     激活器（原子切换）
│   │   ├── update-orchestrator.ts  # 编排器（节流/激活策略/强制更新）
│   │   ├── rollback-manager.ts #     回滚管理器（熔断/连续回滚保护/持久化）
│   │   └── boot-failure-detector.ts # 启动失败检测器
│   ├── permissions/            #   权限管理（Android / iOS / 鸿蒙 adapter + Provider）
│   ├── storage/                #   存储（InMemoryH5Storage）
│   ├── diagnostics/            #   日志与诊断（结构化日志 + 脱敏 + 鸿蒙原生能力自检）
│   ├── platform/               #   平台判定唯一入口（os.ts：currentOs / isHarmony / isIos）
│   ├── config/                 #   配置
│   └── components/             #   RN UI 组件
├── App.tsx                     # RN 入口：WebView 加载 H5 入口资源
├── index.js                    # 注册入口
├── scripts/                    # 一键脚本：安卓（dev/gradle/emulator/stop）+ 鸿蒙（harmony-*/hvigor）+ iOS（ios.js）+ doctor
├── dist/                       # 打包产物投递目录（按包名分目录，切换子应用互不混淆）
│   └── <applicationId>/        #   <apkName>-<versionName>-<variant>.apk / .hap（构建后校验版本与包名一致才投递）
├── log/                        # 运行日志目录（Metro/Gradle 日志统一输出）
├── react-native.config.js      # RN CLI 配置：platforms 路径映射
├── metro.config.js             # Metro 配置：H5 资源打包 + 构建目录排除 + .js 资源中间件
├── app-registry.json           # 活动子应用注册表（activeApp + 各子应用目录 / 产物目录）
└── __tests__/                  # 根级测试（全部单测集中于此，src 下不存放测试文件）
    ├── webview/                #   WebView 测试（navigation/error-handler）
    ├── bridge/                 #   Bridge 测试（version/schema/eventBus/BridgeServer/h5-sdk/native-modules/h5-runtime）
    ├── updater/                #   更新测试（dynamic-update 38 测试 / rollback 26 测试）
    ├── media/                  #   文件与图片测试（38 测试）
    ├── observability/          #   可观测性测试（32 测试）
    └── performance/            #   性能优化测试（39 测试）
```

## H5 子应用 Skill（h5-subapp-setup）

项目根 `h5-subapp-setup/` 自带一个 AI Skill，用于 H5 子应用开发（WebView 静态子包 + Bridge + 动态升级）：

- `SKILL.md`：主文档（6 条硬约束 + 工作流程 + 验收清单）
- `references/`：必备条件清单、Vue3 / React 搭建、打包发布指南
- `scripts/api.js`：模板 `js/api.js` 的同步来源（已迁移至项目根 `scripts/api.js`，与基座 `h5/js/api.js` 一致）
- `assets/vue-template/`、`assets/react-template/`：可直接复制的 Vue3 / React 最小可运行子包工程（`js/api.js` 取自根 `scripts/api.js`）

### 安装到本地 AI 环境

AI 环境通过 `<workspace>/.user_skills/` 目录自动发现 Skill，将该目录复制过去即可：

```powershell
# Windows PowerShell
Copy-Item -Recurse -Force .\h5-subapp-setup "$env:LOCALAPPDATA\Doubao\User Data\Default\.doubao\agent_mode\workspace\.user_skills\"
```

```bash
# Linux / macOS
cp -r h5-subapp-setup ~/.doubao/agent_mode/workspace/.user_skills/
```

> 安装后即可通过「搭一个 H5 子项目 / H5 环境搭建 / 检查 H5 是否符合基座要求」等描述自动触发。
> 同步链：基座 `h5/js/api.js` → 项目根 `scripts/api.js` → 两个模板的 `js/api.js`；子应用打包时
> 用 `node scripts/inject-h5-api.js <dist>` 从根 `scripts/api.js` 覆盖产物 `dist/js/api.js`。
> 基座协议升级时先覆盖根 `scripts/api.js`，再运行 `npm run sync:api` 同步模板与基座 H5。

## 职责边界

- **RN（src/）**：App 启动、生命周期、WebView 容器、Native Bridge、权限、原生能力、H5 包管理/更新/回滚、网络状态、文件与图片、可观测性日志、性能监控。
- **H5（h5/）**：H5 子应用（仅保留与基座的 Bridge 通信能力 + 设备能力调试页），只通过 Bridge SDK 接触 Native，不出现 `window.ReactNativeWebView`。
- **middleware/**：网络、设备能力等原生能力适配层，供 Bridge 模块装配。
- **media/**：文件与图片完整链路（拍照/相册/压缩/选择/下载/上传），大文件不走 Base64 穿桥。
- **observability/**：五类日志统一采集、脱敏、上报、诊断。
- **performance/**：性能指标采集、基线管理、告警、优化工具（节流/批量/内存监控/临时文件清理）。

## 常用命令

命令按平台加后缀（`:android` / `:harmony` / `:ios`），三个平台互不共用一条命令；
`npm run dev` / `npm run emulator` 是安卓的短别名，等价于 `dev:android` / `emulator:android`。

```sh
# ── 构建环境自查（改完环境先跑它）──────────────────
npm run doctor                  # 只读自查：依赖/活动子应用/version.json/h5 产物/api.js 漂移/qux.* 配置/
                                # hermesc，末尾「平台链路」一节报清安卓/鸿蒙/iOS 各自差什么

# ── 安卓（默认链路，Windows/Linux 可完整出包）──────
npm run dev                     # 一键：释放 8082 + 后台起 Metro + adb reverse + 构建安装 + 启动 App
npm run dev:android             #   同上（平台显式别名）
npm run emulator                # 启动 Android 模拟器（Pixel_10）并等待 boot_completed
npm run emulator:android        #   同上（平台显式别名）
npm run stop                    # 一键停止：关闭 App + 释放 8082 进程树 + gradlew --stop（并打印 --status）
                                #   连了鸿蒙设备时同时 force-stop 鸿蒙 App 并清掉 8081 反向转发
npm run build:android           # 打包 debug APK → dist/<applicationId>/<apkName>-<version>-debug.apk
npm run build:android:release   # 打包 release APK（正式签名）→ 同目录
npm run build:android:install   # 构建并安装到已连接设备（成功后自动 adb reverse Metro）
npm run clean:android           # 清理 Android 构建产物
npm run apk:hash                # 给 dist/ 下最新 APK 补写 <apk>.sha256.txt，并打印可粘贴的升级清单字段

# ── 鸿蒙（RNOH）：命令齐全，但必须先过 harmony 依赖闸，见「鸿蒙（RNOH）」──
npm run emulator:harmony        # 启动 DevEco 鸿蒙模拟器并等待 boot_completed
npm run dev:harmony             # 释放 8082 并前台起 Metro（转发与装机在 install:harmony）
npm run build:harmony           # assembleHap(debug) → dist/<applicationId>/<name>-<version>-debug.hap
npm run build:harmony:release   # assembleHap(release)
npm run install:harmony         # 构建 HAP + 配 hdc 端口转发 + 装包 + 拉起 EntryAbility（debug 包需 Metro 在跑）
npm run clean:harmony           # 清理鸿蒙构建产物（hvigor clean）

# ── iOS（预留位：出包只能在 macOS，Windows/Linux 上明确拒绝而不是抛 xcodebuild 报错）──
npm run ios:doctor              # 只读体检，任何平台都能跑：工程/Podfile.lock/workspace/自研模块 + 已知缺口
npm run ios:pods                # pod install（macOS）
npm run dev:ios                 # Metro + run-ios（macOS）
npm run build:ios               # xcodebuild 模拟器 Debug（macOS，只验证能否编过，不出 ipa）
npm run build:ios:release       # 当前按设计直接拒绝：缺签名与 ExportOptions.plist 参数，见「iOS（预留位）」

# ── 子应用与品牌（应用名/包名/图标/闪屏由子应用持有）──
npm run app:show                # 查看当前活动子应用（目录/产物/配置来源）
npm run app:use -- cammer_h5    # 切换活动子应用并重新下发品牌（加 -- --sync 同步其产物到 h5/）
npm run brand:apply             # 仅重新下发品牌：app.config.json → version.json + res/ 图标闪屏 + 鸿蒙名称版本
npm run brand:gen -- --src <主图.png> --out <app-brand/android>   # 一张主图切出五密度图标/闪屏
npm run brand:reset           # 复原成中性基座（提交基座前跑；见「品牌下发」一节）

# ── 版本迭代 ─────────────────────────────────────
npm run version:show            # 查看活动子应用当前版本（读 app.config.json）
npm run version:bump            # 补丁 +0.0.1（1.0 → 1.0.1，默认）
npm run version:bump:patch      # 补丁 +0.0.1（1.0.1 → 1.0.2）
npm run version:bump:minor      # 次版本 +0.1（1.0 → 1.1）
npm run version:bump:major      # 主版本 +1（1.0 → 2.0）

# ── 常规 / 质量 ──────────────────────────────────
npm run typecheck          # tsc --noEmit
npm run lint               # eslint
npm test                   # jest（__tests__/ 全部测试）
```

### 三平台支持状态

| 平台 | 命令前缀 | 产物 | 当前状态 |
|------|----------|------|----------|
| Android | `:android`（或短名 `dev`/`emulator`） | APK | ✅ 完整链路，已验证到装机 |
| HarmonyOS | `:harmony` | HAP | ⚠️ 工程与脚本已就位；**仓库未装 RNOH 依赖**（RN 0.87.1 与 RNOH peer 精确锁的 0.84.1 冲突），装上前所有 `:harmony` 命令会被闸掉 |
| iOS | `:ios` / `ios:` | — | 🔒 预留位：原生模块已在，H5 入口与 `CLIENT_ID.ios` 未接，`ios:doctor` 会逐条列出 |

### 构建环境例外配置（可选）

某些机器上 Gradle 的共享缓存或 `aapt2` 会被安全软件干扰（表现为 `AAPT2 Daemon startup failed`、
「immutable workspace」报错、构建产物是 0 字节的 GUI 启动器等）。基座支持**只对本工程**生效的两个逃生口，
写在 `platforms/android/local.properties`（不入库）或用环境变量覆盖：

```properties
# platforms/android/local.properties
qux.gradleUserHome=D:/Android/gradle-home-qux   # 隔离 gradle 缓存，不污染共享 ~/.gradle
qux.aapt2FromMaven=D:/path/to/real/aapt2.exe    # 指定未被替换的 aapt2 真身
```

等价环境变量：`QUX_GRADLE_USER_HOME`。`npm run doctor` 会先校验 hermesc 能否产出真字节码，
构建脚本（`scripts/gradle.js` / `scripts/dev.js` / `scripts/stop.js`）自动带上上述参数。

## 鸿蒙（RNOH）

`harmony/` 是 DevEco / hvigor 工程，RN 侧靠 `@react-native-oh/react-native-harmony`（RNOH）跑在上面。
**当前仓库状态：源码与脚本已就位，RNOH 依赖没装**，所以所有 `:harmony` 命令都会在闸上退出并打印判据，
安卓 / iOS 链路不受任何影响。判据集中在 `scripts/harmony-ready.js`（`npm run doctor` 的「平台链路」一节同源）。

### 为什么不能直接 `npm i` 就完事

实测（jingyi 基座 `node_modules/@react-native-oh/react-native-harmony/package.json`）：
RNOH **0.84.4** 的 `peerDependencies` 把 `react-native` **精确锁在 0.84.1**，而本基座主干是 **0.87.1**。
这不是「装装看」能过关的：装上就会把安卓侧一起拖回旧版本（babel / metro / @react-native/* 一整套都得跟着降）。
两条路，选一条再动手：

- 整仓降到 RN 0.84.1（含 `@react-native/*` 0.84.1 配套），三平台共用一份依赖；
- 等 RNOH 出适配 0.87 的发布线（届时只需换版本号，`harmony-ready.js` 的兜底数字会自动让位给包内 peer）。

### 依赖装法（降到 RN 0.84.1 之后）

```sh
npm i @react-native-oh/react-native-harmony@0.84.4
npm i @react-native-ohos/react-native-safe-area-context@5.6.4   # 提供 harmony/safe_area.har
npm i @react-native-ohos/react-native-webview@13.16.3-rc.3      # 提供 harmony/rn_webview.har
npm i -D @react-native-oh/react-native-harmony-cli@0.84.4       # hvigor-config.json5 直接引用它内部的插件 tgz
cd harmony && ohpm install                                      # 解析 oh-package.json5 里的 file:../node_modules/...
```

`harmony/oh-package.json5` 用 `file:../node_modules/...` 指到 RN 侧依赖 —— **这就是 `harmony/` 必须待在仓库根、
不能塞进 `platforms/` 的原因**（hvigor 插件按 `process.cwd()/../node_modules` 找依赖，路径写死在插件里）。

### 日常开发

```sh
npm run emulator:harmony     # 起 DevEco 模拟器（多实例时用 HOS_EMULATOR_NAME=<实例名> 指定）
npm run dev:harmony          # 只做一件事：释放 8082 并前台起 Metro（另开终端跑 install:harmony）
npm run install:harmony      # 出 debug HAP + 配两条 hdc 转发(8081→8082 / 5173) + 装包 + 拉起 EntryAbility
```

- **端口**：宿主 Metro 用 **8082**，但设备上 RNOH 固定请求 **8081**，靠 `hdc rport tcp:8081 tcp:8082` 补这一段；
  拆卸必须用 `hdc fport rm`（`hdc rport rm` 会回 `Incorrect forward command`）。`npm run stop` 已处理。
- **H5**：debug 走宿主机 vite（`http://127.0.0.1:5173/`，需要子应用 `npm run dev` + 上面那条 5173 转发），
  release 走内置 `asset://h5/index.html`。`scripts/hvigor.js` 每次构建前把根 `h5/` 拷进
  `entry/src/main/resources/rawfile/assets/h5/`，裸 `file://` 会被 ArkWeb 拒掉（17100003，直接崩进程）。
- **hdc 永远返回 0**，成功与否只能看输出里的 `[Fail]` / `[Empty]`；装包走
  `hdc file send` → `hdc shell bm install -p` → `hdc shell aa start -a EntryAbility -b <bundleName>`。
- **签名**：`harmony/build-profile.json5` 不入库，首次构建由 `build-profile.template.json5` 复制而来，
  默认无签名 → 产物是 unsigned HAP，**只有模拟器接受**；真机要在 DevEco 里配好签名后再 `install:harmony`。
- **不要 gradle 与 hvigor 并发**：本机 24C/32G，两边同时全量编译（鸿蒙侧还带 LTO+PGO）会 OOM。
  `hvigor.js` 已固定 `CMAKE_BUILD_PARALLEL_LEVEL=6`，可用 `HVIGOR_JOBS` 覆盖。
- Windows 上 spawn `.bat` 必须补 `OS=Windows_NT`（否则批处理无限递归）、`HERMES_V1_ENABLED=true`、
  `DEVECO_SDK_HOME` / `NODE_HOME`；工具位置可用 `DEVECO_HOME` / `HVIGORW` / `HOS_HDC` / `HOS_EMULATOR` 指定。
- 上机后先跑 `runHarmonyNativeSelfTest`（`App.tsx` 里自动触发，结果写设备日志），
  它逐项探测自研 TurboModule 是否真的注册成功——比看页面黑不黑可靠得多。

### 能力差异（必读）

鸿蒙侧能力**不是**安卓的子集，Bridge 契约不变但落地方式有别：未注册的方法（`appInstalled` / `appOpen` /
`appOpenStore` / NFC）在 JS 侧一律报 `DEVICE_UNSUPPORTED`，H5 据此隐藏入口；剪贴板走自研
`clipboardSetString/GetString/HasString` 而不是 RN `Clipboard`；安全区是纯 JS 替身。
逐条清单见 `DEVICE_CAPABILITIES.md`「鸿蒙（RNOH）差异」。

## iOS（预留位）

iOS 命令面已经齐（`ios:doctor` / `ios:pods` / `dev:ios` / `build:ios`），但**链路没通**，差两件实事：

1. **H5 入口**：`src/app/resolve-h5-entry.ts` 兜底返回的是安卓专属的
   `file:///android_asset/index.html`，iOS 上该路径不存在，需要改成 Bundle 内资源路径
   （原生侧目前也没有对应的方法）——现状是装机后 WebView 白屏。
2. **clientId**：`src/config/index.ts` 的 `CLIENT_ID.ios` 仍是 `PLEASE_SET_IOS_CLIENT_ID` 占位值。

`npm run ios:doctor` 在任何平台都能跑（只读），会把工程状态、自研原生模块和上面两条缺口一起列出来；
`pods` / `run` / `build` 在非 macOS 一律明确拒绝，不会甩一句 `Command failed: xcodebuild` 让人猜根因。
`build:ios:release` 同样按设计拒绝：archive 需要签名与 `ExportOptions.plist`，参数还没固化进仓库。

## 测试覆盖

| 模块 | 测试套件 | 测试数 |
|------|----------|--------|
| WebView | navigation / error-handler / webviewBridge / controller（加载态与 canGoBack）/ safe-area-mode（安全区两条路互斥） | 28 + … + 6 + 5 |
| Bridge | version / schema / eventBus / BridgeServer / h5-sdk / native-modules / h5-runtime / system-info / deviceLogger | 64 + 19 + 16 + 24 + … |
| Bridge（本轮补齐） | **update**（整包升级参数校验与原生码映射）/ **permission-module**（含 requestAll 批量）/ **native-back**（返回键链路） | 见 `npm test` |
| 能力适配 | capabilities / **capabilityNativeAdapters**（clipboard/appManager 逐项降级） | 见 `npm test` |
| 权限 / 网络 / 生命周期 | PermissionManager / networkModule / networkNativeAdapter / lifecycle / appComposition / logger / App | 见 `npm test` |
| M2 动态更新 | dynamic-update（P7）/ rollback（P8） | 38 + 26 |
| P11 文件与图片 | media | 38 |
| P13 可观测性 | observability / file-log-writer | 32 + … |
| P14 性能优化 | performance | 39 |
| 基座 + URL（远程站点模式） | remoteH5Mode（入口短路 / remoteUrl 校验 / 导航白名单）/ appRootRemoteMode（启动状态机分支） | 12 + 8 |
| **合计** | **34 套件** | **439**（`npm test` 实测） |

> 表内旧数字来自补齐前的统计，只有本轮实测的行是最新值。
> `npm run typecheck` / `lint` / `test` / `format:check` 需先 `npm ci` 安装依赖后执行；
> 当前基线：tsc 无错、eslint 0 error 0 warning、prettier 全部通过。

## 子应用品牌与版本（一次下发，多处生效）

一个基座可承载多个 H5 子应用，**应用名 / 包名 / APK 名 / 版本 / 图标 / 闪屏全部由子应用持有**，
基座不内置任何具体 App 值：

```
<子应用>/app.config.json  ──┐
<子应用>/app-brand/android/  ├─ scripts/apply-app-meta.js ─→ app_base/version.json（派生）
                             │                            └→ res/：strings · colors · splash · mipmap
app_base/app-registry.json  ─┘  （activeApp 决定「当前承载哪个子应用」）
```

```json
// <子应用>/app.config.json —— 版本与品牌的唯一真源
{
  "appName": "青颜相机",            // 桌面显示名（res/values/strings.xml）
  "apkName": "QingYanCamera",       // APK 文件名前缀
  "applicationId": "com.qux.cammer",// 包名：与其它子应用不同即可并排安装、互不覆盖
  "versionName": "1.1.6",           // 命名版本：patch 为 0 显示 x.y，否则 x.y.z
  "versionCode": 5,                 // 整数版本：每次迭代自动 +1
  "splashBackgroundColor": "#08080D"
}
```

`app_base/version.json` 是**构建期派生产物**（由 `build.gradle` 在配置期读取），
不要手改、也不要单独维护——`apply-app-meta.js` 每次都会从 `app.config.json` 整体重写它，
并回读校验（app_name / splash_bg / 闪屏 logo / 每个品牌图字节一致 / version.json 字段），
任一项不符即失败退出，杜绝「以为换了品牌其实没换」。

### 从一张主图生成品牌资源

设计稿通常只有一张大图（还常带白边、阴影、假圆角、生成器水印），手工切五套密度极易出错。
`scripts/gen-brand.js`（零依赖，内置 PNG 编解码）把这件事固化成一条命令：

```bash
# 在 app_base 下执行；--inset 按比例裁掉四周留白，--radius 圆角占边长比例（0.5 = 圆形）
npm run brand:gen -- --src ../app_h5/app-brand/icon.png --out ../app_h5/app-brand/android \
  --inset 0.085 --radius 0.22 --dry-run   # 先 dry-run 看清单，确认后去掉重跑
```

产出即 `apply-app-meta.js` 期望的目录结构，改图标只需重跑：

```
app-brand/android/
├─ mipmap-<mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi>/ic_launcher.png        48/72/96/144/192 圆角方图
├─ mipmap-…/ic_launcher_round.png                                  同尺寸圆形
└─ drawable-<…>/splash_logo.png                                    launcher 的 2 倍（96…384），闪屏居中
```

> 主图请放在 `app-brand/icon.png` 一并提交，这样品牌资源随时可复现；
> 生成后务必 `Read` 一张输出图确认（裁切比例不对会把水印或白边留在图标里）。

> 注意区分 `applicationId`（子应用下发，可变）与 Gradle `namespace`（固定 `com.qux`，
> 即 Kotlin 类与 `MainActivity` 所在包）。因此 `am start` 必须写成
> `<applicationId>/com.qux.MainActivity`，`dev.js` / `stop.js` 已按 version.json 取包名。

### 迭代粒度

| 命令 | 粒度 | 示例 |
|---|---|---|
| `npm run version:bump:major` | 主版本 +1 | 1.0 → 2.0 |
| `npm run version:bump:minor` | 次版本 +0.1 | 1.0 → 1.1 |
| `npm run version:bump:patch` / `version:bump` | 补丁 +0.0.1 | 1.0 → 1.0.1 |

每次迭代 `versionCode` 自动 +1（满足 Android 版本递增要求）。

### 同步范围

`scripts/bump-version.js` 递增的是**活动子应用**的 `app.config.json`（读-改-写，只动版本字段），
随后自动跑一次品牌下发，同步：

- `<子应用>/app.config.json`（版本真源）
- `version.json`（build.gradle 打包读取 → APK versionName/versionCode/applicationId）
- `package.json` 的 `version` 字段（项目元数据）
- `harmony/AppScope/app.json5` 的 `versionName`/`versionCode`，以及鸿蒙两处 `string.json` 的应用名
  （**只动名称与版本，不动 `bundleName` 和图标**：bundleName `com.qux.hmos` 是独立上架身份，
  必须与签名/Profile 一致，自动改写会让已签的包装不上；图标也还没做鸿蒙适配）
- 没有 `harmony/` 工程时这一步自动跳过，只打印「无 harmony/ 工程，跳过」

下发失败则回滚版本号，不会出现「配置已递增、基座仍是旧版本」的半程状态。

> `src/config/index.ts` 的 `APP_VERSION` 从 `version.json` 动态读取（`import versionInfo from '../../version.json'`），无需脚本手动同步。

### 典型用法

```sh
# 子应用侧（推荐）：构建 + 注入 api.js + 同步产物到基座 h5/ + 下发品牌
cd ../cammer_h5 && npm run build:base

# 基座侧：迭代版本 → 打包安装
npm run version:bump            # 1.1.6(5) → 1.1.7(6)：先迭代版本
npm run build:android:install   # 产物投递到 dist/<applicationId>/
```

### 切换到另一个子应用

```sh
npm run app:use -- app_h5 --sync   # 改注册表 + 重新下发品牌 + 同步其产物到 h5/
npm run build:android              # 得到 BaseH5-x.y.z-debug.apk（applicationId=com.qux）
```

`build.gradle` 按 version.json 打 `applicationId`，两个包在设备上并存；
`gradle.js` 会核对 APK 的 `applicationId`/版本与 version.json 一致，不一致拒绝投递。

## 基座 + URL（远程站点模式）

把一个已经上线的站点直接打成 APK，不需要本地 H5 子工程：开关是 `version.json` 的 `remoteUrl`。

```json
// version.json —— 填了就是纯 WebView 壳；留空 "" 就是原来的本地 H5 模式，行为一字不变
{
  "appName": "示例应用",
  "apkName": "MyApp",
  "applicationId": "com.example.myapp",
  "versionName": "1.0.0",
  "versionCode": 1,
  "remoteUrl": "https://your-site.example.com/"
}
```

生效链路（`src/config/index.ts` 导出 `REMOTE_H5_URL` / `IS_REMOTE_H5` / `REMOTE_H5_ORIGIN`，
`src/app/resolve-h5-source.ts` 与 `src/app/AppRoot.tsx` 按开关分支）：

| 项目 | 本地模式 | 远程模式 |
|---|---|---|
| WebView 入口 | 已激活子包 → 内置兜底页 | 就是 `remoteUrl`，不查本地激活版本 |
| `app.ready` 握手 | 10s 超时进诊断页 | 不等（第三方页不实现本协议），加载完成即 RUNNING |
| H5 子包更新检查 | 每次启动后台拉 manifest | 跳过 |
| Bridge 注入 | 注入 `window.ReactNativeWebView` 并处理消息 | 不注入、不接消息 |
| 安全区（状态栏 / 导航栏） | 注入 `window.RN_SAFE_AREA` + URL query，页面自己留白（沉浸式） | 只注入一条 `<style>` 给 `html` 补 `padding-top/bottom`，不写任何 `window.*` |
| 信任域 | `allowedOrigin` | 收窄到站点自身 origin |
| 域外跳转 | 系统浏览器 | 系统浏览器（不变） |

入口判定在 `App.tsx`（装机实测走这条：它直接挂 `WebViewBridge`；`src/app/AppRoot.tsx` 里
同样的开关也接好了，等它接管组合根时行为一致）。远程模式下 `messagingEnabled` 一并关掉，
连消息通道都不建。

### 硬性限制（决定该不该用这条模式）

- **只认 `http(s)` 且有 host**：`javascript:` / `data:` / `file:` / `intent:` 一律当「没开」。
  校验在 `normalizeRemoteUrl`——这个值会进 WebView 的 `source.uri`，放过别的 scheme 等于
  把一段任意脚本塞进带原生能力的容器。
- **远程站点拿不到原生能力**：相机 / 文件 / 定位 / 剪贴板 / 系统设置这些 Bridge 调用在远程模式下
  整体不存在。这是有意的边界：第三方 origin 一旦拿到 `window.ReactNativeWebView` 就等于拿到这些能力，
  域名换绑或站点被篡改即成攻击面。站点确实要用原生能力，就走本地 H5 子应用 + `api.js` 协议。
- **站点离线 = 白屏**：没有本地兜底页，也不做离线缓存。整页加载失败会走错误页（可点重试），
  但「返回 200 却卡在页面自己的加载态」这类情况没有超时兜底，只能杀进程重开。
- **硬件返回键只能退「历史栈里的页面」**：远程模式不注入 Bridge，H5 不会回执 `native.back`，
  容器只能用兜底路径——WebView 能回退就 `goBack()`，退无可退才退出（`canGoBack` 取自导航事件，
  见 `src/webview/web-view-controller.ts`）。站点用多页链接或 `pushState` 时表现正常（MDN 实测：
  进子页按返回回到上一页，回到首屏再按才退出）；站点若只切组件、不写 history
  （实测的 Vue 单页站点即如此），历史栈永远只有一条，子页面按返回就是退出 App，基座补不了。
- **App 名 / 包名 / 图标不必手改进基座**：给站点建一个「只有配置和图、没有 H5 源码」的子应用目录
  （`app.config.json` + `app-brand/`，见下面「品牌下发」一节），`brand:apply` 就会把名称、包名、
  图标、闪屏一起下发——纯远程站点不需要本地 H5 工程也能有自己的品牌。
  子应用 `app.config.json` 里也可以写 `remoteUrl`；不写时 `apply-app-meta.js` 保留 version.json 里的
  现值，切子应用不会把这个开关冲掉。（这条本轮才真正生效：此前它读的是 `validate()` 的返回值，
  而 `remoteUrl` 不属于那六个品牌字段，所以「声明了就用它」一直没起作用。）
- **远程模式没有沉浸式，且站点自己适配了安全区会留白两次**：`targetSdk 36` 强制 edge-to-edge，
  第三方页既读不到 `window.RN_SAFE_AREA`（实测站点连 `viewport-fit=cover` 都没写），也不写
  `safe-area-inset`，留白只能由基座补。补法是往页面里注入一条纯 `<style>`
  （`html{padding-top/padding-bottom: … !important}`），留白由**页面自己的背景**绘制，与站点配色一致；
  先前用容器 `paddingTop` 试过，那条带透出的是 RN 窗口背景，会在页头上方切出一条白条。
  `!important` 是给 SPA 兜底：Vite 这类构建在运行时往 `<head>` 追加样式，排在就绪样式之后。
  状态栏前景由根节点 `<StatusBar barStyle>` 按系统深浅色决定（`App.tsx:35`）——基座拿不到站点配色，
  深色站点上图标对比可能不足，这是这条模式的固有取舍。
  注入只到 `<style>` 为止，不写任何 `window.*`，能力面仍是零（见上一条）。两条路由 `bridgeEnabled`
  一个开关决定，互斥不叠加（`__tests__/webview/safe-area-mode.test.tsx` 钉住这一点）。
  已知取舍：站点若用 `100vh` 排满屏，padding 会让文档比视口高出一个状态栏，页面可多滚一小段
  （实测古诗词首页 / 详情页视觉无异常，sticky 页头正好停在留白带下方）；底部留白取 `insets.bottom`，
  雷电模拟器该值为 0，真机三键 / 手势条上尚未验证。

### 出一个远程站点 APK

```sh
# 1. 改 version.json（含 remoteUrl）+ strings.xml 的 app_name
# 2. 打独立包：模拟器（雷电 9 / AVD）是 x86_64，要覆盖 gradle.properties 里的 arm64-v8a
node scripts/gradle.js assembleRelease -PreactNativeArchitectures=x86_64
```

`assembleRelease` 会把 JS 打进 APK，装上就不依赖 Metro。签名见下一节：口令建议用
`ORG_GRADLE_PROJECT_QUX_UPLOAD_*` 环境变量传，别写进命令行——`gradle.js` 会把任务参数原样
打印并落进 `log/build.log`。

改完 `version.json` 要重跑打包才算生效：RN 插件的 `createBundle*` 任务默认只把
`**/*.{js,jsx,ts,tsx}` 当输入，不含 JSON，所以「只改配置不改代码」会被判 up-to-date，
装上去还是旧 bundle（实测 APK sha256 一字不差）。`platforms/android/app/build.gradle` 末尾
已把 `version.json` 补成该任务的输入。

## 品牌下发（图标 / 闪屏 / 包名）

基座不内置任何具体 App 的参数。一个 App 的身份只有两处真源，**都在基座仓库外**：

```text
<子应用目录>/
├─ app.config.json      appName / apkName / applicationId / versionName / versionCode
│                       / splashBackgroundColor，可选 remoteUrl
└─ app-brand/
   ├─ icon.png          一张方形主图（建议 ≥1024）
   ├─ splash.png        可选：闪屏另用一张主图
   └─ android/          下面 gen-brand 的产物，五套密度
      ├─ mipmap-<density>/ic_launcher.png + ic_launcher_round.png
      └─ drawable-<density>/splash_logo.png
```

```sh
# 1) 主图切五套密度（圆角方图 / 圆形 / 闪屏 logo）
node scripts/gen-brand.js --src ../app/<x>/app-brand/icon.png \
  --splash ../app/<x>/app-brand/splash.png --splash-scale 5 \
  --out ../app/<x>/app-brand/android
# 2) 下发进基座（自带回读校验：任一项没写进去就非零退出，不会打出「以为换了其实没换」的包）
npm run brand:apply -- --app ../app/<x>        # 也可 --app <注册表键名>，或省略取 activeApp
```

- 闪屏是「底色 + 居中 logo」的 layer-list（`res/drawable/splash_screen.xml`），不是整屏图。
  `--splash-scale` 是 logo 相对 launcher 的倍率（默认 2；整幅插画建议 4~5，否则在高分屏上偏小）。
  让闪屏主图的背景色等于 `splashBackgroundColor`，居中贴图就不会露出一圈边——这是基座通用做法，
  比往主题里塞整屏图更省资源（不用为每种屏幕比例备一套图）。
- 不给 `--splash` 时闪屏沿用图标主图（历史行为）；子应用连 `app-brand/android/` 都没有时，
  图标回退基座中性默认（`platforms/android/app/src/main/brand-default/`），闪屏退成纯色。
- 图标主图自带留白时用 `--inset` 裁掉（比例，不是像素）；`--radius` 是圆角占最终边长的比例。

### 提交基座前：复原成中性状态

`brand:apply` 会把 App 数据落到基座里这些路径，处理方式分两类：

| 路径 | 内容 | 处理 |
|---|---|---|
| `version.json` / `app-registry.json` | 包名、版本、`remoteUrl` 开关；活动子应用 | **已 .gitignore**，模板见 `version.example.json` / `app-registry.example.json` |
| `res/mipmap-*/ic_launcher*.png`、`res/drawable-*/splash_logo.png` | 品牌位图 | **已 .gitignore**（中性默认图在 `brand-default/`，入库） |
| `res/values/strings.xml` 的 `app_name`、`res/values/colors.xml` 的 `splash_bg` | App 名、闪屏底色 | 入库；文件里还有别的内容，只能靠 reset 复原 |
| `harmony/AppScope/app.json5` + AppScope/entry 两个 `string.json` | 鸿蒙版本与桌面名 | 同上 |

```sh
npm run brand:reset   # 图标回 brand-default，app_name="RN 基座"，splash_bg=#08080D，
                      # remoteUrl 清空，version.json 写中性占位（自带同样的回读校验）
```

前两类被忽略，所以装着任何 App 都不会进 git；后两类是文本文件，**提交基座前先跑 `brand:reset`**，
跑完 `git status` 就应当干净。新克隆的 bootstrap：复制两个 `*.example.json` 为正式名，
再 `npm run brand:apply -- --app <子应用目录>`（或直接 `npm run doctor` 看缺什么）。

## Release 签名

- keystore 与签名口令**不入库**（`.gitignore` 已忽略 `*.keystore`，`gradle.properties` 只提交注释掉的模板）：
  仓库对外共享时，任何口令一旦提交即视为泄露。
- 本地出正式包时补齐两件事，且保持这两项处于未提交状态：
  1. 密钥库文件放到 `platforms/android/app/QUX-release.keystore`；
  2. 在 `platforms/android/gradle.properties` 末尾取消注释并填入 `QUX_UPLOAD_STORE_FILE`
     / `QUX_UPLOAD_STORE_PASSWORD` / `QUX_UPLOAD_KEY_ALIAS` / `QUX_UPLOAD_KEY_PASSWORD`。
- `build.gradle` 用 `hasProperty('QUX_UPLOAD_STORE_FILE')` 判断，缺省时 release 走未签名配置，
  debug 打包与日常开发不受影响。
- 如需更换密钥：重新生成 keystore 并更新上述四项即可。

## 已知环境坑（Windows）

- **hermesc 编译 .hbc 失败（release 打包报 `.hbc: The source file doesn't exist`）**：`node_modules/hermes-compiler` 可能被 npm 装坏（exe/DLL 静默不工作）。修复：重新下载 tarball 替换——`npm pack hermes-compiler@250829098.0.17` → 解压 `package/` → 覆盖 `node_modules/hermes-compiler`。
- **release 打包前请先停止 Metro**（否则 `--reset-cache` 清理 Temp 的 metro-cache 会与运行中的 Metro 冲突，报 `ENOTEMPTY`）。
- **AAPT2 daemon 失败**：用 `gradlew --stop` + `clean` 修复，勿直接删 `~/.gradle/caches/transforms`（会致 ninja 引用损坏）。
- **Metro 端口 8082 占用**：`npm run dev` 会自动释放端口；手动释放用 `npx kill-port 8082`。
- **hvigor 报「找不到 oh_modules / 未知 hvigor 插件」**：真实原因几乎都不是 hvigor 坏了，而是 RNOH
  依赖没装或版本错配（`harmony/oh-package.json5` 全是 `file:../node_modules/...`）。先 `npm run doctor`。
- **hdc 任何命令都返回 0**：装包/转发成功与否只能从输出里判 `[Fail]` / `[Empty]`，它的行尾还是双 `\r`；
  `scripts/hvigor.js` 与 `scripts/stop.js` 已按这个口径写，别改成只看 exit code。
- **鸿蒙 debug 黑屏**：先 `hdc fport ls` 确认 `tcp:8081→tcp:8082`（Metro）和 `tcp:5173→tcp:5173`（子应用 vite）
  两条反向转发都在，再判断是 Metro 没起还是 H5 dev server 没起；这两条由 `npm run install:harmony` 配。
- **模拟器界面卡住不动**：鸿蒙开机 1~2 分钟后 hilog 会冻结，别再等日志；判断页面到底渲染成什么用
  `hdc shell uitest dumpLayout`。

## 代码规范

- **格式化**：Prettier 统一格式化，`printWidth: 100`，`npm run format` 全量格式化，`npm run format:check` 检查。
- **链式调用与箭头函数**：允许使用，但禁止过度换行——不得将调用对象单独占一行再逐方法拆行（如 `nativeModule` 独占一行后 `.method()` 逐个换行）。短链式调用应一行写完；含 `.then()` 的长链式调用改用 `async/await` + `try/catch`。
- **文件命名**：React 组件（`.tsx`）保持 PascalCase；非组件（`.ts`）统一 kebab-case（如 `bridge-server.ts`、`boot-state-machine.ts`）。
- **类型安全**：禁止 `any`，使用具体类型或 `unknown` + 类型守卫；原生模块方法用可选链 + 能力探测模式。
- **Lint**：ESLint 零警告，`npm run lint` 检查。

## 开发约定（改代码如何生效）

- **改 H5（`h5/index.html`）**：保存后在 Metro 终端按 `r`（或模拟器 Dev Menu → Reload）即生效，无需重新编译原生。
- **改 src/ 下 JS/TS**：Metro Fast Refresh 秒级热更（鸿蒙同理，但设备侧要先有那两条 `hdc rport`）。
- **改原生层（platforms/android 下 Kotlin/Manifest/Gradle）**：需重新构建安装。
- **改鸿蒙原生层（harmony/ 下 ArkTS `ets/` 或 C++ `cpp/`）**：必须重新出 HAP 装机（`npm run install:harmony`）；
  ArkTS 侧改 TurboModule 方法名/签名时，要同步改 `cpp/ERPTurboModules.h` 的 `ARK_ASYNC_METHOD_METADATA` 名单，
  两边漏一个的表现是「方法存在但调用直接抛错」，不是找不到方法。
- **新增测试**：放在 `__tests__/` 对应模块目录下，src 下不存放测试文件。
