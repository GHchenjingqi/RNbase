---
name: h5-subapp-setup
description: 为 RN WebView 基座（如 RNbase 这类 RN + WebView + Bridge 项目）搭建或改造 H5 子应用。当用户要求创建 H5 子项目/子应用、搭建 H5 开发环境、写 H5 页面接入 RN（window.RN / RN.SYSTEM 等 Bridge API）、用 Vue3 或 React + Vite 配置子包、处理 file:// 适配（hash 路由、相对路径、api.js 引入）、打包 zip 子包并生成 manifest.json 用于动态升级时使用。也用于检查现有 H5 目录是否满足 WebView 加载与动态升级的必备条件。
---

# H5 子应用必备条件与环境搭建

## Overview

H5 子应用 = 一个跑在基座 WebView 里的**静态网页**（Vue3 或 React 编译产物），通过
`window.RN`（`api.js` 中间件，基于 postMessage）调用基座设备能力，并可作为
manifest + zip 子包被基座动态升级。本 Skill 覆盖：必备条件检查 → 脚手架搭建 →
Bridge 接入 → 构建 → 打包发布。

## 硬约束（所有子应用必须满足，先核对再动手）

1. **纯静态产物**：最终交付是 `index.html + js/css/资源` 的静态目录，可被 WebView
   直接加载（`file://` 或 APK assets），不可依赖服务器渲染/路由 rewrite。
2. **路由必须 hash 模式**：`createWebHashHistory`（Vue）/ `createHashRouter`（React）。
   history 模式在 `file://` 下白屏。
3. **资源相对路径**：构建 `base: './'`，产物内一律相对路径，禁止 `/assets/...` 绝对根路径。
4. **api.js 相对引入并随包分发**：`<script src="./js/api.js">`，`api.js` 必须打进子包。
5. **Bridge 协议对齐**：调用范式 `RN.<模块大写>.<方法大写>()`（如
   `RN.SYSTEM.GETDARKMODE()`）；事件订阅 `RN.ON('system.darkmodechange', fn)`。
6. **动态升级兼容**：可发布为 zip 子包 + `manifest.json`（含 version/entry/packageUrl/
   sha256/size），版本号需大于当前激活版本。
7. **设计必须遵循 Apple HIG（apple-design skill 强制）**：H5 子应用的所有界面、交互、视觉与
   可访问性设计必须以 Apple 人机界面指南（HIG）为规范，**不是“可选审查”而是开发硬约束**。
   设计/编码任一 H5 页面前，**先加载**
   `.workbuddy/skills/apple-design/SKILL.md`（及其 `references/`）作为设计规范；在写 UI、
   组件、配色、字体、间距、表单、图标、动效、暗色模式、无障碍代码时，对照其 Lens 1–5 与
   `references/cross-platform.md`（React / Vue / Web 翻译）落地，使代码“天生”通过 HIG 评审，
   而非事后补救。触发关键词含：UI、页面、组件、样式、配色、字体、布局、表单、弹窗、导航、
   暗色、无障碍、review / 审查设计 等。

## 设计规范（apple-design 强制，H5 子应用必读）

本 skill 与 `apple-design` skill 是**配套约束**：`h5-subapp-setup` 管“能否在 RNbase WebView
里跑起来”，`apple-design` 管“长什么样、好不好用、是否符合平台”。两条都必须满足才算交付。

### 适用边界（H5 跑在移动端 WebView）
- **基础规范（始终适用）**：accessibility / color / typography / layout / writing / motion /
  materials 等 Foundations 全部适用，与宿主平台无关。
- **平台惯例（宿主为 iOS 时适用）**：tab bars、toolbars、sheets、safe areas、手势返回等
  iOS 约定，在宿主是 iOS 时一并遵守；宿主为 Android WebView 时保留原则、不照搬 iOS 专属控件。
- **Web 翻译**：H5 是 Web 技术栈，按 `references/cross-platform.md` 把 Apple 术语映射到
  HTML/CSS/JS（如 `UITabBarController` → 底部 `<nav>` tab、safe area → `env(safe-area-inset-*)`、
  44pt 触控区 → `min-height:44px` / `min-width:44px`）。

