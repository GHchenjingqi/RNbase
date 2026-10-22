# RN + H5 纯本地语音记账 App：分阶段执行计划 v2

> 文档用途：作为 AI 编程助手的项目级实施 Skill。要求先阅读现有仓库，  
> 按阶段逐步实施、验证、提交结果；不得一次性重写项目。
>
> **目标平台**：Android（本期）  
> **既有架构**：React Native 基座 + WebView 承载**本地打包**的 H5 业务页面  
> **语音方案**：模型随 APK 内置，安装后**全程离线**，无任何网络依赖  
> **体积目标**：release APK ≤ 60 MB（基于 25 MB 现有基线实测验收）  
> **交互方式**：点击麦克风开始录音，点击完成后识别并展示待确认账单
>
> **重要原则**：不调用第三方云端 ASR / LLM API；不上传录音、转写文本或账单内容。

---

## 0. v2 修订摘要（相比 v1）

本版基于项目真实基线重新设计，主要变更如下。执行者应先读这一节，避免沿用 v1 的过时假设。

| #  | 变更                                                 | 原因                                                      |
| -- | -------------------------------------------------- | ------------------------------------------------------- |
| 1  | **锁定模型为 Zipformer-zh-14M int8**，取消"待评估"留白          | 体积预算只允许 14M 级模型，留白会让执行者选到 228 MB 的 SenseVoice           |
| 2  | **删除模型下载器**（v1 Phase 05 的大部分），改为 assets 内置 + 完整性校验 | 模型内置后无下载需求，省掉 manifest/断点续传/回滚整套复杂度，同时消除模型托管域名在国内不可达的风险 |
| 3  | **补全 Bridge 的 `transaction.*` 接口**                 | v1 只定义了 `voice.*`，解析后的账单没有写入通道，Phase 07 必然卡死            |
| 4  | **体积目标从 50 MB 调整为 60 MB**，并给出逐项测算表                 | 50 MB 无测算依据；按真实基线重算后 55.1 MB 可达成，60 MB 留 4.9 MB 余量      |
| 5  | **Phase 01 增加可判定阈值**（金额准确率 ≥ 90%）                  | v1 只说"不达标就暂停"但未定义标准，DoD 无法判定                            |
| 6  | **补充 Foreground Service 要求**                       | Android 12+ 后台录音会被系统回收，v1 只笼统提到"处理 App 进后台"             |
| 7  | **补充 RN 新架构（0.76+）兼容判断**                           | 传统 `ReactContextBaseJavaModule` 在新架构下需额外处理，v1 未提及       |
| 8  | **修复 Bridge 接口表格格式损坏**                             | v1 中 `voice.getCapabilities` 被渲染成二级标题、分隔线错位，会干扰执行者解析    |
| 9  | **补充解析歧义规则**（"十二点八"、"三百二"、时间戳单位）                   | v1 留下未定义规则，会导致测试与实现互相打架                                 |
| 10 | **明确 assets 加载方式与 `noCompress` 配置**                | 若按常规做法复制到私有目录，手机上会占用双份 24 MB 存储                         |

---

## 1. 给执行者的总指令（必须先读）

你是本项目的资深 Android / React Native / TypeScript 工程师。请在当前仓库中实现本方案，但必须遵守以下规则。

1. **先检查、后修改。** 先识别仓库技术栈、RN 版本、Android Gradle 配置、WebView 封装、现有 `postMessage/onMessage` Bridge、H5 构建和注入流程、数据库现状、代码规范与测试命令。不得猜测目录或版本。
2. **保护现有项目。** 不要重建项目，不要无理由升级 React Native、Gradle、Kotlin、AGP 或 Node 依赖；不要替换现有 H5 架构。
3. **遵循既有 Bridge。** 优先扩展现有 `postMessage + onMessage` RPC 协议。若仓库已有 Bridge SDK、请求 ID、超时、能力检测、握手/ready 机制，必须复用，不得再造第二套并行协议。
4. **保留现有脚本约束。** 若项目已有 `inject-h5-api`，执行开发和构建前都必须遵循仓库规定运行该脚本；特别检查 `dev` 和 `build` 脚本是否已正确注入。
5. **分阶段执行。** 每次只执行当前阶段。先输出检查结果和实施计划，得到确认后再改动；阶段完成后运行相关测试，列出改动文件、执行命令、结果、未解决问题和下一阶段入口。
6. **不编造验证结果。** 没有实际运行过的测试必须标为"未运行"；没有测量过的 APK / 模型体积不得写成"已达标"。
7. **禁止秘密外传。** 不得将 API Key、用户数据、录音、账单内容发送到远端服务。
8. **不静默自动入账。** 识别结果只能先形成草稿；用户确认后才写入正式账单。
9. **模型与许可证审查。** 使用模型前，记录来源、许可证、文件清单、SHA-256、大小、输入采样率和推理要求。
10. **Android 优先。** 本阶段只实现 Android。架构不要阻止将来扩展 iOS，但不要为 iOS 提前引入不必要依赖。
11. **安全优先。** 模型加载失败时回退到可重试状态；防止路径穿越、任意文件覆盖。
12. **每阶段必须产出可检查的结果。** 至少包含代码改动、测试、阶段报告和可复现的验证步骤。

### 每阶段的标准输出格式

- 阶段名称和目标
- 仓库检查结果（仅列与本阶段相关的信息）
- 修改文件清单及每个文件的职责
- 执行过的命令
- 自动化测试和真机测试结果（明确区分）
- APK / 模型体积测量（若本阶段涉及）
- 已知限制、风险和未完成项
- Definition of Done 逐项通过 / 未通过
- 下一阶段可以开始的条件

