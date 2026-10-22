# 离线语音识别可行性探针（RNbase + RN_h5）

> 目的：在正式落地完整「语音记账」项目前，先用最小改动验证一条核心链路——
> **RN 基座集成 sherpa-onnx 离线 ASR，H5 通过既有 Bridge 调用并拿到识别文本**。
> 真机跑通后再决定是否进入 `SKILL.md` 的 10 阶段完整计划。

## 这一探针改了什么（最小侵入）

| 层 | 文件 | 改动 |
|---|---|---|
| 原生 Android | `platforms/android/app/src/main/java/com/qux/base/SherpaAsrEngine.kt`（新增） | 离线识别引擎：assets 直接加载模型、16kHz 单声道录音、PCM→float、整段喂入取结果。 |
| 原生 Android | `platforms/android/app/src/main/java/com/qux/base/BaseCapabilitiesModule.kt` | 新增 `voiceGetStatus / voicePrepareModel / voiceStartRecording / voiceStopAndRecognize / voiceCancelRecording` 五个 `@ReactMethod`，含 RECORD_AUDIO 权限处理。 |
| Android 构建 | `platforms/android/app/build.gradle` | 增加 `sherpa-onnx-android:1.12.11` 依赖；`aaptOptions.noCompress "onnx"`。 |
| RN 桥（TS） | `src/bridge/modules/capabilities/voice.ts`（新增） | 注册 `voice.*` 模块。 |
| RN 桥（TS） | `src/middleware/native/capability-native-adapters.ts` | 声明 `voice*` 原生方法 + `voice` 适配器块。 |
| RN 桥（TS） | `src/bridge/modules/capabilities/types.ts` | `VoiceAdapter` 接口。 |
| RN 桥（TS） | `src/bridge/index.ts` | 注册 `voice` 模块。 |
| H5 门面 | `scripts/api.js` | `MODULES` 表增加 `VOICE`（会被 `inject-h5-api` 自动注入 H5 产物）。 |
| 模型 | `scripts/fetch-model.sh`（新增） | 从 HuggingFace 拉取 zipformer-zh-14M int8 模型到 `assets/models/zh-small/1.0.0/`。 |
| 测试页 | `voice-accounting/feasibility-test/index.html`（新增） | 自包含 H5 测试页，优先用注入的 `window.RN`，否则走浏览器 Mock。 |

> 设计原则（与 `SKILL.md` 一致）：不新建第二套 Bridge 协议；模型从 assets 直接加载不复制；
> 全程无网络调用；识别结果只返回文本，不自动入账。

## 一、拉取模型（必须，约 24 MB）

```bash
bash scripts/fetch-model.sh
```

下载到 `platforms/android/app/src/main/assets/models/zh-small/1.0.0/`：
`encoder-epoch-99-avg-1.int8.onnx`、`decoder-epoch-99-avg-1.int8.onnx`、
`joiner-epoch-99-avg-1.int8.onnx`、`tokens.txt`。

> 国内若 `huggingface.co` 不可达，设置镜像：
> `SHERPA_MODEL_BASE_URL=https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/resolve/main bash scripts/fetch-model.sh`
> `.onnx` 体积大，不要提交到 git（可由脚本复现）。

## 二、构建并安装到真机（Android）

```bash
# 在项目根目录
cd platforms/android
./gradlew assembleDebug        # 或 assembleRelease
```

产物 APK 位于 `platforms/android/app/build/outputs/apk/`。
安装到一台**中端真机**（arm64-v8a，与项目 ABI 策略一致），授予麦克风权限。

> 注意：本机环境没有 Android SDK / 设备，以上构建与真机步骤由你执行。

## 三、运行 H5 语音测试页

把 `voice-accounting/feasibility-test/index.html` 接入你的 H5 工程，两种方式任选：

1. **并入 H5 源码**：复制到你的 H5 子应用目录，作为普通页面构建；`inject-h5-api` 会自动把
   `scripts/api.js`（已含 `VOICE` 模块）注入，页面用 `window.RN.VOICE.*` 调用真机能力。
2. **独立调试**：直接用浏览器打开本 `index.html` 看 UI 与流程（自动进入 Mock 模式，返回模拟文本，
   不依赖真机）；真机验证时务必走方式 1 让 `window.RN` 真正注入。

页面按钮顺序：**检查模型状态 → 准备模型 → 开始录音 → 说话 → 完成并识别**。
真机环境下「完成并识别」应返回你刚说的中文文本；浏览器 Mock 会随机返回示例记账句。

## 四、真机验收清单（决定是否落地完整项目）

- [ ] 飞行模式（断网）下点击「准备模型」成功，`state=ready`。
- [ ] 断网状态下录音并识别，返回正确的中文文本（无网络请求）。
- [ ] 中文数字 / 阿拉伯数字 / 口语省略（如「十二块八」「三百二」）识别基本准确。
- [ ] 拒绝麦克风权限时给出可理解提示；勾选「不再询问」时提示去系统设置开启。
- [ ] 连续多次录音-识别正常，无崩溃、无内存持续增长、无资源泄漏。
- [ ] 取消录音后不返回有效账单文本。
- [ ] release APK 体积增量 ≈ 模型 24 MB + sherpa so ≈ 5 MB（基线 25 MB，总约 54–57 MB，≤ 60 MB）。

## 五、已知风险与待办（探针阶段）

- **sherpa-onnx-android 版本敏感**：`SherpaAsrEngine.kt` 的 `createRecognizer()` 按 1.12.11 文档化 API 编写。
  若 Gradle 拉取的版本构造签名不同，**只需改这一个方法**，桥层其余代码不受影响。
- **未做流式中间结果显示**：本探针为「录音完再出结果」；完整项目可按 `SKILL.md` 做边录边出字（但本产品交互不要求）。
- **未做 Foreground Service / 超 30s 长录音**：探针录音较短；完整项目按 Android 12+ 要求补前台服务。
- **未做模型完整性 SHA256 校验与 `state.json`**：属 `SKILL.md` Phase 05，探针暂以「能加载即 ready」简化。
- **未接入 `transaction.*` 与 H5 解析器**：属后续阶段，本探针只验证 ASR 链路。

## 六、验证结论记录（由真机执行者填写）

| 项 | 结果 |
|---|---|
| 设备型号 |  |
| 断网识别是否成功 |  |
| 金额/中文数字准确率（主观） |  |
| release APK 体积 |  |
| 是否进入完整项目 |  |