### 开发期落地动作（写代码前/中）
1. 遇到 UI/视觉/交互/无障碍需求，先 `Read .workbuddy/skills/apple-design/SKILL.md` 的
   “Always load” 集合（accessibility/layout/typography/color 等），再按“Load by what is on
   screen”加载对应 `references/hig/*.md`，**先读后写**，引用具体 `file.md › Heading`。
2. 编码遵循 apple-design 的 Lens 1–5：可访问性（Critical）→ 平台惯例（High）→ 视觉与 craft
   （High/Medium）→ 交互（Medium）→ 文案（Medium）。
3. 暗色模式用语义色（`light-dark()` / CSS 变量），不写死系统色值；动效可关、可取消、简短。
4. 不套模板：避免“暖米色+高对比衬线+陶土色”、“近黑+荧光绿/朱红”、“细线密排零圆角”三套生成式
   默认风格；产品需有清晰的 design thesis 与一点 point of view。
5. 交付前用 apple-design 的 Report 模板做一次自查（Summary / Critical / Improvements /
   Craft notes / What works），无 Critical、High 可控才算达标。

### 未遵守的后果
不满足 apple-design 规范（尤其 Lens 1 可访问性、Lens 2 平台惯例）的 H5 页面，视为**未达交付
标准**，需返工至通过 HIG 自查。

## 工作流程

1. **检查必备条件**：对照 `references/requirements.md` 逐项核对目标环境/现有代码。
2. **选技术栈并搭脚手架**：
   - Vue3 → 按 `references/setup-vue.md`；可直接复制 `assets/vue-template/`。
   - React → 按 `references/setup-react.md`；可直接复制 `assets/react-template/`。
3. **接入 Bridge**：确认 `index.html` 引入 `js/api.js`，页面里通过 `window.RN` 调用
   设备能力；`js/api.js` 统一取自基座项目根的 `scripts/api.js`（唯一源，原本 skill 的
   `scripts/api.js` 已迁移至基座项目根），基座协议升级时修改它后运行 `npm run sync:api`
   同步到模板和子项目。
4. **构建**：`npm run build` 产出 dist；检查产物无绝对路径。
   - **必须 IIFE 输出**（`vite.config.js` 设 `build.rollupOptions.output.format='iife'`）：
     产物为外部 `js/css` 文件 + `<script src>` 普通引用（符合规范、不内联），且
     `file://` 下无 module script 的 MIME 检查，不会白屏。
   - **同步到基座**：`npm run sync:base` 会做两件关键适配：
     ① `/js/api.js` → `./js/api.js`（file:// 相对路径）；② 去掉 Vite 生成的
     `type="module" crossorigin` 属性（普通 script）。
   - **安全区/导航栏注入**：基座 `node scripts/fix-h5-safearea.js` 构建期注入
     `--status-bar-height`（读 `safeTop`/`RN_SAFE_AREA`）与 `.nut-navbar` 固定逻辑；
     `scripts/gradle.js` 在 assemble 前自动调用（幂等）。手动同步产物后若直接看
     file:// 页面，需先跑该脚本。
   - **RN 侧注入有约 2KB 截断风险**：基座 WebView 的 `injectedJavaScriptBeforeContentLoaded`
     字符串过长会被截断（实测），导航栏固定等大段逻辑必须走 H5 侧注入，不要放 RN 侧。
5. **打包发布**：按 `references/packaging.md` 打 zip、算 sha256、生成/更新 manifest，
   交给基座动态升级链路（基座侧 `H5_MANIFEST_URL` 指向该 manifest）。

### Bridge 握手与连接（api.js v1.1+ 起）

- **握手**：页面入口 `await RN.READY({ h5Version: 'x.y.z' })`（响应含
  `state:'READY'` 与 `capabilities` 数组）；或订阅 `RN.ON('bridge.ready')` 兜底。
  握手未完成前 SDK 内部将请求排队（上限 100，满返 `BRIDGE_QUEUE_FULL`），
  `app.ready` 自身豁免排队（防死锁）。新页面推荐：
  `await RN.WAITUNTILREADY(15000)` 后再调能力；存量直接 `RN.XXX()` 由排队兜底，无需改造。
