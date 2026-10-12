/**
 * background-task 桥接模块：后台任务管理。
 */
import type { BridgeServer } from '../../bridge-server';
import { BridgeException } from '../../bridge-error';
import { CapabilityAdapters, requireAdapter } from './types';

export function registerBackgroundTaskModule(
  server: BridgeServer,
  adapters: CapabilityAdapters,
): void {
  server.registerModule('backgroundTask', {
    async start(params) {
      const p = params as { taskKey: string; timeout?: number } | undefined;
      if (!p?.taskKey) {
        throw new BridgeException('INVALID_PARAMS', 'taskKey 不能为空');
      }
      const adapter = requireAdapter(adapters.backgroundTask, 'backgroundTask');
      return adapter.start(p.taskKey, { timeout: p.timeout });
    },

    async stop(params) {
      const p = params as { taskId?: number } | undefined;
      if (typeof p?.taskId !== 'number') {
        throw new BridgeException('INVALID_PARAMS', 'taskId 不能为空');
      }
      const adapter = requireAdapter(adapters.backgroundTask, 'backgroundTask');
      await adapter.stop(p.taskId);
      return { ok: true };
    },

    async isRunning(params) {
      const p = params as { taskKey?: string } | undefined;
      if (!p?.taskKey) {
        throw new BridgeException('INVALID_PARAMS', 'taskKey 不能为空');
      }
      const adapter = requireAdapter(adapters.backgroundTask, 'backgroundTask');
      if (!adapter.isRunning) {
        throw new BridgeException('DEVICE_UNSUPPORTED', 'isRunning 未实现');
      }
      return adapter.isRunning(p.taskKey);
    },
  });
}
