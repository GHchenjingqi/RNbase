# jingyi Bridge 通信升级实施方案（结合本项目）

> 依据：《RN_H5_Bridge_postMessage_onMessage_升级实施方案.md》（v1.0，73 节）
> 适用范围：jingyi_app_base（RN 基座）+ jingyi_h5（Vite 子应用）+ h5-subapp-setup（模板）
> 状态：**Phase A~F 已实施并在模拟器 CDP 验证通过**（见 §7 实施记录）；G 待拍板

---

## 7. 实施记录（2026-09-08，模拟器 CDP 验证）

**已实施并通过验证**：

| Phase | 内容 | 验证结果 |
|---|---|---|
| A | protocol.ts 补 `timestamp`/`BRIDGE_QUEUE_FULL`/`BRIDGE_EVENTS`；config 区分 protocolVersion；version.ts 返回 protocolVersion | tsc 通过；getInfo 正常 |
| B | RN 侧 app.ready 回执 `state:'READY'+capabilities` 并推送 bridge.ready 事件；H5 侧 api.js 自动握手 + waitUntilReady + 排队（上限 100/BRIDGE_QUEUE_FULL，握手豁免） | CDP：state=ready、握手回执含 capabilities、并发 3 调用全成功 |
| C | 状态机四态 + pageshow/pagehide 重置 + flush | CDP：state=ready、queueSize=0 |
| D | WebViewBridge 内 AppState → app.background/app.resume 事件 | CDP 事件监听：background+resume 均收到 |
| E | appId 上报 + TRUSTED_APP_IDS 白名单（空=观察期 warn） | logcat：app.ready 携带 appId/protocolVersion/timestamp |
| F | devtools 状态条 + 3 项新测试 + 事件订阅区 | 14 项测试：13 正常 + 1 预期异常（推送未接入）；握手/等待/能力检测全绿 |

**过程中发现并修复的额外 bug**：业务 bundle script 去掉 `type="module"` 后在 head 同步执行，
`#root` 尚未解析导致 React `createRoot` 报 #299 白屏 —— sync-to-base.js 改为对**业务 bundle 加 `defer`**
（api.js 保持同步），file:// 下正常渲染，且保持产物外部引用（符合规范）。

**未实施（待拍板）**：Phase G（SDK 抽独立 npm 包，见 §4.3 建议二期）；敏感 handler `sensitive` 审计标记（计划 Phase E 内含项，暂以 appId 校验 + 日志替代，需要时补）。

**已知取舍**：api.js 升级为 v1.1.0（自动握手 + 排队）后，所有 4 目标 MD5 更新为
`F42E5DAB4755D13E7549891F0D1387A0`；旧 H5 子包（含旧 api.js）在基座新版下仍兼容
（旧版无排队/握手，直发 + RN 无状态处理，行为不变）。

***

## 1. 结论摘要（先读）

**本项目不是从&#x20;**`window.xxx`**&#x20;全局变量时代起步**：基座与 H5 之间已经是 `postMessage + onMessage + 统一协议（request/response/event 三型）+ Promise/超时/错误码/事件订阅/能力清单` 的架构。方案中 "从 window.xxx 迁移" 的假设对本项目**不适用**（无遗留全局 API，Legacy Adapter 不需要）。

因此本计划的实质是：**按方案补齐四个真实缺口 + 规范化既有能力**：



| 优先级 | 缺口                                                              | 现状                                      | 方案要求                                                     |
| --- | --------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| P0  | **无握手回执**：`app.ready` 只单向确认 `{ok:true}`，不返回 capabilities / 协议版本 | 业务完全不调用 READY，页面加载即并发调能力，靠 30s 超时兜底     | Handshake：`bridge.hello → bridge.ready`（带 capabilities）  |
| P0  | **无连接状态机**：H5 无 ready 概念，直接发请求                                  | BridgeClient 直发                         | DISCONNECTED→CONNECTING→CONNECTED→READY + waitUntilReady |
| P0  | **无 pending 队列**：未 ready 的请求直接发（可能失败 / 超时）                      | 直发 + TIMEOUT 兜底                         | 队列（上限 100，满返回 BRIDGE\_QUEUE\_FULL），ready 后 flush         |
| P1  | **无前后台生命周期事件**：AppState 变化未桥接给 H5                               | eventBus 有通道无来源                         | `app.resume / app.background` 等事件                        |
| P2  | 协议字段：request 无 timestamp、无 protocolVersion/sdkVersion 区分        | request 有 version='1.0.0'               | timestamp + protocolVersion/bridgeVersion/sdkVersion     |
| P2  | 多 App：无 appId 上报与校验                                             | 有 clientId（android/ios 固定值）             | appId 上报 + 白名单                                           |
| P2  | 调试观测：H5 devtools 有 11 项只读测试，无连接状态 / 事件订阅演示                      | 已有                                      | Debug 面板含状态 / 队列 / 事件                                    |
| —   | method 扁平化 `'camera.takePhoto'`                                 | `{module:'camera', action:'takePhoto'}` | **建议不改**（见 §4.2）                                         |
| —   | 独立 SDK npm 包                                                    | 单文件 `scripts/api.js` + 工程内 TS client 雏形 | **二期可选**（见 §4.3）                                         |