- **状态查询**：`RN.STATE()`（disconnected/connecting/connected/ready）、
  `RN.ISREADY()`、`RN.QUEUESIZE()`、`RN.HASCAPABILITY(feature)`。
- **appId 声明**：每个 H5 子应用必须声明唯一 appId（多应用白名单校验，升级方案 §23）：
  在 `index.html` 的 `api.js` 之前注入 `<script>window.__H5_APP_ID__='<你的appId>'</script>`；
  未声明时默认 `base_h5`。基座 `TRUSTED_APP_IDS` 配置后，非白名单 appId 的握手被拒
  （SECURITY_BLOCKED）。
- **前后台事件**：`RN.ON('app.resume' / 'app.background', handler)`，App 切后台/回前台时触发。

## 验收清单（交付前逐项）

- [ ] 产物为纯静态目录，`index.html` 可直接被 WebView 打开
- [ ] 路由为 hash 模式，刷新/直链不白屏
- [ ] 产物中无 `/assets/` 等绝对根路径引用
- [ ] `js/api.js` 在产物内且相对路径引入
- [ ] 至少一处真实 Bridge 调用（如 `RN.APP.GETINFO()`）在真机/模拟器 WebView 可用
- [ ] zip 包可被基座解压加载，manifest 的 sha256/size 与实际一致
- [ ] **[Apple HIG]** 可访问性达标：文字可随系统缩放、对比度达 4.5:1（≥18pt/粗体 3:1）、触控区
      ≥44×44pt、无仅靠颜色传达的信息、`prefers-reduced-motion` 有降级
- [ ] **[Apple HIG]** 视觉/交互/Craft 自查无 Critical、High 可控（按 apple-design 的 Report 模板）
- [ ] **[Apple HIG]** 暗色模式用语义色，iOS 宿主下遵循 tab/toolbar/sheet/safe-area 等平台惯例

## Resources

- `references/requirements.md` — 必备条件完整清单（WebView/构建/Bridge/升级各维度 + 检查命令）。
- `references/setup-vue.md` — Vue3 + Vite 搭建步骤（脚手架、hash 路由、base、api.js、常见坑）。
- `references/setup-react.md` — React + Vite 搭建步骤（同上，React 版）。
- `references/packaging.md` — 打包 zip + SHA-256 + manifest 生成与发布流程。
- `scripts/api.js`（基座项目根）— 子应用 Bridge API 的**唯一源文件**（由本 skill 原
  `scripts/api.js` 迁移而来）。所有子应用模板的 `public/js/api.js`（开发期 vite dev server
  使用）与基座 `h5/js/api.js`（内置 H5 生产使用）均由此文件同步；子应用**打包时**再通过
  `node scripts/inject-h5-api.js <dist>` 从该文件覆盖产物 `dist/js/api.js`，保证运行时
  Bridge 协议与基座一致。基座协议升级时修改此文件，然后运行 `npm run sync:api` 同步到
  React 模板、Vue 模板和当前 H5 子项目。
  **消息监听必须同时挂 window 与 document**：react-native-webview 在 Android 上回传
  消息走 `document.dispatchEvent(MessageEvent)`、iOS 走 window，`api.js` 已双监听；
  子应用若自行实现 Bridge 客户端，需同样处理，否则 Android 上所有响应收不到（全部超时）。
- `assets/vue-template/` — 可直接复制的最小可运行 Vue3 子包工程（`public/js/api.js` 取自 `scripts/api.js`）。
- `assets/react-template/` — 可直接复制的最小可运行 React 子包工程（`public/js/api.js` 取自 `scripts/api.js`）。
- `.workbuddy/skills/apple-design/`（项目级 skill）— **H5 子应用设计规范（强制）**。所有 H5 的 UI/
  交互/视觉/无障碍设计必须以 Apple HIG 为准绳；开发前先 `Read .workbuddy/skills/apple-design/SKILL.md`
  及其 `references/`（尤其 `references/cross-platform.md` 的 Web 翻译、`references/hig/*.md` 组件页）。
  详见本文件「设计规范（apple-design 强制，H5 子应用必读）」一节。
