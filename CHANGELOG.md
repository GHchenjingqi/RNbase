# Changelog

基座（RNbase）演进记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)，与根目录 `version.json` 的 `versionName` 联动（由 `npm run bump:version` 维护）。

## [Unreleased]

### Fixed（`c6dc069` 起 CI 四轮红的逐轮收口：单测不再依赖本机品牌、jest 忽略规则锚定、brand 守卫在干净检出恒红、iOS Swift 首次进编译的四处必错，2026-10-26）

`c6dc069` 推上去后 CI 两条检查同时红。逐条按 CI 的文件状态复现（`git worktree` 检出该提交 +
CI 那份中性 `version.json`），不是在本机活动品牌下跑一遍就下结论：

- **quality（44s 失败）**：分步结论显示 `npm ci`/typecheck/lint/format 全绿，只有第 10 步
  jest 红。根因是 `__tests__/webview/navigation.test.ts` 与 `message-origin.test.ts` 把离线包
  路径写成 `file:///data/user/0/com.qux/files/h5-versions/…`，而 `decideNavigation` 的
  `h5-versions` 前缀本就按 version.json 的 `applicationId` 拼（`APP_PACKAGE`）。CI 检出的是
  中性 `version.json`（`com.qux.base`），`com.qux` 于是只是个别人的包名 → 判 `block`，
  **本机永远绿**。两处改为从 config 取 `APP_PACKAGE`。
- **build-ios（3m 失败，exit 65）**：该 workflow 在 `a647c45` 是绿的，两次之间 iOS 侧唯一的
  变化是 `project.pbxproj` 把 7 个原生文件加进 App Target——也就是上一轮「pbxproj 没引用就
  只会打出缺能力的绿包」那次收口。它们因此**第一次真正参与编译**，把无 Mac 预写的 Swift 里
  几处必错项暴露出来：`constantsToExport` 多写了 `override`（协议可选方法，无父实现可覆盖）、
  `objc_setAssociatedObject/GetAssociatedObject` 拿字符串字面量当 `UnsafeRawPointer` 键、
  `UIDocumentPickerViewController` 上不存在的 `completionHandler` 与 `[String]` 形参
  （该 API 只收 `[UTType]` 且必须走 delegate）、`URL.mimeType`（系统无此属性）、
  `BasePermissions.swift` 用了 `CLLocationManager` 却没 `import CoreLocation`。
  已按 Swift 语义逐条改掉。**本机没有 Xcode**，编译结论靠新增的 annotation 通道逐轮取。
- **CI 可观测性**：`ci-ios.yml` 的 xcodebuild 改为 `tee` 出日志、失败时把 `error:` 行逐条提成
  annotation。Actions 日志正文要登录才读得到，此前无 Mac 的一侧只能看到「Process completed
  with exit code 65」，等同于盲改。
- **jest 忽略规则**：`testPathIgnorePatterns` 里的裸 `'/harmony/'` 是「路径中任何一段叫
  harmony 就排除」，不是「本仓库的 harmony/」。仓库一旦检出在 `~/harmony` 这类目录下，
  58 个套件被整体静默排除，jest 报的是 `No tests found`（exit 1）而不是 skipped。
  改为 `'<rootDir>/harmony/'`，A/B 实测同一路径下 1 → 58。

- **brand 图标守卫**：`brand:check` 进 CI 后第一次真正跑到（此前那条检查一直被前面的
  jest 失败挡着，从没验证过自己在干净检出上的行为）就恒红：它拿 `res/mipmap-*/` 与入库的
  `brand-default/mipmap-*/` 逐字节比，而 `res/mipmap-*/` 本就 .gitignore（品牌下发时整目录被
  子应用图标覆盖），actions 检出的仓库里没有这些目录 → 10 条「基座默认图标被清掉未复原」。
  改为**目录不存在就跳过**：目录不在 = 这份检出没装过品牌；目录在而文件缺/字节不一致才是真残留。
  本机语义不变（仍照旧报出「H5调试台」的图标漂移），新增用例钉住两种形态。
