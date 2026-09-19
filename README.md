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
- **H5 SDK**：BridgeClient（事件订阅 on/off/once + 能力检测 getCapabilities/supports）、Native 门面（10 模块+permission）、mockTransport（可配置场景）、环境自动探测
- **Native 能力**：auth（getToken/getUser/logout）、system（vibrate/copy/share）、notification（getToken/setBadge）、11 个模块注册
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
├── h5/                         # H5 子应用产物（仅保留 RN 通信能力 + 设备能力调试台）
│   └── index.html              #   H5 入口；由 app_h5 构建同步而来
├── h5-subapp-setup/            # H5 子应用 Skill（必备条件/搭建/打包 + Vue/React 模板）
├── src/                        # RN 侧源码（App Runtime）
│   ├── app/                    #   应用装配：组合根、启动状态机、Bridge 组装、H5 入口解析
│   ├── webview/                #   WebView 容器：加载 H5、消息桥接、错误页
│   ├── bridge/                 #   Bridge 协议：server / client / modules（H5↔RN 唯一通道）
│   │   ├── client/             #     H5 SDK：BridgeClient / Native 门面 / mockTransport
│   │   └── modules/            #     11 个 Native 模块（app/auth/permission/system/notification/camera/file/location/media/scanner）
│   ├── middleware/             #   原生能力中间件
│   │   ├── network/            #     网络状态（nativeNetworkAdapter / networkModule）
│   │   └── native/             #     设备能力适配（camera / scanner / media / file / location）
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
│   ├── permissions/            #   权限管理（Android / iOS adapter + Provider）
│   ├── storage/                #   存储（InMemoryH5Storage）
│   ├── diagnostics/            #   日志与诊断（结构化日志 + 脱敏）
│   ├── config/                 #   配置
│   └── components/             #   RN UI 组件
├── App.tsx                     # RN 入口：WebView 加载 H5 入口资源
├── index.js                    # 注册入口
├── scripts/                    # 一键脚本（dev.js / gradle.js / stop.js / emulator.js）
├── dist/                       # 打包产物投递目录（按包名分目录，切换子应用互不混淆）
│   └── <applicationId>/        #   <apkName>-<versionName>-<variant>.apk（构建后校验版本与包名一致才投递）
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

```sh
# ── 一键启动编译环境 ─────────────────────────────
npm run dev                # 一键：自动释放 8082 + 后台起 Metro + 构建安装 + 自动启动 App
npm run stop               # 一键停止：关闭 App + 释放 8082 端口
npm run emulator           # 启动 Android 模拟器（Pixel_10）并等待 boot_completed

# ── 一键打包 ─────────────────────────────────────
npm run build:android           # 打包 debug APK → dist/<applicationId>/<apkName>-<version>-debug.apk
npm run build:android:release   # 打包 release APK（正式签名）→ 同目录
npm run build:android:install   # 构建并安装到已连接设备
npm run clean:android           # 清理 Android 构建产物

# ── 子应用与品牌（应用名/包名/图标/闪屏由子应用持有）──
npm run app:show                # 查看当前活动子应用（目录/产物/配置来源）
npm run app:use -- cammer_h5    # 切换活动子应用并重新下发品牌（加 -- --sync 同步其产物到 h5/）
npm run brand:apply             # 仅重新下发品牌：app.config.json → version.json + res/ 图标闪屏
npm run brand:gen -- --src <主图.png> --out <app-brand/android>   # 一张主图切出五密度图标/闪屏

# ── 版本迭代 ─────────────────────────────────────
npm run version:show            # 查看活动子应用当前版本（读 app.config.json）
npm run version:bump            # 补丁 +0.0.1（1.0 → 1.0.1，默认）
npm run version:bump:patch      # 补丁 +0.0.1（1.0.1 → 1.0.2）
npm run version:bump:minor      # 次版本 +0.1（1.0 → 1.1）
npm run version:bump:major      # 主版本 +1（1.0 → 2.0）

# ── 常规 / 质量 ──────────────────────────────────
npm run ios                # run-ios（需 macOS）
npm run typecheck          # tsc --noEmit
npm run lint               # eslint
npm test                   # jest（__tests__/ 全部测试）
```

## 测试覆盖

| 模块 | 测试套件 | 测试数 |
|------|----------|--------|
| WebView | navigation / error-handler | 28 |
| Bridge | version / schema / eventBus / BridgeServer / h5-sdk / native-modules / h5-runtime | 64 + 19 + 16 + 24 |
| M2 动态更新 | dynamic-update（P7）/ rollback（P8） | 38 + 26 |
| P11 文件与图片 | media | 38 |
| P13 可观测性 | observability | 32 |
| P14 性能优化 | performance | 39 |
| **合计** | **27 套件** | **384 测试** |

验证结果：typecheck 0 error / lint 0 error 0 warning / prettier 全过 / 384 测试全部通过。

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

## 代码规范

- **格式化**：Prettier 统一格式化，`printWidth: 100`，`npm run format` 全量格式化，`npm run format:check` 检查。
- **链式调用与箭头函数**：允许使用，但禁止过度换行——不得将调用对象单独占一行再逐方法拆行（如 `nativeModule` 独占一行后 `.method()` 逐个换行）。短链式调用应一行写完；含 `.then()` 的长链式调用改用 `async/await` + `try/catch`。
- **文件命名**：React 组件（`.tsx`）保持 PascalCase；非组件（`.ts`）统一 kebab-case（如 `bridge-server.ts`、`boot-state-machine.ts`）。
- **类型安全**：禁止 `any`，使用具体类型或 `unknown` + 类型守卫；原生模块方法用可选链 + 能力探测模式。
- **Lint**：ESLint 零警告，`npm run lint` 检查。

## 开发约定（改代码如何生效）

- **改 H5（`h5/index.html`）**：保存后在 Metro 终端按 `r`（或模拟器 Dev Menu → Reload）即生效，无需重新编译原生。
- **改 src/ 下 JS/TS**：Metro Fast Refresh 秒级热更。
- **改原生层（platforms/android 下 Kotlin/Manifest/Gradle）**：需重新构建安装。
- **新增测试**：放在 `__tests__/` 对应模块目录下，src 下不存放测试文件。