---

## 2. 已锁定的项目基线

以下数据由项目方于 2026-10-21 确认，**执行者不得重新假设**，如与仓库实际不符应在 Phase 00 报告中提出。

| 项              | 值                      |
| -------------- | ---------------------- |
| H5 加载方式        | 本地项目，随 APK 打包（非远程 URL） |
| 现有 release APK | 约 25 MB（未含语音功能）        |
| 数据存储           | App 私有应用数据目录           |
| 目标平台           | Android                |

**结论**：离线架构成立。飞行模式下 H5 页面可正常打开，语音链路可完整运行。

---

## 3. 技术方案与选型

### 3.1 总体架构

```text
H5 (Vue 3 / TypeScript，本地打包)
  ├─ VoiceAccounting UI
  ├─ H5 Bridge SDK（复用现有实现）
  ├─ AccountingParser（纯 TypeScript，金额/日期/分类解析）
  └─ 通过 Bridge 调用原生持久化，不直接访问 SQLite
                 │ postMessage / onMessage
                 ▼
React Native Base
  ├─ BridgeManager / RequestManager / CapabilityManager（复用现有）
  ├─ VoiceAccountingModule（对 H5 暴露 voice.* 与 transaction.*）
  ├─ AudioRecorder（Kotlin / AudioRecord）
  ├─ SherpaAsrEngine（封装 sherpa-onnx）
  ├─ ModelIntegrity（内置模型校验与状态管理）
  └─ TransactionRepository（SQLite 唯一数据层）
                 │
                 ▼
App 私有目录
  ├─ files/models/<modelId>/<version>/   （仅校验记录，模型本体在 assets）
  └─ databases/accounting.db
```

**关键约束**：账单数据只由原生侧 SQLite 管理。H5 不直接读写数据库，也不在 IndexedDB / localStorage 中保存账本副本。

### 3.2 模型选型（已锁定）

```
sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23
  encoder-epoch-99-avg-1.int8.onnx    20.6 MB
  decoder-epoch-99-avg-1.int8.onnx     1.8 MB
  joiner-epoch-99-avg-1.int8.onnx      1.7 MB
  tokens.txt                          ~0.1 MB
  合计                                24.1 MB
```

- 许可证：Apache 2.0（发布前复核 icefall / k2-fsa 生态的具体许可条款）
- 输入：16 kHz、单声道、PCM 16-bit
- 类型：**流式 transducer**

> **执行注意 1**：这是流式模型，但产品交互是"点开始 → 点完成 → 一次性出结果"。  
> 实现时应持续 `acceptWaveform` 但不渲染中间结果，用户点完成后再 `inputFinished()` 并取最终文本。**不要实现边录边出字的 UI**，也不要因此改用非流式模型——流式模型可以当非流式用，反之不行。

> **执行注意 2**：体积预算只允许 14M 级模型。**不得替换为 Paraformer-zh-small（78 MB）或 SenseVoice（228 MB）**，否则总包会达到 109 MB / 259 MB，直接违反体积目标。

### 3.3 体积预算

| 组成                         | 体积            | 说明                    |
| -------------------------- | ------------- | --------------------- |
| 现有 RN 基座                   | 25.0 MB       | 实测基线                  |
| sherpa-onnx JNI（arm64-v8a） | 4.9 MB        | onnxruntime 已静态链接进 so |
| Kotlin + TS + H5 UI 新增代码   | ~1.0 MB       | 估算                    |
| Zipformer-zh-14M int8 模型   | 24.1 MB       | 见 §3.2                |
| tokens.txt                 | 0.1 MB        |                       |
| **合计**                     | **≈ 55.1 MB** | 余量 4.9 MB             |

**超限时的处理顺序**：先优化 ABI（只保留 arm64-v8a）、再压缩资源与剥离调试符号、最后才考虑模型侧方案。**不得通过降低模型规格以外的方式隐瞒超限**。

### 3.4 模型加载方式（重要）

模型放在 `android/app/src/main/assets/models/` 下，通过 sherpa-onnx 的 `AssetManager` 重载直接加载，**不要复制到 filesDir**。

```gradle
// android/app/build.gradle
android {
    aaptOptions {
        noCompress "onnx"   // 关键：onnx 需随机访问，不能被 zip 压缩
    }
}
```

```kotlin
// 从 assets 加载，避免双份存储
val recognizer = OnlineRecognizer(application.assets, config)
```

**原因**：若按常规做法把模型复制到 `filesDir`，手机上会同时存在 assets 内的 24 MB 和私有目录的 24 MB，实际占用翻倍至 48 MB。int8 模型本身压缩率只有 5%–10%，`noCompress` 不会显著增大 APK。

### 3.5 原生音频要求

- Android 只请求 `RECORD_AUDIO`，不请求与本功能无关的权限。
- 采样率以模型要求为准：本模型固定 **16 kHz、单声道、PCM 16-bit**（Phase 02 需实测确认）。
- 录音与推理均不得阻塞 UI 线程。
- **录音超过 30 秒必须使用 Foreground Service + 常驻通知**，否则 Android 12+ 在 App 切后台时会回收录音。通知文案需明确"正在录音"。
- 正确处理：权限拒绝、永久拒绝、音频初始化失败、无声输入、录音太短、超时、页面销毁、App 进入后台、取消操作。
- 默认不持久化原始音频；必要的临时文件写入 App 私有目录，任务结束后删除。
- 录音时显示明显状态和时长，提供取消入口。