- **iOS Swift 拿不到 RN 的 ObjC 符号（第二轮 CI 的 2 条 error）**：annotation 把日志正文里
  读不到的报错送回来了——`BasePermissions.swift:21 cannot find type 'RCTBridgeModule' in
  scope` 与 `:46 call to method 'statusFor' in closure requires explicit use of 'self'`。
  前者不是笔误而是配置缺口：Podfile 没调用 `use_frameworks!`（默认静态库 `libPods-qux.a`），
  RN 那些 ObjC pod 就没有 Swift 可直接 `import` 的 clang module，`import React` 带不进
  `RCTBridgeModule`；同目录的 `Base*.m` 走 header search path（`#import <React/RCTBridgeModule.h>`）
  一直编译正常，只有 Swift 侧缺一份桥接头。新增 `qux/qux-Bridging-Header.h`，并在 App Target
  的 Debug/Release 设 `SWIFT_OBJC_BRIDGING_HEADER = qux/qux-Bridging-Header.h`（工程已有
  `CLANG_ENABLE_MODULES = YES`，deployment target 15.1 高于桥接头最低 10.14 要求）。
  后者是硬错误不是风格问题：逃逸闭包内隐式 `self` 在 Swift 5 直接报 error，改为显式 `self.`，
  并弃用未参与的 `granted` 形参（申请后统一回读系统授权状态）。
- **iOS 侧 H5 包签名校验的公钥解析必失败**（`BaseH5.swift:rsaPublicKeyBytes`，与上面同批
  进编译、但编译器不会报的逻辑错）：DER 走查在 tag 字节上就调用了 `readLength`，把 `0x30`
  当成长度字段读，且读完 AlgorithmIdentifier 的 L 后没跳过它的本体。用 Node 现场生成
  RSA-1024/2048/4096 的 SPKI 对照同一算法的 JS 同构实现实测：原走查对三种长度一律返回
  `null`（即任何合法公钥都 reject `INVALID_PUBLIC_KEY`），改后与 `publicKey.export({type:
  'pkcs1'})` 逐字节相等（140B/270B/526B），畸形输入仍拒收。SecKey 那条
  `rsaSignatureMessagePKCS1v15SHA256` 与 JS 侧 WebCrypto 语义等价的结论也随之从「推定」
  变成有「用 PKCS#1 直接验签通过」作证。**Android/鸿蒙不受影响**（走 JS 侧 verifier），
  iOS 侧真机端到端仍待 Apple 账号就绪后验证。
- **iOS 侧 SecKey 符号名（第三轮 CI 的 2 条 error）**：annotation 回读
  `BaseH5.swift:48 cannot find 'SecKeyVerify' in scope` 与同行的
  `cannot infer contextual base in reference to member 'rsaSignatureMessagePKCS1v15SHA256'`
  （后者是前者的连带：函数没解析成功，`.` 前缀推不出 `SecKeyAlgorithm`）。这一轮同时证明
  桥接头生效——四个 Swift 模块的 `RCTBridgeModule` 报错全部消失。改用
  `SecKeyVerifySignature`：先按 Apple 文档 JSON 端点核对（`seckeyverify` 与
  `seckeyverify(_:_:_:_:_:)` 均 404，`seckeyverifysignature(_:_:_:_:_:)` 200 且
  platforms 记 iOS introducedAt 10.0，高于本工程 15.1 门槛），与 CI 编译器的读数一致。
  错误描述取 `CFError` → `as NSError` 再读 `localizedDescription`，不再假设 CFError
  直接带该属性。Message 类算法的第 3 入参是原文，与 WebCrypto `subtle.verify(..., data)`
  口径不变。**仍待真机端到端**（本机无 Mac，这一层只能到「编译通过」；验签闭环要等
  Apple 账号就绪后装机）。
- **iOS 侧 CFError 取不到文案（第四轮 CI 的 1 条 error）**：`'CFError' is not convertible
  to 'NSError'`——iOS 26 SDK（runner 用 Xcode 26.6 / iphonesimulator26.5，见截图第 6–10 行）
  不再允许 `CFError as NSError` 直转。JS 侧契约本就只看 `valid`
  （`src/updater/native-signature-verifier.ts` 的 `Boolean(res && res.valid)`），
  故不再赌 CoreFoundation 访问器的导入形态：错误串改为「是否带回 CFError」，
  细节留给真机阶段用 lldb 读。同时把 runner 的 SDK 版本记进 TODO——废弃符号是否已被
  移除，取决于它而不是取决于本机想象。

### Fixed（启动链路收口：死代码删除 + OTA 真正落地 + clientId 噪声，2026-10-26）

