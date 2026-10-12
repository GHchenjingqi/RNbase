/**
 * speech 桥接模块：语音合成（TTS）。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerSpeechModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('speech', {
    async speak(params) {
      const p = params as
        | {
            text: string;
            language?: string;
            rate?: number;
            pitch?: number;
            volume?: number;
          }
        | undefined;
      if (!p?.text) {
        throw new BridgeException('INVALID_PARAMS', 'text 不能为空');
      }
      const adapter = requireAdapter(adapters.speech, 'speech');
      return adapter.speak(p.text, {
        language: p.language,
        rate: p.rate,
        pitch: p.pitch,
        volume: p.volume,
      });
    },

    async stop() {
      const adapter = requireAdapter(adapters.speech, 'speech');
      if (!adapter.stop) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'speech.stop 未实现');
      }
      return adapter.stop();
    },

    async isSpeaking() {
      const adapter = requireAdapter(adapters.speech, 'speech');
      if (!adapter.isSpeaking) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'speech.isSpeaking 未实现');
      }
      return adapter.isSpeaking();
    },

    async getAvailableLanguages() {
      const adapter = requireAdapter(adapters.speech, 'speech');
      if (!adapter.getAvailableLanguages) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'getAvailableLanguages 未实现');
      }
      return adapter.getAvailableLanguages();
    },
  });
}