### 3.6 SQLite 策略

- 先检查现有项目是否已有 SQLite 或统一持久化层。若已有则扩展，不引入第二套数据库。
- 若无，选择与当前 RN 版本和架构兼容的实现（如 `react-native-sqlite-storage` 或原生 `SQLiteOpenHelper`，由 Phase 00 的仓库检查结果决定）。
- 数据访问统一在 `TransactionRepository`，H5 与原生不得各自维护账单库。

---

## 4. Bridge 协议契约

必须复用项目已有的 RPC/Bridge 封装。以下为逻辑接口，不代表需要另建一套同名系统。

### 4.1 voice 方法

| 方法                       | 输入          | 输出                                 | 说明              |
| ------------------------ | ----------- | ---------------------------------- | --------------- |
| `voice.getStatus`        | 无           | 模型状态、版本、是否可识别                      | 不触发网络请求         |
| `voice.prepareModel`     | 无           | `ready` | `error`                  | 校验内置模型完整性并初始化引擎 |
| `voice.startRecording`   | `sessionId` | `started`                          | 检查权限并开始录音       |
| `voice.stopAndRecognize` | `sessionId` | `text`、`durationMs`、`modelVersion` | 停止录音并执行本地识别     |
| `voice.cancelRecording`  | `sessionId` | `cancelled`                        | 丢弃当前音频，不解析、不入账  |
| `voice.getCapabilities`  | 无           | 能力列表和版本                            | H5 用于功能检测       |

### 4.2 transaction 方法（v2 新增）

**这是 v1 缺失的关键部分。** H5 完成解析后必须通过以下接口持久化，不得让 H5 直接访问数据库。

| 方法                    | 输入                           | 输出                | 说明             |
| --------------------- | ---------------------------- | ----------------- | -------------- |
| `transaction.save`    | `draft`、`idempotencyKey`     | `id`、`createdAt`  | 写入账单，必须幂等      |
| `transaction.list`    | `from`、`to`、`limit`、`offset` | `items[]`、`total` | 按时间倒序分页查询      |
| `transaction.update`  | `id`、`patch`                 | `updated`         | 编辑已有账单         |
| `transaction.delete`  | `id`                         | `deleted`         | 软删除或硬删除，规则由产品定 |
| `transaction.summary` | `from`、`to`、`groupBy`        | 汇总数据              | 分类/日期聚合，供首页展示  |

**幂等要求**：`transaction.save` 必须接受 `idempotencyKey`（建议由 H5 生成 UUID）。同一 key 重复提交返回首次结果，不得产生重复账单。

### 4.3 事件

- `voice.modelStateChanged`：`state`、`modelId`、`version`、`errorCode?`
- `voice.recordingStateChanged`：`sessionId`、`state`、`durationMs?`
- `voice.error`：`requestId?`、`sessionId?`、`code`、`message`

事件不能只依赖一次性 Promise；录音状态必须支持持续事件。页面重载后 H5 应重新查询状态，不能假设此前事件一定送达。

> **v2 说明**：由于模型内置，v1 中的 `voice.modelProgress` 下载进度事件和 `voice.downloadModel` / `voice.cancelModelDownload` 方法**本期不实现**。

### 4.4 统一错误码

`E_BRIDGE_NOT_READY`、`E_UNSUPPORTED_CAPABILITY`、`E_PERMISSION_DENIED`、`E_PERMISSION_PERMANENTLY_DENIED`、`E_MODEL_NOT_READY`、`E_MODEL_CHECKSUM_MISMATCH`、`E_MODEL_LOAD_FAILED`、`E_AUDIO_INIT_FAILED`、`E_AUDIO_EMPTY`、`E_AUDIO_TOO_SHORT`、`E_RECOGNITION_FAILED`、`E_RECOGNITION_TIMEOUT`、`E_CANCELLED`、`E_STORAGE_INSUFFICIENT`、`E_DATABASE_ERROR`

错误信息给用户展示前应转换为易懂中文；详细堆栈只进入本地调试日志，不得写入账单备注。

---

## 5. 模型内置与完整性管理

### 5.1 目录结构

```text
assets/models/zh-small/1.0.0/
  ├─ encoder.int8.onnx
  ├─ decoder.int8.onnx
  ├─ joiner.int8.onnx
  ├─ tokens.txt
  └─ model-manifest.json

files/models/
  └─ state.json      # 校验记录：modelId、version、verifiedAt、sha256 摘要
```

### 5.2 清单结构

```json
{
  "schemaVersion": 1,
  "modelId": "zh-small",
  "version": "1.0.0",
  "engine": "sherpa-onnx",
  "engineCompatibility": "1.12.x",
  "language": "zh",
  "sampleRate": 16000,
  "files": [
    { "path": "encoder.int8.onnx", "sizeBytes": 21598532, "sha256": "<构建时计算>" },
    { "path": "decoder.int8.onnx", "sizeBytes": 1887436,  "sha256": "<构建时计算>" },
    { "path": "joiner.int8.onnx",  "sizeBytes": 1782579,  "sha256": "<构建时计算>" },
    { "path": "tokens.txt",        "sizeBytes": 102400,   "sha256": "<构建时计算>" }
  ],
  "license": { "name": "Apache-2.0", "url": "<模型来源页面>" }
}
```

**`sizeBytes` 与 `sha256` 必须是构建时脚本计算出的真实值**，不得保留占位符。建议加一个构建期校验脚本，发现占位值直接失败。