- 删除 `src/app/AppRoot.tsx`、`src/app/fallback-h5.ts`、`src/app/boot-state-machine.ts`、
  `src/components/DiagnosticPage.tsx`：前两个从未被 `index.js` 挂载（入口解析与 OTA 检查
  写在那里，真机上一次都没跑过），后两个零引用（`DiagnosticPage` 的三项动作
  `WebViewErrorPage` 已全部具备且带深浅色；`BootStateMachine` 的转移表没有任何调用方，
  留着等于宣称「启动时序受状态机约束」，而实际并没有）。
- H5 子包热更新（OTA）与激活后握手回滚落到组合根 `App.tsx`：入口按
  「远程站点 → 已激活子包 → 平台内置资源」解析；闸门为
  `IS_REMOTE_H5 || H5_DEV_SERVER_URL || !H5_MANIFEST_URL`（三条件任一命中就不发请求）；
  刚激活的那一版给 `HANDSHAKE_TIMEOUT_MS` 期限收 `app.ready`，超时即 `markFailed()`
  回滚上一版并换入口。OTA 效应只在挂载时跑一次——曾跟着 `entryKey` 走，构成
  「检查→下载→换入口→再检查」的自激循环。
- `validateClientIds()` 改为只校验当前运行端：此前遍历三端，每个安卓冷启动都打一条
  `CLIENT_ID 未配置：ios` 的 ERROR（iOS 的 id 要后端分配，这条在安卓上永远修不掉），
  设备日志第一行恒为噪声。iOS 侧的拦截本就由 `npm run ios:doctor` 负责。
- 单测：新增 `__tests__/appEntryOtaWiring.test.tsx`（入口三态 / OTA 闸门 / 握手回滚，17 例）
  与 `__tests__/config/client-id.test.ts`；删除 `appRootRemoteMode.test.tsx`
  （断言并入前者）。用例改用真定时器：`jest.useFakeTimers()` 与 react-test-renderer 的
  异步 `act` 从第 3 次挂载起死锁，与 SplashOverlay、Provider 均无关。
- 实测（安卓 release 包 + 雷电模拟器）：`bridge.ready entry=file:///android_asset/index.html?_cb=…`
  （无激活子包 → 落内置入口，符合预期）、Bridge 18 项 SUCCESS / 0 项 SECURITY_BLOCKED、
  设备日志零 `h5.update`/manifest 行（闸门生效，未误发请求）、`app.ready` SUCCESS，
  调试台 14 接口 14 正常、无白屏。

### Added（闪屏等待 H5 首屏就绪，不再露白屏，2026-10-15）

- `SplashOverlay` 新增 `holdUntil` / `holdMaxMs`：倒计时走完后若页面还没加载完成，
  闪屏继续盖着并显示「正在翻开诗卷…」，直到 `onLoadEnd` 上报（`App.tsx` 经
  `WebViewBridge` 的 `onLoadEnd` 拿到）或超过 8s 兜底才淡出；等待态仍可点击跳过。
- `WebViewBridge` 显式开启 `cacheEnabled`：远程站点资源带内容哈希，二次启动走 HTTP 缓存。
- 回归测试：`__tests__/splashOverlay.test.tsx` 从 4 例补到 9 例（等待态进入 /
  加载完成退场 / 超时兜底 / 等待中点击跳过 / 倒计时不被重启）。

### Fixed（等待态实现导致倒计时回跳，2026-10-15）

- `holdUntil` 原先挂在倒计时 effect 的依赖里，而 effect 内用 `Date.now()` 记起点：
  页面在倒计时途中加载完成会让 effect 重跑、起点重置 → **数字回跳、白等一遍**。
  改为用 ref 读取最新值，倒计时只随 `durationMs` 变化重启。

### Fixed（打包脚本不再被 EPIPE 打断，2026-10-15）

- 现象：打包跑到一半，node 包装进程崩在 `Error: EPIPE: broken pipe, write`
  （`scripts/gradle.js` 的 tee 写 `process.stdout`），构建日志停在某个 Task 上，
  gradle 子进程被丢下没人收尾——**构建本身没问题，是「日志没人看」把打包打死了**。
- 成因：stdout 是管道时（RNBuild Studio / CI 读日志 / 命令行被 `| head` 截断），
  读端一关闭，再写就触发 EPIPE。EPIPE 是 socket 上 emit 的 `'error'` 事件，
  没有任何监听就升级为 uncaughtException，进程直接退出。
