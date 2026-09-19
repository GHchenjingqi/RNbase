/**
 * Bridge 服务端（RN 侧），对应 Phase 3 / 规范 §10/§11/§14/§15/§17/§25/§62。
 *
 * 传输无关：接收已解析的 BridgeRequest，派发到已注册的 module/action handler，
 * 返回结构化 BridgeResponse。
 *
 * 新增能力（Phase 3 完整实现）：
 *  - timeout 控制：每个请求有超时，超时返回 TIMEOUT
 *  - origin 校验：非受信 origin 拒绝（SECURITY_BLOCKED）
 *  - method 白名单：未注册 method 返回 METHOD_NOT_FOUND
 *  - pending 管理：reload / 切后台时清理所有 pending
 *  - event 推送：集成 BridgeEventBus，支持 RN→H5 事件
 *  - version 检查：H5 请求带 version 时做兼容性判断
 */
import { BridgeException, createBridgeError } from './bridge-error';
import type {
  BridgeCallHandler,
  BridgeError as BridgeErrorType,
  BridgeModule,
  BridgeRequest,
  BridgeResponse,
} from './protocol';
import { RequestIdTracker, validateRequest } from './schema';
import { isCompatible } from './version';
import { BridgeEventBus, bridgeEventBus } from './event-bus';
import { BRIDGE_TIMEOUT_MS } from '../config';

export type BridgeHandler<P = unknown, D = unknown> = (
  params: P,
  request: BridgeRequest<P>,
) => Promise<D> | D;

export type BridgeEvent = {
  requestId: string;
  module: string;
  action: string;
  success: boolean;
  errorCode?: string;
  durationMs: number;
};

export type BridgeServerOptions = {
  /** 每次请求处理完成后的可观测钩子（规范 §27）。 */
  onEvent?: (event: BridgeEvent) => void;
  /** 每次 Bridge 调用后的观测钩子（含参数/结果/耗时/错误，供设备调用日志）。 */
  onCall?: BridgeCallHandler;
  /** 受信 origin 列表（规范 §25），为空则不校验 origin。 */
  trustedOrigins?: string[];
  /** 请求超时时间（毫秒），默认使用配置。 */
  timeoutMs?: number;
  /** 自定义事件总线，默认使用全局单例。 */
  eventBus?: BridgeEventBus;
};

type HandlerEntry = {
  module: BridgeModule;
  action: string;
  handler: BridgeHandler;
};

type PendingRequest = {
  id: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: BridgeResponse) => void;
};

function successResponse<D>(id: string, data: D): BridgeResponse<D> {
  return { type: 'response', id, success: true, data, error: null };
}

function errorResponse(id: string, error: BridgeErrorType): BridgeResponse {
  return { type: 'response', id, success: false, data: null, error };
}

export class BridgeServer {
  private readonly handlers = new Map<string, HandlerEntry>();
  private readonly onEvent?: (event: BridgeEvent) => void;
  private readonly onCall?: BridgeCallHandler;
  private readonly trustedOrigins: string[];
  private readonly timeoutMs: number;
  private readonly idTracker = new RequestIdTracker();
  private readonly pending = new Map<string, PendingRequest>();
  readonly eventBus: BridgeEventBus;

  constructor(options?: BridgeServerOptions) {
    this.onEvent = options?.onEvent;
    this.onCall = options?.onCall;
    this.trustedOrigins = options?.trustedOrigins ?? [];
    this.timeoutMs = options?.timeoutMs ?? BRIDGE_TIMEOUT_MS;
    this.eventBus = options?.eventBus ?? bridgeEventBus;
  }

  private static key(module: string, action: string): string {
    return `${module}.${action}`;
  }

  register(module: BridgeModule, action: string, handler: BridgeHandler): void {
    this.handlers.set(BridgeServer.key(module, action), {
      module,
      action,
      handler,
    });
  }

  registerModule(module: BridgeModule, handlers: Record<string, BridgeHandler>): void {
    for (const [action, handler] of Object.entries(handlers)) {
      this.register(module, action, handler);
    }
  }

  has(module: BridgeModule, action: string): boolean {
    return this.handlers.has(BridgeServer.key(module, action));
  }