### 5.3 首次启动流程

1. 读取 `assets/models/zh-small/1.0.0/model-manifest.json`。
2. 比对 `files/models/state.json` 中的版本与校验记录。
3. 若未校验过或版本变化：逐文件计算 SHA-256 并与清单比对。
4. 校验通过后执行一次冒烟识别（内置 1 秒测试音频或静音音频），确认引擎可初始化。
5. 写入 `state.json`，状态变为 `ready`。
6. 校验失败：状态置为 `error`，提示"语音模型异常，请重新安装应用"，不尝试联网修复。

### 5.4 离线规则

- `ready` 状态只依据本地文件完整性和成功加载记录确定。
- 识别路径**不得调用任何网络接口**。
- 应用启动不得因任何远端服务不可用而失败。
- 模型升级随 App 版本发布，本期不做热更新。

---

## 6. 记账数据模型与解析规则

### 6.1 类型定义

```ts
export type TransactionType = 'expense' | 'income' | 'transfer';
export type Confidence = 'high' | 'medium' | 'low';

export interface ParsedMoney {
  amountFen: number | null;
  sourceText: string | null;
  confidence: Confidence;
  needsConfirmation: boolean;
}

export interface VoiceTransactionDraft {
  type: TransactionType | null;
  amountFen: number | null;
  categoryId: string | null;
  occurredAt: number | null;        // Unix 毫秒时间戳
  paymentMethod: string | null;
  note: string;
  rawTranscript: string;
  fieldConfidence: {
    type: Confidence;
    amount: Confidence;
    category: Confidence;
    occurredAt: Confidence;
    paymentMethod: Confidence;
  };
  warnings: string[];
  requiresConfirmation: boolean;
}
```

原始转写文本只用于当前草稿纠错，不长期保存。

### 6.2 金额规则

必须覆盖：

- 阿拉伯数字：`12`、`12.8`、`1,280.50`
- 中文数字：`十二`、`一百零二`、`两千`
- 单位：元/块、角/毛、分
- `十二块八` → 12.80 元
- `十二块五毛` → 12.50 元
- `三十八块五分` → 38.05 元（有"分"字时，末位数字是分，不是角）
- `三百二` → 320 元，标记 `needsConfirmation`
- `两千三` → 2300 元，标记 `needsConfirmation`
- 多金额语句：`午餐 25 元，咖啡 18 元` → 必须提示选择或按明确规则拆成两笔，不可随意取第一个数字
- 退款、折扣、找零、百分比、电话号码、日期中的数字不得误判为金额

**歧义处理规则（v2 新增，必须实现）**：

| 表达式                           | 判定                | 理由            |
| ----------------------------- | ----------------- | ------------- |
| `十二点八`                        | 金额 12.80，标记确认     | 记账语境下"点"多指小数点 |
| `十二点半`                        | 时间 12:30          | 有"半"字必为时间     |
| `十二点`                         | 时间 12:00，标记确认     | 无小数位，倾向时间     |
| `X 点 Y` 且句中含日期线索（今天/昨天/上午/晚上） | 时间                | 语境优先          |
| 中文数字末尾单独数字（`三百二`、`两千三`）       | 按口语补位：百后补十位、千后补百位 | 标记确认          |

内部使用整数分；禁止用浮点数直接累加金额。解析器必须有独立单元测试，不能只靠 ASR 效果验证。

### 6.3 日期与时间

- `今天`、`昨天`、`前天`、`上周五`、`昨晚` 等相对日期基于设备本地时间解析。
- 未说时间时采用当前日期，UI 允许修改。
- 对 `周五` 等无明确周次的表达，采用固定规则（取最近一个过去的周五）并显示确认。
- 数据库存 **Unix 毫秒时间戳**，展示时使用设备本地时区。全链路统一毫秒，不得混用秒。

### 6.4 收支与类别

第一版提供可配置本地关键词词典，建议类别：餐饮、饮品、交通、购物、居家、娱乐、医疗、工资、奖金、退款、其他。实际分类服从用户的账本配置。

- "买/花/支付/消费" → 支出线索
- "收到工资/到账/收款" → 收入线索
- "从银行卡转到现金账户" → 账户内部转账，不计入收入或支出
- "退款" → 需产品定义是冲减原支出还是单独记录
- 同时出现收入与支出、多个金额或分类冲突 → 标记需确认

---

## 7. SQLite 数据库设计

先审查现有数据库；若无，再选兼容当前 RN 版本的实现。不要在 H5 IndexedDB、WebView localStorage 和原生 SQLite 三处重复保存同一份账单。

### `transactions`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | UUID |
| `type` | TEXT NOT NULL | expense / income / transfer |
| `amount_fen` | INTEGER NOT NULL | 整数分 |
| `category_id` | TEXT NULL | |
| `account_id` | TEXT NULL | |
| `occurred_at` | INTEGER NOT NULL | **Unix 毫秒** |
| `note` | TEXT | |
| `payment_method` | TEXT | |
| `source` | TEXT NOT NULL | voice / manual |
| `idempotency_key` | TEXT UNIQUE NULL | 防重复提交 |
| `created_at` | INTEGER NOT NULL | 毫秒 |
| `updated_at` | INTEGER NOT NULL | 毫秒 |

### `categories`

`id` TEXT PRIMARY KEY、`name` TEXT NOT NULL、`type` TEXT NOT NULL、`keywords_json` TEXT、`sort_order` INTEGER NOT NULL DEFAULT 0

### `accounts`