- 修复：抽出 `scripts/log-tee.js`，给 `process.stdout` / `process.stderr` 装 EPIPE
  兜底——管道断了就只记 `log/<name>.log`，构建照常跑完、照常投递 APK。
  四个脚本（`gradle.js` / `hvigor.js` / `dev.js` / `harmony-dev.js`）原先各有一份
  同样的 tee 实现，统一改为复用这一份，避免修一处漏三处。
- 实测：同一段写入在断管场景下，旧实现退出码 1（崩），新实现退出码 0，
  `log/` 下 20 万行日志完整落盘；`node scripts/gradle.js help` BUILD SUCCESSFUL。

### Added（基座默认视觉：桌面图标 + 3 秒倒计时启动闪屏，2026-10-15）

- AI 生成一套中性默认视觉（流动曲线 + 浅色渐变，不代表任何具体 App）并接入三端：
  安卓 `brand-default` 五套 mipmap（复用 `brand:gen` 从 1024 主图切出）、
  鸿蒙 `app_icon` / `startIcon` / 分层图标 `foreground` + `background`、
  iOS `AppIcon.appiconset` 全尺寸（iphone 20–60pt 全 scale + 1024 marketing）。
- 启动闪屏为 **RN 跨端实现**（新组件 `src/app/SplashOverlay.tsx`）：全屏闪图
  （`src/assets/splash/splash-default.jpg`）+ 秒级倒计时 + 300ms 淡出，点击任意位置可跳过；
  WebView 在闪屏下方照常装载，结束时直接露出页面，不额外等待。三端一份实现、表现一致。
- 时长走 `version.json` 的 `splashDurationMs`（毫秒，默认 3000，**0 = 关闭**，上限 15000）；
  `apply-app-meta` 将其列为容器级开关（与 `remoteUrl`/`statusBarStyle`/`h5DevUrl` 同类，
  子应用声明了才覆盖，否则保留现值，`--reset` 回默认）。
- 安卓 `colors.xml` 的 `splash_bg` 与鸿蒙 `start_window_background` 默认色
  从深色 `#08080D` 改为与闪图同系的浅色 `#EAEFF7`，遮盖 RN 装载前空白、衔接不闪白。
  安卓默认闪屏仍遵守「无品牌 = 纯色无 logo」约定（`brand:apply` 校验不变）。
- 测试：新增 `__tests__/splashOverlay.test.tsx` 4 例（首帧倒计时 / 逐秒递减到时回调 /
  点击跳过 / 0 关闭 / 回调仅一次）。

### Fixed（安卓 Gradle wrapper 锁回 9.0.0，2026-10-15）

- 现象：`gradle-wrapper.properties` 指向 9.4.1 时构建必失败——
  `Execution failed for task ':gradle-plugin:settings-plugin:compileKotlin'` →
  `Internal compiler error`。9.4.1 自带的 kotlin-stdlib 是 2.3.0，与本项目 Kotlin 2.2.0
  （`build.gradle` 的 `kotlinVersion`）对不上。
- 处理：wrapper 固定到 **9.0.0**（实测 `./gradlew help` BUILD SUCCESSFUL）。
  AGP 8.12.0 由 RN 0.84 的 `@react-native/gradle-plugin` 带入，官方只要求 Gradle ≥ 8.13，
  光看兼容表看不出这个上限，故在 README 5.6 记一条「别升到 9.4+」，防止被照表升回去。

### Added（debug 期三端统一「直连本地 H5」，2026-10-15）
- 背景：debug 下改一行 H5 要走 `build → sync:base → 重装 APK/HAP`，反馈循环以分钟计。
  此前只有鸿蒙支持直连宿主机 dev server，安卓恒读 `file:///android_asset/index.html`、
  iOS 恒读 bundle 内 `h5/index.html` —— 三端 debug 体验不一致。
- `src/config/index.ts` 新增 `H5_DEV_SERVER_PORT`(5173) 与 `H5_DEV_SERVER_URL`：
  仅 `__DEV__` 生效，release 恒为 `null`（正式包不可能指向宿主机地址）。默认值按平台给：
  安卓/鸿蒙 `http://127.0.0.1:5173/`、iOS `http://localhost:5173/`；
  `version.json` 的 `h5DevUrl` 可覆盖（iOS 真机填宿主机局域网地址），`off` 显式关闭。
  复用 `normalizeRemoteUrl` 那套 scheme 校验，缺尾斜杠自动补（子应用 vite 是 `base:'./'`）。
  dev 白名单自动追加该 origin，否则首屏导航会被判 `untrusted_origin` 弹系统浏览器。
