# ADR-0003：基座/业务范围边界——基座只承载通用容器能力

- 状态：已接受
- 日期：2026-10-13
- 决策人：基座维护团队

## 背景

基座（RNbase）定位是**多子应用共用的通用容器**：WebView 承载 + Bridge 受控能力边界 +
更新/安全/可观测/工程化。评估过程中曾把 i18n、主题 Design Token、业务埋点等列入提升
路线图；这些能力本质上是 **H5 业务层/子应用职责**，放入基座会导致：

- 基座被迫理解业务语义（文案、配色、打点口径），与「业务代码不外溢到 RN」原则冲突；
- 多子应用场景下单一实现无法满足各业务差异，最终变成没人用的抽象。

## 决策

| 能力 | 归属 | 说明 |
|------|------|------|
| i18n 多语言 | **H5 业务层** | 基座诊断页/错误页文案仅为运维诊断用途，保持中文硬编码，不预留框架 |
| 主题 Design Token | **H5 业务层** | 基座只负责把环境事实下发：`system.darkmodechange` 事件 + StatusBar 语义 |
| 业务埋点 analytics | **H5 业务层** | 基座 `observability`（JS 日志 + 崩溃上报闭环）覆盖运维可观测即可 |
| Feature Flag 远程配置 | **基座**（通用） | `src/config/remote-config.ts`，运行时开关不发版止血 |
| WebView/Bridge/更新/安全/工程化 | **基座** | 核心定位，持续投入 |

基座新增能力前先过一条判定线：**该能力是否与具体业务语义无关、且被多个子应用共享？**
两者皆否 → 归业务层，基座不做。

## 附：命名去业务化（2026-10-13 落实）

按同一判定线，原生模块命名中的 `ERP` 前缀（源自基座抽离前的宿主项目「精易ERP」）属于
业务语义残留，全平台统一改为 `Base` 前缀：

| 旧 | 新 |
|---|---|
| `ERPCapabilities` / `ERPNetwork` / `ERPPermissions` | `BaseCapabilities` / `BaseNetwork` / `BasePermissions` |
| `ERPH5` / `ERPLog` / `ERPSystem` / `ERPUpdate` | `BaseH5` / `BaseLog` / `BaseSystem` / `BaseUpdate` |
| Android 包 `com.qux.erp` | `com.qux.base` |
| Harmony `ets/erp/` + `ERPTurboModules.h` | `ets/base/` + `BaseTurboModules.h` |
| 占位域名 `mobile-erp.example.com`、`erp://` 示例 | `mobile-base.example.com`、`base://` |

JS↔原生模块名字符串是唯一契约面，三平台已同步；iOS/Harmony 编译验证见
`platforms/ios/TODO.md` #3 与 Harmony 构建。

## 后果

- ✅ 基座保持「薄、稳、通用」，升级方案 P3 范围相应裁剪；
- ⚠️ 各子应用需自行实现 i18n/埋点/主题消费，基座通过 Bridge 提供所需环境事实。