**架构决策（本计划的核心）**：握手升级**不新增 system 消息类型**，复用现有三通道：



* H5→RN 握手走现有 request 通道（`module:'app', action:'ready'`，即现有 `RN.READY`），响应携带 `state/capabilities/版本` 回执；

* RN→H5 的 `bridge.ready` 通知走现有 **event 通道**（`eventBus.emit('bridge.ready', …)` → WebView postMessage → H5 `RN.ON('bridge.ready')`），与方案 §8 的 `bridge.ready` 事件语义一致。

这样**协议层面零破坏**（现有 H5 请求 / 响应格式不变）、**RN 侧零新增传输机制**，业务门面 `window.RN.*` 完全不变。



***

## 2. 差距矩阵（已核实）



| 方案要求                                                   | 本项目现状（已读代码核实）                                                                           | 差距                                         | 处理                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| §6 Request `{id,type,method,params,timestamp,version}` | `{type,id,version,module,action,params}`（protocol.ts BridgeRequest）                     | method 单串 vs module+action 双字段；无 timestamp | 双字段**保留**（BridgeServer 已按 `module.action` 键路由，等价）；补可选 `timestamp` |
| §7 Response `{id,type,success,data,error}`             | 一致（`{type,id,success,data,error}`）                                                      | 无                                          | —                                                                 |
| §8 Event `{type:'event',event,data}`                   | 一致（+timestamp），eventBus 已带 unsubscribe                                                  | 无                                          | 补事件来源（前后台）                                                        |
| §9 Handshake `bridge.hello→bridge.ready(capabilities)` | `app.ready` 单向 `{ok:true}`，**业务未调用**                                                    | **缺回执 / 未启用**                              | Phase B                                                           |
| §10 状态机 4 态                                            | 无（BridgeClient 直发）                                                                      | **缺**                                      | Phase C                                                           |
| §16 ConnectionManager                                  | 无（RN 无状态；H5 无）                                                                          | **缺**（H5 侧实现）                              | Phase C                                                           |
| §17 waitUntilReady                                     | 无                                                                                       | **缺**                                      | Phase B/C                                                         |
| §18 pending 队列（上限 100 / BRIDGE\_QUEUE\_FULL）           | 无（直发 + 30s TIMEOUT）                                                                     | **缺**                                      | Phase C                                                           |
| §19 EventManager unsubscribe                           | **已有**（on/off/once 返回取消函数）                                                              | 无                                          | 仅补 hasCapability 别名                                               |
| §20 多 App（appId/appVersion/h5Version/bridgeVersion）    | 有 clientId/appVersion/bridgeVersion；ready 已收 h5Version                                  | 缺 appId 上报                                 | Phase E                                                           |
| §21 protocolVersion/bridgeVersion/sdkVersion           | 仅 bridgeVersion='1.0.0'                                                                 | **缺区分**                                    | Phase A                                                           |
| §22 统一错误码按 code                                        | **已有** 16 个（含 TIMEOUT/DEVICE\_UNSUPPORTED…）                                             | 补 BRIDGE\_QUEUE\_FULL                      | Phase A                                                           |
| §23 安全（appId/origin/method 白名单）                        | origin 校验 ✓（trustedOrigins）、method 注册表 ✓（METHOD\_NOT\_FOUND）、id 防重放 ✓（RequestIdTracker） | 缺 appId 校验                                 | Phase E                                                           |
| §24 日志 + Bridge Debug 面板                               | \[bridge] 日志 ✓、deviceLogger ✓、onCall 钩子 ✓、H5 devtools 11 项测试 ✓                          | 面板缺状态 / 事件视图                               | Phase F                                                           |
| §25 Legacy Adapter                                     | 无旧 `window.xxx` API（从第一天即 `RN.*` 门面）                                                    | **不适用**                                    | 跳过                                                                |
| §26 前后台事件                                              | eventBus 有 emit 能力；**AppState 未桥接**（PermissionProvider 的 AppState 仅刷新权限）                | **缺来源**                                    | Phase D                                                           |
| §11 独立 SDK npm 包                                       | `scripts/api.js` 单文件（IIFE，4 目标同步）+ `src/bridge/client/` TS 版（在 RN 工程内）                  | **未包化**（双实现并存）                             | Phase G（二期）                                                       |



