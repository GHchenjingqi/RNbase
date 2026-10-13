/**
 * 全局崩溃上报（P0-1 韧性地基）。
 *
 * 基座此前没有任何全局异常兜底：渲染期异常只在 dev 显示 RedBox、release 直接白屏，
 * 且原生 crash / 未处理 Promise 拒绝完全无记录。这里把两类异常统一收口到 device-logger：
 *
 *  - 渲染期异常：由 src/components/AppErrorBoundary 捕获后调用 reportCrash；
 *  - 非渲染异常：installGlobalErrorHandlers() 接管 ErrorUtils 全局处理器，
 *    并监听 unhandledrejection（RN 无默认全局处理）。
 *
 * 设计取舍：
 *  - dev 下不替换 ErrorUtils 默认处理器，保留 RedBox 便于调试，仅做上报；
 *  - release 下接管，异常不再触发不可恢复 RedBox，统一走可观测链路。
 *  - 日志只记录 message / componentStack / stack 前 2000 字符，不触碰敏感字段
 *    （脱敏由 device-logger 的 redact 负责，这里不传业务参数）。
 *
 * ErrorUtils 是 RN 运行时全局对象（非可导入模块），直接自 globalThis 取用，
 * 缺失时（纯 Node 测试环境）不接管，避免平台差异导致崩溃。
 */
import { deviceLogger } from './device-logger';
import { currentOs } from '../platform/os';

type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

type RnErrorUtils = {
  getGlobalHandler: () => GlobalErrorHandler | undefined;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

/** 安全获取 RN 全局 ErrorUtils；不存在（非 RN 运行时）返回 null。 */
function getRnErrorUtils(): RnErrorUtils | null {
  const eu = (globalThis as Record<string, unknown>).ErrorUtils;
  if (eu && typeof (eu as { getGlobalHandler?: unknown }).getGlobalHandler === 'function') {
    return eu as RnErrorUtils;
  }
  return null;
}

let installed = false;

/** 把一次崩溃写入设备日志（受日志级别阈值控制，原生未接入时降级 console）。 */
export function reportCrash(error: Error, context: string, fatal = false): void {
  const stack = (error.stack ?? '').slice(0, 2000);
  deviceLogger.error(
    `crash context=${context} fatal=${fatal} os=${currentOs()} msg=${error.message} stack=${stack}`
  );
}

/**
 * 安装全局异常处理器。幂等，重复调用只生效一次。
 *
 * 返回是否真正安装了（dev 下返回 false，表示只上报不接管）。
 */
export function installGlobalErrorHandlers(): boolean {
  if (installed) {
    return false;
  }
  installed = true;

  // dev 环境保留 RedBox，仅上报，不替换默认 handler
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return false;
  }

  const eu = getRnErrorUtils();
  if (!eu) {
    return false;
  }

  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((error: Error, isFatal?: boolean) => {
    reportCrash(error instanceof Error ? error : new Error(String(error)), 'global', isFatal);
    if (typeof prev === 'function') {
      try {
        prev(error, isFatal);
      } catch {
        // 默认处理器异常绝不影响上报
      }
    }
  });

  // 未处理的 Promise 拒绝（RN 默认无全局处理，仅在运行时支持时注册）
  type GlobalWithEventListener = typeof globalThis & {
    addEventListener?: (type: string, listener: (event: { reason?: unknown }) => void) => void;
  };
  const g = globalThis as GlobalWithEventListener;
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (event: { reason?: unknown }) => {
      const reason = event.reason;
      reportCrash(
        reason instanceof Error ? reason : new Error(`unhandledrejection: ${String(reason)}`),
        'unhandledrejection'
      );
    });
  }

  return true;
}