- `src/app/resolve-h5-entry.ts`：debug 优先返回 dev server 地址，三端统一；
  不再追加防缓存参数（dev server 靠 HMR 保持最新）。鸿蒙 `HARMONY_DEV_ENTRY` 常量随之删除，
  改由 config 统一供给，鸿蒙默认端口不变（仍是 5173）。
- `scripts/adb-forward.js` 补 `adb reverse tcp:5173`（安卓此前缺这条，hvigor.js 的注释早就
  写了「两端都要有 5173 这条，行为才一致」）；`scripts/hvigor.js` 注释同步。
- `scripts/apply-app-meta.js`：`h5DevUrl` 与 `remoteUrl`/`statusBarStyle` 同等待遇，
  子应用未声明时保留 version.json 现值，避免 `brand:apply` 把真机联调地址清掉。
- 连带结论（已在 README 4.4 记录）：debug 直连时 H5 子包热更新链路不启动
  （原 `AppRoot` 的 `IS_REMOTE_H5 || H5_DEV_SERVER_URL` 分支；该组件是从未挂载的死代码，
  闸门已落到 `App.tsx`），所以「debug 下隐藏热更新」
  在基座侧自动成立；H5 侧要跟着隐藏用已有的 `DEVICE.GETPLATFORM().isTesting`。
- 单测：`resolve-h5-entry` 补 debug 三端分支（含「iOS 无原生路径也不返回 null」），
  `appRootRemoteMode`（该文件已随 `AppRoot` 删除，同类断言并入 `__tests__/appEntryOtaWiring.test.tsx`）补「直连时不跑子包热更新」。

### Added（新建子应用脚手架 + 打包工作台配套，2026-10-15 补记）
- 新增 `scripts/create-subapp.js`：一次补齐「一个子应用可用」的三要素 —— 工程本体
  （Vite + Vue/React 模板：hash 路由 / 相对路径 / `public/js/api.js`）
  + 对接脚本（`sync-to-base` / `inject-api` / `apply-app-meta` 三个薄壳）
  + 在基座 `app-registry.json` 登记（否则 `app:use` / gradle / hvigor 认不出来）。
  此前模板目录里只有第一项，后两项靠手工复制。支持 `--no-source` 建「仅配置应用」
  （远程站点打包用，无源码、无需 npm install）。
- `h5-subapp-setup/assets/shared-scripts/` 落地三个子应用侧薄壳脚本的唯一真源。
- `package.json` 加 `npm run subapp:create`；`.gitignore` 加 `*.exe`（打包工作台
  RNBuild Studio 放基座根目录即用，不入库）与 `h5.backup/`（sync-to-base 的旧内容备份）。
- 文档：README 新增 5.8（脚手架用法）与 5.9（打包工作台：靠同级特征文件识别基座目录，
  「新建子应用」向导直接 spawn `create-subapp.js` 以免两处模板漂移）。

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
- 依据 ADR-0003 判定线清理业务语义残留（源自抽离前的宿主项目，即第一个业务子应用）：
  `ERPCapabilities/ERPNetwork/ERPPermissions/ERPH5/ERPLog/ERPSystem/ERPUpdate` → `Base*`；
  Android 包 `com.qux.erp` → `com.qux.base`；Harmony `ets/erp/` → `ets/base/`；
  占位域名 `mobile-erp.example.com` → `mobile-base.example.com`；`erp://` 示例 → `base://`。
- JS↔原生模块名字符串三平台同步（src 15 文件 + Kotlin 12 + Swift/.m 7 + ets/cpp 8）；
  用户可见权限文案「旧宿主产品名」→「本应用」；`ios.js` doctor 正则同步。
- 收尾清理（第二轮）：修复 `PackageProvider.ets` 残留 `./erp/BasePackage` 断链导入；
  Android 渠道/文件前缀 `erp_notify`/`erp_badge`/`erp_photo_`/`erp_pick_`/`erp_clipboard`/`erp_*` → `base_*`；
  Harmony 蜂鸣资产 `rawfile/erp_beep.wav` → `base_beep.wav`（git mv）及 `erp_*` 临时文件前缀 → `base_*`；
  iOS Info.plist 定位/相机用途描述去除 ERP 业务措辞；
  DEVICE_CAPABILITIES.md、h5-subapp-setup 文档（SKILL/bridge-upgrade-plan/packaging）中
  旧宿主 ERP 命名与参数说明同步为 `base_*`/`RNbase`/`__H5_APP_ID__`。
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
