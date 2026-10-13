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
import { APP_VERSION } from '../config';

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

/**
 * 崩溃记录（结构化，便于上报与聚合）。
 * 仅含 message / stack(截断) / 上下文，不触碰业务参数（脱敏由 device-logger 负责）。
 */
export type CrashRecord = {
  ts: number;
  message: string;
  stack: string;
  context: string;
  fatal: boolean;
  os: string;
  appVersion: string;
};

/** 崩溃上报器（可注入：自研网关 / Sentry React Native 桥接 / 测试 Mock）。 */
export type CrashUploader = {
  upload: (records: CrashRecord[]) => Promise<{ ok: boolean }>;
};

/** 离线环形缓冲上限（避免内存堆积）。 */
const MAX_CRASH_BUFFER = 50;

let crashBuffer: CrashRecord[] = [];
let crashUploader: CrashUploader | null = null;

let installed = false;

/** 设置崩溃上报器（null 关闭上报，仅保留设备日志）。 */
export function setCrashUploader(uploader: CrashUploader | null): void {
  crashUploader = uploader;
}

/** 读取当前离线缓冲（测试 / 调试用）。 */
export function getCrashBuffer(): CrashRecord[] {
  return crashBuffer.slice();
}

/** 把一条崩溃记录入离线缓冲（超出上限丢弃最旧）。 */
export function recordCrash(record: CrashRecord): void {
  crashBuffer.push(record);
  if (crashBuffer.length > MAX_CRASH_BUFFER) {
    crashBuffer.shift();
  }
}

/** 把一次崩溃写入设备日志（受日志级别阈值控制，原生未接入时降级 console）。 */
export function reportCrash(error: Error, context: string, fatal = false): void {
  const stack = (error.stack ?? '').slice(0, 2000);
  const record: CrashRecord = {
    ts: Date.now(),
    message: error.message,
    stack,
    context,
    fatal,
    os: currentOs(),
    appVersion: APP_VERSION,
  };
  recordCrash(record);
  deviceLogger.error(
    `crash context=${context} fatal=${fatal} os=${record.os} appVersion=${record.appVersion} msg=${error.message} stack=${stack}`
  );
  // 上报闭环：有上报器则异步冲刷（best-effort，不阻塞主流程）
  if (crashUploader) {
    flushCrashReports().catch(() => undefined);
  }
}

/**
 * 冲刷离线缓冲到上报器。成功则清空；失败保留以便下次重试。
 * @returns 成功上报的条数。
 */
export async function flushCrashReports(): Promise<number> {
  if (!crashUploader || crashBuffer.length === 0) {
    return 0;
  }
  const batch = crashBuffer.slice();
  try {
    const res = await crashUploader.upload(batch);
    if (res.ok) {
      crashBuffer = [];
      return batch.length;
    }
  } catch {
    // 上报失败保留缓冲，下次重试
  }
  return 0;
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

/**
 * 基于 fetch 的 HTTP 崩溃上报器工厂（无第三方依赖，规避 Sentry SDK 体积）。
 *
 * 上报体：`{ crashes: CrashRecord[] }`（JSON）。
 * 适用于自研网关；若要接 Sentry React Native，可在外层包装其 `captureException`
 * 后再调用 setCrashUploader，此处保持基座零强依赖。
 *
 * @param endpoint 上报地址（建议走内网网关，避免明文外发敏感栈信息）
 * @param opts.timeoutMs 请求超时（默认 10s）
 */
export function createHttpCrashUploader(
  endpoint: string,
  opts?: { timeoutMs?: number }
): CrashUploader {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  return {
    async upload(records: CrashRecord[]) {
      const g = globalThis as unknown as {
        fetch?: (url: string, init: unknown) => Promise<{ ok: boolean }>;
        AbortController?: new () => { abort: () => void; signal: unknown };
        setTimeout?: (fn: () => void, ms: number) => unknown;
        clearTimeout?: (h: unknown) => void;
      };
      if (typeof g.fetch !== 'function') {
        return { ok: false };
      }
      const controller = g.AbortController ? new g.AbortController() : undefined;
      const timer =
        g.setTimeout && controller ? g.setTimeout(() => controller.abort(), timeoutMs) : undefined;
      try {
        const res = await g.fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ crashes: records }),
          signal: controller ? controller.signal : undefined,
        } as unknown as never);
        return { ok: res.ok };
      } catch {
        return { ok: false };
      } finally {
        if (timer && g.clearTimeout) {
          g.clearTimeout(timer);
        }
      }
    },
  };
}
