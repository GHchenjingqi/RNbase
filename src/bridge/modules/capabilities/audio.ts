/**
 * audio 桥接模块：音频录制与播放。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerAudioModule(server: BridgeServer, adapters: CapabilityAdapters): void {
  server.registerModule('audio', {
    async startRecording(params) {
      const p = params as
        | {
            format?: 'aac' | 'mp3' | 'wav';
            quality?: 'high' | 'low';
            maxDuration?: number;
          }
        | undefined;
      const adapter = requireAdapter(adapters.audio, 'audio');
      return adapter.startRecording({
        format: p?.format,
        quality: p?.quality,
        maxDuration: p?.maxDuration,
      });
    },

    async stopRecording() {
      const adapter = requireAdapter(adapters.audio, 'audio');
      return adapter.stopRecording();
    },

    async play(params) {
      const p = params as { uri: string; loop?: boolean; volume?: number } | undefined;
      if (!p?.uri) {
        throw new BridgeException('INVALID_PARAMS', 'uri 不能为空');
      }
      const adapter = requireAdapter(adapters.audio, 'audio');
      return adapter.play(p.uri, { loop: p.loop, volume: p.volume });
    },

    async pause() {
      const adapter = requireAdapter(adapters.audio, 'audio');
      if (!adapter.pause) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'audio.pause 未实现');
      }
      return adapter.pause();
    },

    async stop() {
      const adapter = requireAdapter(adapters.audio, 'audio');
      if (!adapter.stop) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'audio.stop 未实现');
      }
      return adapter.stop();
    },
  });
}