***

## 3. 分阶段改动计划

执行顺序 **A → B → C → D → E → F**，每阶段独立可验证、可提交。G 为二期，需先拍板。

### Phase A：协议与版本规范（RN 侧，半日）

**目标**：协议类型补 timestamp、system 事件名常量、错误码补 BRIDGE\_QUEUE\_FULL；区分 protocolVersion/bridgeVersion。

改动文件与具体改动点：



1. `src/bridge/protocol.ts`

* `BridgeRequest` 增加 `timestamp?: number`（可选，向后兼容；H5 新 SDK 发送时带上）

* `BridgeErrorCode` 增加 `'BRIDGE_QUEUE_FULL'`（H5 队列满，RN 侧未知错误统一返回）

* 新增事件名常量（供 RN 侧 emit 与 H5 订阅对齐）：



```
export const BRIDGE\_EVENTS = {

&#x20; READY: 'bridge.ready',

&#x20; DISCONNECTED: 'bridge.disconnected',

&#x20; APP\_RESUME: 'app.resume',

&#x20; APP\_BACKGROUND: 'app.background',

&#x20; APP\_FOREGROUND: 'app.foreground',

} as const;
```



1. `src/config/index.ts`

* 新增 `export const BRIDGE_PROTOCOL_VERSION = '1.0';`（协议版本，独立于 bridge 实现版本 BRIDGE\_VERSION='1.0.0'）

1. `src/bridge/version.ts`：`getVersionInfo()` 返回增加 `protocolVersion: BRIDGE_PROTOCOL_VERSION`

**验证**：`npx tsc --noEmit` 通过；`app.getInfo` 返回含 protocolVersion（CDP 或 devtools）。

### Phase B：握手升级（核心，RN + H5，1 日）

**目标**：`RN.READY` 变为双向握手 ——H5 上报 `{h5Version, appId, protocolVersion}`，RN 回执 `{state:'READY', protocolVersion, bridgeVersion, appVersion, capabilities:[...]}`，并同步推送 `bridge.ready` 事件；H5 业务后续统一走 `waitUntilReady`。

RN 侧：



1. `src/bridge/modules/app.ts`

* `getCapabilities()` 增加导出能力数组：`featuresToArray(features)` → `['camera','scanner','location','filePicker','share']`（过滤 true）

* `ready` handler 改造：



```
ready(\_params) {

&#x20; const p = (\_params ?? {}) as { h5Version?: string; appId?: string; protocolVersion?: string; bridgeVersion?: string };

&#x20; handlers.onReady?.(p);                    // 保留原有回调

&#x20; return {

&#x20;   ok: true,

&#x20;   state: 'READY',

&#x20;   protocolVersion: BRIDGE\_PROTOCOL\_VERSION,

&#x20;   bridgeVersion: BRIDGE\_VERSION,

&#x20;   appVersion: APP\_VERSION,

&#x20;   appId: 'jingyi\_app\_base',               // 基座自身 appId

&#x20;   capabilities: featuresToArray(getCapabilities().features),

&#x20; };

}
```



1. `src/bridge/modules/app.ts`（或 `src/webview/WebViewBridge.tsx` 的 lifecycle.onReady 回调处）

* 握手完成时向 H5 推送 ready 事件（复用 eventBus 通道）：



```
bridgeEventBus.emit('bridge.ready', {

&#x20; protocolVersion, bridgeVersion, appVersion, appId, capabilities: \[...],

});
```

> 注意双路径：H5 若在握手响应里先拿到回执则直接 ready（不等事件）；事件路径为 WebView 重载 / 时序不确定时兜底。两者幂等。



1. `src/webview/WebViewBridge.tsx`：无需传输改动（eventBus.setGlobalListener → postMessage 已通）。若 App.tsx 传入的 lifecycle.onReady 目前为空，改为传入 `{ onReady: () => server.eventBus.emit(...) }`—— 确认 AppRoot 组装处（`createAppBridgeServer(capabilities, lifecycle, …)` 的 lifecycle 参数）。