  /** 获取所有已注册的 method 列表（用于 capability 检测）。 */
  listMethods(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 处理 BridgeRequest，返回 BridgeResponse。
   * 包含：schema 校验、origin 校验、version 检查、method 查找、timeout、异常处理。
   */
  async handle(req: BridgeRequest, origin?: string): Promise<BridgeResponse> {
    // 1. schema 校验
    const validation = validateRequest(req);
    if (validation) {
      return errorResponse(req.id ?? 'unknown', validation.error);
    }

    // 2. origin 校验（规范 §25）
    if (this.trustedOrigins.length > 0 && origin) {
      const isTrusted = this.trustedOrigins.some(t => origin.startsWith(t));
      if (!isTrusted) {
        return errorResponse(
          req.id,
          createBridgeError('SECURITY_BLOCKED', `untrusted origin: ${origin}`),
        );
      }
    }

    // 3. version 兼容性检查（规范 §17）
    if (req.version && !isCompatible(req.version)) {
      return errorResponse(
        req.id,
        createBridgeError('BRIDGE_VERSION_NOT_SUPPORTED', `required: ${req.version}`),
      );
    }

    // 4. 重复 requestId 检测
    if (!this.idTracker.register(req.id)) {
      return errorResponse(
        req.id,
        createBridgeError('INVALID_PARAMS', `duplicate requestId: ${req.id}`),
      );
    }

    const start = Date.now();
    const entry = this.handlers.get(BridgeServer.key(req.module, req.action));

    // 5. method 白名单检查
    if (!entry) {
      this.idTracker.complete(req.id);
      const res = errorResponse(
        req.id,
        createBridgeError('METHOD_NOT_FOUND', `${req.module}.${req.action}`),
      );
      this.emit(req, res, start, { params: req.params });
      return res;
    }

    // 6. 执行 handler（带 timeout）
    return new Promise<BridgeResponse>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        this.idTracker.complete(req.id);
        const res = errorResponse(
          req.id,
          createBridgeError('TIMEOUT', `${req.module}.${req.action}`),
        );
        this.emit(req, res, start, { params: req.params });
        resolve(res);
      }, this.timeoutMs);

      this.pending.set(req.id, { id: req.id, timer, resolve });

      Promise.resolve()
        .then(() => entry.handler(req.params, req))
        .then(data => {
          clearTimeout(timer);
          this.pending.delete(req.id);
          this.idTracker.complete(req.id);
          const res = successResponse(req.id, data);
          this.emit(req, res, start, { params: req.params, result: data });
          resolve(res);
        })
        .catch((e: unknown) => {
          clearTimeout(timer);
          this.pending.delete(req.id);
          this.idTracker.complete(req.id);
          const res =
            e instanceof BridgeException
              ? errorResponse(req.id, e.error)
              : errorResponse(req.id, createBridgeError('UNKNOWN_ERROR'));
          this.emit(req, res, start, { params: req.params });
          resolve(res);
        });
    });
  }

  /**
   * 推送事件到 H5（规范 §62）。
   * 事件会通过 eventBus 的全局监听器（WebView postMessage）推送到 H5。
   */
  emitEvent(event: string, data: unknown = null): void {
    this.eventBus.emit(event, data);
  }

  /**
   * 清理所有 pending 请求（H5 reload / 切后台 / WebView 销毁时调用）。
   * 所有 pending 请求会被 resolve 为 BRIDGE_NOT_READY 错误。
   */
  clearPending(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      const res = errorResponse(id, createBridgeError('BRIDGE_NOT_READY', 'bridge cleared'));
      pending.resolve(res);
    }
    this.pending.clear();
    this.idTracker.clear();
    this.eventBus.clear();
  }

  /** 当前 pending 请求数量（用于测试/诊断）。 */
  pendingCount(): number {
    return this.pending.size;
  }

  private emit(
    req: BridgeRequest,
    res: BridgeResponse,
    start: number,
    call?: { params?: unknown; result?: unknown },
  ): void {
    this.onEvent?.({
      requestId: req.id,
      module: req.module,
      action: req.action,
      success: res.success,
      errorCode: res.error?.code,
      durationMs: Date.now() - start,
    });
    this.onCall?.({
      requestId: req.id,
      module: req.module,
      action: req.action,
      success: res.success,
      params: call?.params,
      result: res.success ? call?.result : undefined,
      error: res.error,
      durationMs: Date.now() - start,
    });
  }
}