`id` TEXT PRIMARY KEY、`name` TEXT NOT NULL、`type` TEXT NOT NULL、`created_at` INTEGER NOT NULL

### 要求

- 使用数据库版本号和 migration 文件升级 schema。
- `amount_fen` 使用整数；禁止浮点。
- 保存与关联更新使用事务。
- 为 `occurred_at`、`category_id`、`account_id` 建立索引。
- 保存前校验金额、日期、类型及分类有效性。
- 使用 UUID，避免时间戳作主键。
- `idempotency_key` 唯一约束防重复。
- 用户取消草稿时不得写入账单表。
- 数据库结构不得阻止后续增加导出/备份能力。

---

## 8. H5 UI 状态与交互

必须实现以下状态，不能只做一个按钮加弹窗：

`checking_model` → `model_missing` / `model_error` → `model_ready` → `requesting_permission` → `recording` → `recognizing` → `editing_draft` → `saving` → `success` / `error`

> v2 说明：`downloading` 状态本期不存在（模型内置）。

### 交互要求

- 录音开始后显示明显动画和时长，提供"完成"和"取消"。
- 点击取消后丢弃音频，不触发解析或入账。
- 识别中显示明确等待状态，禁用重复点击。
- 识别完成后同时显示原始转写文本和结构化账单草稿。
- 金额、收支类型、分类、日期、支付方式均可编辑。
- 低置信度字段显示提示；金额模糊时不允许快速确认（需二次点击）。
- 保存成功后显示反馈并刷新账单列表。
- 所有错误有可理解的中文提示和恢复动作。
- H5 reload 后重新查询原生状态，不依赖旧的内存状态。

---

## 9. 分阶段执行计划

### Phase 00：仓库侦察与基线记录

**目标**：不修改业务代码，弄清现有项目。

任务：

1. 检查目录、`package.json`、RN 版本、**是否启用新架构（Fabric / TurboModules）**、WebView 组件、Android Gradle / Kotlin / NDK 配置。
2. 找出 Bridge 实现、消息格式、握手机制、请求超时、事件订阅和能力检测。
3. 检查 H5 目录、构建脚本、模型资源处理方式、数据库依赖。
4. 检查 `inject-h5-api` 是否存在，dev/build 前置调用是否已配置。
5. 检查现有 APK 的 ABI 拆分策略（是否只保留 arm64-v8a）。
6. 执行现有 lint、typecheck、test、Android release build（环境允许时）。
7. 记录基线 APK 大小和构建命令。

交付：`docs/voice-accounting/phase-00-audit.md`，含当前架构图、复用清单、风险与兼容表。

DoD：

- 未修改核心业务逻辑。
- 每个结论均有仓库文件或命令输出依据。
- RN 版本与新架构状态已明确记录。
- 基线 APK 体积已实测。
- 所有无法执行的检查明确说明原因。

### Phase 01：模型基准测试（阻塞性门槛）

**目标**：用真实录音验证 14M 模型是否满足记账场景，不接任何业务 UI。

任务：

1. 确认 sherpa-onnx Android 依赖与当前 RN / NDK / Gradle 兼容。
2. 建立 **50 条真实记账语句测试集**，必须真人录制，不得使用 TTS 合成。
   覆盖：中文数字、阿拉伯数字、口语省略、多金额、日期表达、英文品牌名（如"Netflix 会员"）、安静与轻微噪声两种环境。
3. 在目标真机（至少一台中端机，记录型号）离线运行推理。
4. 测量：模型初始化耗时、单句推理耗时、峰值内存、金额识别准确率。

**验收阈值（必须逐项判定）**：

| 指标 | 阈值 |
|---|---|
| 金额完全正确 | ≥ 45 / 50（90%） |
| 收支类型正确 | ≥ 45 / 50（90%） |
| 分类正确 | ≥ 40 / 50（80%） |
| 整句 CER | ≤ 15%（参考值） |
| 单句推理耗时（10 秒音频） | ≤ 1.5 s |
| 模型初始化耗时 | ≤ 3 s |
| 推理峰值内存 | ≤ 300 MB |

**决策规则**：

- 金额准确率 ≥ 90% → 通过，进入 Phase 02。
- 80%–90% → 条件通过，继续实施，但 §6.2 的确认逻辑必须更激进，并启动领域微调评估。
- < 80% → **阻塞**。暂停实施并报告，由项目方决定是微调模型还是调整产品策略。**不得降低阈值来通过验收。**

交付：`docs/voice-accounting/model-evaluation.md`，含模型来源、许可证、SHA-256、测试集、逐条结果、设备信息。

DoD：

- 断网可推理。
- 模型文件可从仓库复现并校验。
- 上述阈值逐项有实测数字，未运行的项标"未运行"。

### Phase 02：原生 ASR PoC

**目标**：在 RN 中获得本地识别结果。

任务：

1. 新建最小原生 ASR adapter，封装初始化、识别、释放。
2. 按 §3.4 通过 `AssetManager` 加载 assets 中的模型，不复制到私有目录。
3. 按流式模型方式使用：持续 `acceptWaveform`，结束时 `inputFinished` 取最终文本，不渲染中间结果。
4. 通过最小调试入口输入预置 PCM/WAV 测试音频。
5. 后台线程执行推理，正确释放资源。
6. 为初始化失败、文件缺失、模型不兼容、推理超时定义错误码。

DoD：

- 真机断网时可对预置音频识别。
- 无 UI 卡死、崩溃或资源泄漏的已知问题。
- 未引入第二套 ASR 引擎。
- 手机存储占用未出现模型双份。