H5 侧（`scripts/api.js` 唯一源）：



1. `BridgeClient` 增加状态字段与方法：



```
this.state = 'disconnected';   // disconnected|connecting|connected|ready

this.\_readyWaiters = \[];       // waitUntilReady 的 resolve 列表

this.\_queue = \[];              // pending 队列 {module, action, params, resolve, reject, timer}

this.MAX\_QUEUE = 100;
```



* `markConnecting() / markReady(caps) / markDisconnected()`

* `isReady()`、`waitUntilReady(timeoutMs = 15000)`（超时 reject `{code:'BRIDGE_REQUEST_TIMEOUT'}`）

1. `BridgeClient.request()` 改造（**排队 + 豁免握手自身**）：



```
request(module, action, params) {

&#x20; // 握手自身（app.ready）不排队，直接发

&#x20; const isHandshake = module === 'app' && action === 'ready';

&#x20; if (!isHandshake && this.state !== 'ready') {

&#x20;   return this.\_enqueue(module, action, params);   // 入队，ready 后 flush

&#x20; }

&#x20; return this.\_send(module, action, params);

}

\_enqueue(...) {

&#x20; if (this.\_queue.length >= this.MAX\_QUEUE) {

&#x20;   return Promise.reject({ code: 'BRIDGE\_QUEUE\_FULL', message: 'Bridge 请求队列已满' });

&#x20; }

&#x20; return new Promise((resolve, reject) => { this.\_queue.push({...}); });

}
```



1. `RN.READY(info)` 升级为握手入口：



```
RN.READY = function (info) {

&#x20; client.markConnecting();

&#x20; // 路径 1：订阅 bridge.ready 事件（RN 主动推送，幂等）

&#x20; var off = client.on('bridge.ready', function (payload) {

&#x20;   client.markReady(payload); off();

&#x20; });

&#x20; // 路径 2：app.ready 响应回执

&#x20; return client.request('app', 'ready', Object.assign({

&#x20;   h5Version: H5\_VERSION, appId: APP\_ID, protocolVersion: BRIDGE\_PROTOCOL\_VERSION,

&#x20; }, info || {})).then(function (res) {

&#x20;   if (res && res.state === 'READY') client.markReady(res);

&#x20;   return res;

&#x20; });

};
```



* 常量：`BRIDGE_PROTOCOL_VERSION='1.0'`、`H5_VERSION`（读 manifest / 构建注入）、`APP_ID`（如 'jingyi\_h5'，构建注入或常量）

1. 暴露新 API（门面不变原则，仅新增）：



```
RN.STATE = () => client.state;                       // 或直接属性

RN.ISREADY = () => client.isReady();

RN.WAITUNTILREADY = (ms) => client.waitUntilReady(ms);

RN.HASCAPABILITY = (feature) => client.supports(feature);   // 方案 §19 别名

RN.SDK\_VERSION = '1.1.0';
```



1. 浏览器 Mock：`createBrowserClient()` 的 `state` 恒为 'ready'（mock 全部可用），`request` 不排队；`RN.READY` 直接 resolve `{ok:true, state:'READY', capabilities:[...]}`（浏览器布局调试不阻塞）。

2. **同步 4 目标**：改完 `scripts/api.js` 后执行 `node scripts/sync-h5-api.js`（react/vue 模板 + jingyi\_h5 + 基座 h5/js），再 `node scripts/inject-h5-api.js <dist>` 重新注入产物；**4 目标 MD5 校验一致**。

**验证**：



* devtools 新增 "握手" 测试：调用 `RN.READY()` 后检查 `RN.ISREADY() === true`、`RN.STATE === 'ready'`、回执含 capabilities 数组；

* CDP 并发场景：页面加载即并发调 3 个能力 → logcat 显示请求先排队、握手完成后 flush、全部成功（不再出现 "偶尔失败"）；

* 浏览器打开 H5（非 RN）：READY 立即成功，能力走 Mock。

### Phase C：连接状态机与 reload 重置（H5 侧，0.5 日）

**目标**：状态迁移完整；WebView reload / 页面重载后状态重置重握手。

改动点（`scripts/api.js`）：



1. 状态迁移函数（含边界防御）：



