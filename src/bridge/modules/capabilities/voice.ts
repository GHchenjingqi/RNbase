/**
 * voice 桥接模块：离线语音识别（ASR）。
 *
 * 全部走原生 BaseCapabilities 的 voice* 方法（sherpa-onnx），不调用任何云端 ASR。
 * 方法集（可行性探针阶段）：getStatus / prepareModel / startRecording /
 * stopAndRecognize / cancelRecording。transaction.*（账单持久化）不在本探针范围。
 */
import type { BridgeServer } from '../../bridge-server';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerVoiceModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('voice', {
    /** 查询模型状态：{ state, modelId, version, ready }。不触发网络请求。 */
    async getStatus() {
      const adapter = requireAdapter(adapters.voice, 'voice');
      return adapter.getStatus();
    },

    /** 校验内置模型完整性并初始化引擎（幂等）。 */
    async prepareModel() {
      const adapter = requireAdapter(adapters.voice, 'voice');
      return adapter.prepareModel();
    },

    /** 开始录音（16kHz/单声道/PCM16）。 */
    async startRecording(params) {
      const p = params as { sessionId?: string } | undefined;
      const adapter = requireAdapter(adapters.voice, 'voice');
      return adapter.startRecording(p?.sessionId);
    },

    /** 停止录音并执行本地识别，返回 { text, durationMs, modelVersion }。 */
    async stopAndRecognize(params) {
      const p = params as { sessionId?: string } | undefined;
      const adapter = requireAdapter(adapters.voice, 'voice');
      return adapter.stopAndRecognize(p?.sessionId);
    },

    /** 取消录音：丢弃音频，不解析、不入账，返回 { cancelled }。 */
    async cancelRecording(params) {
      const p = params as { sessionId?: string } | undefined;
      const adapter = requireAdapter(adapters.voice, 'voice');
      return adapter.cancelRecording(p?.sessionId);
    },
  });
}