### Phase 03：录音与生命周期

**目标**：从手机麦克风录音并识别。

任务：

1. 使用 `AudioRecord` 实现权限检查、开始、停止、取消。
2. 按模型要求设置 16 kHz、单声道、PCM 16-bit。
3. 录音和推理运行在后台线程。
4. **录音超过 30 秒启用 Foreground Service + 常驻通知**。
5. 处理静音、太短音频、录音失败、权限拒绝、页面销毁、App 后台切换。
6. 默认不持久化原始音频，临时文件任务结束后删除。
7. 添加最小化原生测试入口，不接记账数据库。

DoD：

- 点击开始、说话、点击完成后得到文本。
- 点击取消不返回有效账单文本。
- 权限拒绝有恢复指引。
- 多次连续录音正常。
- 录音中切后台 60 秒后仍能正常完成。

### Phase 04：Bridge 集成

**目标**：H5 可安全控制语音与账单写入。

任务：

1. 复用现有 Bridge SDK、RPC、requestId、事件订阅、超时、握手和能力检测。
2. 实现 §4.1 的 `voice.*` 与 §4.2 的 `transaction.*` 全部方法。
3. 所有请求做参数校验，所有返回使用统一 envelope。
4. 防止重复开始录音、重复停止、页面销毁后的悬空 Promise。
5. `transaction.save` 实现 `idempotencyKey` 幂等。
6. H5 页面 reload 后重新查询模型和录音状态。
7. 对不支持语音能力的基座返回 `E_UNSUPPORTED_CAPABILITY`。

DoD：

- H5 可开始、停止、取消录音并收到识别结果。
- H5 可通过 `transaction.save` 写入账单并幂等去重。
- 超时、取消、重复请求均有明确行为。
- 没有第二套互不兼容的 Bridge。

### Phase 05：模型内置、校验与状态管理

**目标**：保证内置模型完整可加载，安装后永久离线可用。

任务：

1. 将模型文件放入 `assets/models/zh-small/1.0.0/`，配置 `noCompress "onnx"`。
2. 编写构建期脚本计算每个文件的真实 `sizeBytes` 与 `sha256`，写入 `model-manifest.json`；发现占位值则构建失败。
3. 实现首次启动校验流程（§5.3）。
4. 实现状态持久化（`files/models/state.json`），冷启动读取并验证。
5. 校验失败时置为 `error` 状态并给出明确指引，不尝试联网修复。
6. 确认 ASR 推理路径无任何网络调用。

DoD：

- 哈希不匹配时模型绝不加载。
- 校验通过后开启飞行模式仍可识别。
- 删除 `state.json` 后能重新校验并恢复。
- 未引入下载器、manifest 远端拉取或任何联网逻辑。

### Phase 06：纯 TypeScript 记账解析器

**目标**：将转写文本转换为可靠草稿。

任务：

1. 建立独立 `AccountingParser` 模块，不耦合 UI 和 Bridge。
2. 实现 §6.2 全部金额规则，**含歧义处理表**。
3. 实现收入、支出、转账意图识别。
4. 实现日期、支付方式、分类关键词解析。
5. 对多金额、退款、转账、模糊口语、矛盾表达添加警告。
6. 统一使用整数分，禁止浮点。
7. 为置信度定义明确、可测试的规则；没有统计校准前不得伪造概率值。
8. 建立至少 **200 条**测试语句，含正例、反例和歧义样本。

DoD：

- 所有金额规则都有单元测试。
- `三百二`、`十二点八`、`十二点半` 等歧义表达按 §6.2 表格判定并有测试。
- 多金额和退款不会静默错误入账。
- Parser 可独立运行，不需要 RN 原生模块。

### Phase 07：SQLite 与 Repository

**目标**：建立可靠的本地账本持久化。

任务：

1. 审查已有 SQLite / 数据层；有则扩展。
2. 定义三张表及迁移版本（§7）。
3. 创建 `TransactionRepository`，实现 §4.2 中 `transaction.*` 对应的原生能力。
4. 事务保存、字段校验、`idempotency_key` 防重复。
5. 处理数据库打开失败、迁移失败、磁盘不足。
6. 提供列表查询、按日期查询、分类汇总接口。

DoD：

- 保存后重启 App 账单仍存在。
- 金额以整数分保存。
- 取消草稿不写入数据库。
- 同一 `idempotencyKey` 重复保存不产生重复记录。
- 迁移有自动化测试或可复现的手工测试。

### Phase 08：H5 语音记账 UI

**目标**：完成用户可使用的业务流程。

任务：

1. 按项目现有 Vue 3 组件规范实现语音记账页面/弹层。
2. 实现 §8 全部状态（不含 `downloading`）。
3. 显示录音时长和明确的完成/取消按钮。
4. 显示转写文本和可编辑账单字段。
5. 低置信度或多金额时显示确认提示。
6. 保存成功后刷新账单列表。
7. 适配 H5 页面 reload、WebView 销毁和原生事件重新订阅。
8. 不改变其他 H5 业务页面和现有导航。

DoD：

- 可从 UI 完成整笔语音记账。
- 取消、返回、权限拒绝、识别失败均有正确状态。
- 所有字段均可手动修正。
- 没有确认前不会入账。

### Phase 09：端到端离线测试

**测试清单**：