```
function canTransition(from, to) {

&#x20; const M = {

&#x20;   disconnected: \['connecting', 'ready'],   // mock 直接 ready

&#x20;   connecting: \['connected', 'ready'],

&#x20;   connected: \['ready', 'disconnected'],

&#x20;   ready: \['disconnected'],                 // reload/切后台断开

&#x20; };

&#x20; return (M\[from] || \[]).includes(to);

}
```



1. 重载重置：监听 `window 'pageshow'`（`event.persisted`）与 `pagehide` → `markDisconnected()` + `markConnecting()`；reload 后业务再调 `RN.READY()` 重握手（或 SDK 内部自动重发一次，**建议显式**：H5 入口统一 `await RN.WAITUNTILREADY()` 前调用 `RN.READY()`）。

2. `markReady` 时 flush 队列（按入队顺序逐个 `_send`），清空 `_readyWaiters`。

**验证**：CDP `Page.reload` → `RN.STATE` 先回 disconnected/connecting，READY 后回 ready；队列中请求不丢（flush 后全部 resolve）。

### Phase D：前后台生命周期事件（RN 侧，0.5 日）

**目标**：AppState 变化桥接为 Bridge 事件推给 H5。

改动点：



1. `src/webview/WebViewBridge.tsx`（或宿主 App.tsx）增加 AppState 监听：



```
useEffect(() => {

&#x20; const sub = AppState.addEventListener('change', (next) => {

&#x20;   if (next === 'background') server.eventBus.emit('app.background', { timestamp: Date.now() });

&#x20;   else if (next === 'active') server.eventBus.emit('app.resume', { timestamp: Date.now() });

&#x20; });

&#x20; return () => sub.remove();

}, \[server]);
```

> 放 WebViewBridge 内按 server 隔离，避免多 WebView 串扰；注意 PermissionProvider 已有 AppState 监听（仅权限用），互不冲突。



1. H5 devtools 增加 "事件订阅" 演示区：`RN.ON('app.resume'/'app.background', …)` 并展示最近 5 条（Phase F 一并做）。

**验证**：模拟器按 Home → 回 App，devtools 事件区出现 `app.background` / `app.resume`，耗时 < 1s。

### Phase E：多 App 与安全补强（RN + H5，0.5 日）

**目标**：appId 上报 + 可选白名单；敏感能力门控复核。



1. RN 侧 `src/config/index.ts`：新增 `TRUSTED_APP_IDS?: string[]`（默认空 = 放行，仅 log 警告，避免灰度期误伤）；`app.ready` 校验 `p.appId` 不在白名单时 `console.warn('[bridge] untrusted appId:', p.appId)`（不阻断，观察期）。

2. RN 侧 `BridgeServer`：`register` 增加可选 `sensitive?: boolean` 标记（camera/album/location 相关 handler 注册时标注），敏感调用在 `onEvent` 日志里带 `sensitive: true` 字段（审计用，不改行为）。

3. H5 侧：`RN.READY` 上报 `appId`；`window.RN` 上不暴露 `postMessage` 原始句柄（现状已封装，复核无泄漏即可）。

4. 文档：`h5-subapp-setup/SKILL.md` 补 "appId 声明规范"（每个 H5 子应用在构建配置中声明唯一 appId）。

**验证**：logcat 出现 `[bridge] H5->RN …"module":"app","action":"ready"…"appId":"jingyi_h5"`；白名单测试：临时塞错 appId 出现 warn 且调用不阻断。

### Phase F：Debug 面板与观测增强（H5，0.5 日）

**目标**：devtools 页从 "11 项只读测试" 升级为 "连接状态 + 握手 + 事件 + 能力" 调试面板。

改动点（`jingyi_h5/src/pages/devtools/devtools.jsx`）：



1. 顶部状态条：`RN.ENV / RN.VERSION / RN.SDK_VERSION / RN.STATE() / RN.ISREADY()` + 排队数（若 SDK 暴露 `RN.QUEUESIZE?.()`）。

2. TESTS 新增：

* `bridge.ready` 握手：`RN.READY({h5Version:'dev'})` → 断言回执 `state==='READY'` 且 capabilities 非空

* `waitUntilReady`：`RN.WAITUNTILREADY(5000)` → 断言 resolve

* `hasCapability`：`RN.HASCAPABILITY('camera')`

* 事件订阅演示：`RN.ON('app.resume')` 打点 + 展示区（配合 Phase D 的 Home / 回 App 验证）

1. 展示 capabilities 数组明细（现有 features 对象展示保留）。

**验证**：devtools 全绿（11 项旧测试 + ≥4 项新测试）；浏览器打开时 READY/WAITUNTILREADY 也通过（Mock 恒 ready）。

### Phase G（二期，需拍板）：SDK 包化

> 见 §4.3 决策。若通过，另立里程碑：
> 以 
>
> `src/bridge/client/`
>
>  TS 版为基底抽 
>
> `@jingyi/h5-bridge-sdk`
>
> （含核心 + 门面 + transport + mock），补状态机 / 队列 / 握手实现；
> 发布到私有 registry；H5 模板（react/vue）改为 npm 依赖引入，
>
> `scripts/api.js`
>
>  退役（同步链路 sync-h5-api.js/inject-h5-api.js 随之简化或移除）；
> 灰度：新 SDK 内保留 
>
> `window.RN.*`
>
>  兼容门面（即方案 §25 的 Legacy Adapter 反用 —— 本项目新 SDK 兼容旧门面），业务零改动切换。



***

## 4. 决策点（建议默认值，评审拍板）



| #   | 决策                                          | 建议                 | 理由                                                                                              |
| --- | ------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| 4.1 | 握手通道：新增 system 消息类型 vs 复用 request/event     | **复用**             | 协议零破坏；RN 侧 eventBus→postMessage 通道已存在；改动量最小                                                     |
| 4.2 | request 是否改为 `method:'camera.takePhoto'` 单串 | **不改**             | 现有全链路（protocol.ts/BridgeServer/api.js/mock/devtools）统一用 module+action，等价且已工作；改造收益仅 "对齐方案原文"，成本高 |
| 4.3 | SDK 是否抽独立 npm 包                             | **二期做**            | 一期先以单文件完成全部功能升级（成本最低、链路已验证）；包化涉及多仓 / 发布 / 模板依赖改造，独立里程碑                                          |
| 4.4 | 实施范围                                        | **A→F 一次做完，G 待定**  | A-F 共约 3.5 人日，阶段可独立提交验证；G 不影响功能正确性                                                              |
| 4.5 | waitUntilReady 是否强制业务改造                     | **SDK 内部排队，业务零改动** | 现有业务直接调 RN.\* 不 READY 也能用（排队 + flush 兜底）；`await RN.WAITUNTILREADY()` 作为新业务推荐写法，不强改存量            |



***

## 5. 验证与回归清单



* [ ] A：`npx tsc --noEmit` 通过；`app.getInfo` 含 protocolVersion

* [ ] B：devtools 握手测试通过；logcat 握手双路径日志正常；`scripts/api.js` 4 目标 MD5 一致（同步后重新校验）

* [ ] B：页面加载即并发 3 能力 → 排队 → flush → 全部成功（无超时）

* [ ] C：CDP `Page.reload` 后状态重置、队列不丢

* [ ] D：Home / 回 App → devtools 收到 app.background/app.resume

* [ ] E：logcat 见 appId 上报；错误 appId 有 warn 不阻断

* [ ] F：devtools 全绿（旧 11 项 + 新增握手 /waitUntilReady/hasCapability/ 事件）

* [ ] 回归：状态栏 / 导航栏高度正常、H5 能力调试页可用、index.html 无 JS 内联（规范）

* [ ] 打包：`node scripts/gradle.js installDebug` 装机后全量回归一遍 §5 清单

## 6. 风险与注意



* **双路径幂等**：`bridge.ready` 事件与 `app.ready` 响应都可能先到，`markReady` 必须幂等（已 ready 则忽略，重复订阅自动 off）。

* **握手死锁**：排队逻辑必须豁免 `app.ready` 自身，否则 SDK 自己把自己排进队列永不 flush。

* **injectedJavaScript 截断教训**：所有注入内容保持精简；`bridge.ready` 走 postMessage 事件而非注入，天然避开 2KB 截断坑。

* **reload 场景**：H5 路由级 reload（SPA 内部）不触发 WebView 重载，状态不重置（页面 JS 上下文未销毁，bridge 仍 ready）；仅整页 reload/WebView 重载时重置 —— 状态机按 `pageshow/pagehide` 处理即可，无需过度设计。

* **浏览器 Mock 一致性**：Mock 恒 ready 且不排队，保证脱离 App 的布局调试体验不变。

* **未提交改动**：当前基座与 jingyi\_h5 均有大量未提交改动（含本次计划将触碰的 protocol.ts/app.ts/WebViewBridge.tsx/api.js），建议 Phase A 前先 commit 一次基线，便于阶段回滚。