- 全新安装后首次启动，模型校验通过。
- **开启飞行模式**，点击录音、说出记账语句、停止识别。
- 修正金额/分类并保存。
- 强制停止并重新打开 App，查询已保存账单。
- 模型文件被篡改（手动改一个字节）后能检测并拒绝加载。
- 删除 `state.json` 后能重新校验恢复。
- 拒绝麦克风权限时提供引导。
- 磁盘不足、模型加载失败。
- WebView 刷新、App 进后台、快速重复点击。
- 多金额、中文数字、退款、转账、日期边界。
- 录音中切后台 60 秒。

DoD：

- 语音识别、解析、保存的运行路径在模型 ready 后不发出任何业务网络请求。
- 断网测试有明确记录或自动化测试结果。
- 失败场景不会导致错误账单写入。

### Phase 10：体积、性能与发布准备

**目标**：实测体积并完成发布前检查。

任务：

1. 使用 release 构建，不以 debug APK 体积作结论。
2. 记录 APK 大小、ABI、资源占用明细，**与 §3.3 预算表逐项对照**。
3. 确认 ABI 拆分策略；若仅保留 arm64-v8a，记录放弃 32 位设备的决策。
4. 检查是否重复打包 JNI / ONNX Runtime。
5. 确认 `noCompress "onnx"` 已生效，模型未被二次压缩或复制。
6. 检查 sourcemap、测试音频、调试日志、未使用资源、调试符号。
7. 测量冷启动、模型初始化、单句推理、峰值内存、连续使用稳定性。
8. 检查日志是否意外输出转写文本、文件路径、敏感账单数据。
9. 编写用户说明：语音识别全程离线，不联网、不上传。
10. 编写模型许可证与第三方依赖清单。

DoD：

- 有可复现的 release 构建命令。
- APK 体积有真实测量记录，且 ≤ 60 MB 或明确说明超出原因与后续计划。
- 手机存储占用未出现模型双份。
- 性能结果包含真实设备型号和测试条件。
- 无云端 ASR/LLM 请求。

---

## 10. 自动化测试设计

### 10.1 Parser 单元测试（至少 200 条，以下为必测样本）

| 语音转写 | 关键预期 |
|---|---|
| 昨天午餐花了三十八块五 | 支出，3850 分，日期为昨天 |
| 买咖啡十二块八，微信支付 | 支出，1280 分，类别饮品，支付方式微信 |
| 今天工资到账八千元 | 收入，800000 分 |
| 地铁四块五 | 支出，450 分，类别交通 |
| 三百二 | 32000 分，必须确认 |
| 两千三 | 230000 分，必须确认 |
| 三十八块五分 | 3805 分（分不是角） |
| 十二点八 | 金额 1280 分，标记确认 |
| 十二点半 | 时间 12:30，不是金额 |
| 午餐二十五，咖啡十八 | 多金额警告，禁止静默选一个 |
| 从银行卡转到现金账户五百元 | 转账，不计作收入/支出 |
| 退款三十元 | 按产品规则处理，不能当收入 |
| 花了十元，后来又花二十元 | 检查多金额规则 |
| 今天 12 点吃饭花了 30 元 | 12 是时间，30 才是金额 |
| Netflix 会员六十八 | 类别娱乐，金额 6800 分 |

### 10.2 Android 集成测试

模型校验通过 / 哈希不匹配拒绝加载 / 状态恢复 / 模型初始化失败恢复 / 权限拒绝 / 录音取消 / 空音频与短音频 / 连续录音 / 录音切后台 / 页面 reload 状态恢复 / 飞行模式识别 / SQLite 保存读取 / 幂等去重 / release APK 体积检查。

### 10.3 网络隔离验证

使用 Android Studio Network Inspector、系统日志或抓包方式确认：模型 ready 后，语音识别链路不请求任何远端服务。**只靠代码搜索 `fetch` 或 URL 字符串不能证明整个应用无网络访问。**

---

## 11. 建议目录结构（以仓库实际结构为准）

```text
repo/
├─ android/app/src/main/
│  ├─ assets/models/zh-small/1.0.0/
│  │  ├─ encoder.int8.onnx
│  │  ├─ decoder.int8.onnx
│  │  ├─ joiner.int8.onnx
│  │  ├─ tokens.txt
│  │  └─ model-manifest.json
│  └─ java/<package>/voice/
│     ├─ VoiceAccountingModule.kt
│     ├─ AudioRecorder.kt
│     ├─ SherpaAsrEngine.kt
│     ├─ ModelIntegrity.kt
│     ├─ TransactionRepository.kt
│     └─ VoiceError.kt
├─ src/bridge/voiceAccounting.ts
├─ h5/src/features/voice-accounting/
│  ├─ VoiceAccountingView.vue
│  ├─ accountingParser.ts
│  ├─ moneyParser.ts
│  ├─ dateParser.ts
│  ├─ categoryRules.ts
│  └─ __tests__/
├─ docs/voice-accounting/
│  ├─ SKILL.md
│  ├─ phase-00-audit.md
│  ├─ model-evaluation.md
│  ├─ bridge-contract.md
│  ├─ database-schema.md
│  ├─ test-plan.md
│  └─ release-checklist.md
└─ scripts/
   └─ compute-model-manifest.sh
```

这只是逻辑组织建议。执行者必须先读取现有仓库结构，再决定实际路径；不得为匹配此示例而大规模移动项目文件。

---

## 12. 项目级验收标准（最终 DoD）

- [ ] Android release APK 实测 ≤ 60 MB，报告含构建变体和 ABI 支持范围。
- [ ] 手机实际存储占用未出现模型双份。
- [ ] 首次启动模型校验通过并成功加载。
- [ ] **飞行模式下**可完成录音、识别、解析、确认、保存完整闭环。
- [ ] 模型文件被篡改后拒绝加载并给出明确提示。
- [ ] 中文金额解析有单元测试，模糊金额不会静默入账。
- [ ] 收入、支出、转账、多金额、退款规则有测试覆盖。
- [ ] H5 ↔ RN 使用既有 Bridge，不引入第二套消息协议。
- [ ] `transaction.save` 幂等去重生效。
- [ ] 权限拒绝、磁盘不足、模型加载失败均有明确错误和恢复路径。
- [ ] 识别与记账业务链路不调用任何云端 ASR/LLM API。
- [ ] 不会未经用户确认自动写入账单。
- [ ] 自动化测试、真机测试和体积测试均有报告。
- [ ] 模型与第三方依赖许可证经过检查。
- [ ] 现有 H5 业务、RN 基座启动、Bridge 既有功能和 dev/build 流程回归通过。

---

## 13. 执行指令

将本文件放入仓库 `docs/voice-accounting/SKILL.md`。

### 第一轮：只执行 Phase 00

```text
请先完整阅读 docs/voice-accounting/SKILL.md。
现在只执行 Phase 00：仓库侦察与基线记录。
不要修改业务代码，不要升级依赖，不要开始集成 ASR。
重点确认：RN 版本与是否启用新架构、现有 ABI 拆分策略、Bridge 现状、
数据库现状、inject-h5-api 流程、基线 release APK 体积。
输出 phase-00-audit.md。所有结论必须有文件路径或命令结果支持。
完成后停止并汇报。
```

### 第二轮：Phase 01（阻塞性门槛）

```text
请阅读 SKILL.md 和 phase-00-audit.md。
现在只执行 Phase 01：模型基准测试。
不接业务 UI，不改动现有页面。
用 zipformer-zh-14M int8 模型，在真机上跑 50 条真实录音测试集，
按 SKILL.md §9 Phase 01 的七项阈值逐项判定并给出实测数字。
任何未实际运行的测试必须标记为"未运行"。
完成后停止并汇报，等待项目方决定是否进入 Phase 02。
```

### 后续每一轮

```text
请阅读 SKILL.md 和已完成的阶段报告。
只执行 Phase NN，不要提前实现后续阶段。
先列出计划修改的文件与兼容性风险，再实施。
完成后运行本阶段相关测试，汇报改动、命令、结果、DoD 和未解决问题。
未运行的测试必须明确标记为未运行。完成本阶段后停止等待下一条指令。
```

将 `NN` 替换成 `02` 到 `10`，按顺序执行。若某阶段发现前置条件不满足，先修复或报告阻塞原因，不得跳过验收继续堆功能。

### 每阶段 Git 建议

```
docs: audit RN H5 base for offline voice accounting
test(asr): benchmark zipformer-14M on real accounting corpus
feat(android): add offline ASR proof of concept
feat(android): add local audio recording with foreground service
feat(bridge): expose voice and transaction APIs
feat(android): verify bundled model integrity
feat(h5): parse Chinese voice accounting drafts
feat(storage): persist transactions in SQLite
feat(h5): add voice accounting confirmation UI
test: verify offline voice accounting workflow
perf(android): measure release APK size and finalize checklist
```

只有在项目现有分支策略允许时才提交；不要覆盖用户未提交的修改。

---

## 14. 参考资料

实施前应重新核对版本与官方文档，避免依赖过期 API。

- Sherpa-ONNX 仓库：<https://github.com/k2-fsa/sherpa-onnx>
- Sherpa-ONNX Android 文档：<https://k2-fsa.github.io/sherpa/onnx/android/index.html>
- Sherpa-ONNX 预训练模型：<https://k2-fsa.github.io/sherpa/onnx/pretrained_models/index.html>
- Zipformer-zh-14M 模型页：<https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html>
- Android `AudioRecord`：<https://developer.android.com/reference/android/media/AudioRecord>
- Android 前台服务：<https://developer.android.com/develop/background-work/services/foreground-services>
- Android 运行时权限：<https://developer.android.com/training/permissions/requesting>
- React Native Native Modules：<https://reactnative.dev/docs/native-modules-intro>
- React Native 新架构：<https://reactnative.dev/docs/new-architecture-intro>
- SQLite：<https://www.sqlite.org/docs.html>

若官方链接或模型页面发生变化，以官方仓库当前说明为准，并在 `model-evaluation.md` 中记录最终选用版本与来源。

---

## 15. 交付物清单

1. `docs/voice-accounting/SKILL.md`：本执行规范。
2. `docs/voice-accounting/phase-00-audit.md`：真实仓库审计结果。
3. `docs/voice-accounting/model-evaluation.md`：模型许可证、体积、真机评测与阈值判定。
4. 原生 Android 录音、Sherpa-ONNX 集成、前台服务代码。
5. 模型内置、校验与状态管理代码及构建期 manifest 生成脚本。
6. H5/RN Bridge 类型、方法（`voice.*` 与 `transaction.*`）与事件契约。
7. TypeScript 金额、时间、分类、收支解析器及测试。
8. SQLite schema、migration 与 `TransactionRepository`。
9. H5 语音记账 UI、草稿确认与错误处理。
10. 端到端离线测试记录、release APK 体积报告和发布检查清单。

**最终原则：先用真实录音证明 14M 模型在目标机型上的金额识别达到 90%，再逐步连接录音、Bridge、解析器和数据库。** 这个数字不达标，后面所有工作都会白做。
