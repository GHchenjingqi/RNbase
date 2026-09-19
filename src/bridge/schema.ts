/**
 * Bridge 协议 schema 校验与消息序列化（对应 Phase 3 / 规范 §11/§14/§25）。
 *
 * 负责：
 *  - requestId 生成（保证唯一性）
 *  - request/response/event 消息的 schema 校验
 *  - JSON 序列化/反序列化（带错误处理）
 *  - 重复 requestId 检测
 */
import type { BridgeEvent, BridgeRequest, BridgeResponse } from './protocol';
import { createBridgeError } from './bridge-error';

let idCounter = 0;

/**
 * 生成唯一 requestId。
 * 格式：req_<timestamp>_<counter>
 */
export function generateRequestId(): string {
  idCounter += 1;
  return `req_${Date.now()}_${idCounter}`;
}

/**
 * 校验 BridgeRequest 的 schema。
 * 返回 null 表示校验通过，返回 BridgeError 表示校验失败。
 */
export function validateRequest(
  data: unknown,
): { error: ReturnType<typeof createBridgeError> } | null {
  if (!data || typeof data !== 'object') {
    return {
      error: createBridgeError('INVALID_PARAMS', 'request must be an object'),
    };
  }

  const req = data as Record<string, unknown>;

  if (req.type !== 'request') {
    return {
      error: createBridgeError('INVALID_PARAMS', `invalid type: ${String(req.type)}`),
    };
  }

  if (typeof req.id !== 'string' || req.id.length === 0) {
    return {
      error: createBridgeError('INVALID_PARAMS', 'id must be a non-empty string'),
    };
  }

  if (typeof req.module !== 'string' || req.module.length === 0) {
    return {
      error: createBridgeError('INVALID_PARAMS', 'module must be a non-empty string'),
    };
  }

  if (typeof req.action !== 'string' || req.action.length === 0) {
    return {
      error: createBridgeError('INVALID_PARAMS', 'action must be a non-empty string'),
    };
  }

  // version 可选，但如果存在必须是字符串
  if (req.version !== undefined && typeof req.version !== 'string') {
    return {
      error: createBridgeError('INVALID_PARAMS', 'version must be a string'),
    };
  }

  return null;
}

/**
 * 校验 BridgeResponse 的 schema。
 */
export function validateResponse(
  data: unknown,
): { error: ReturnType<typeof createBridgeError> } | null {
  if (!data || typeof data !== 'object') {
    return {
      error: createBridgeError('INVALID_PARAMS', 'response must be an object'),
    };
  }

  const res = data as Record<string, unknown>;

  if (res.type !== 'response') {
    return {
      error: createBridgeError('INVALID_PARAMS', `invalid type: ${String(res.type)}`),
    };
  }

  if (typeof res.id !== 'string') {
    return {
      error: createBridgeError('INVALID_PARAMS', 'id must be a string'),
    };
  }

  if (typeof res.success !== 'boolean') {
    return {
      error: createBridgeError('INVALID_PARAMS', 'success must be a boolean'),
    };
  }

  return null;
}

/**
 * 安全解析 JSON 字符串为 BridgeRequest。
 * 失败时抛出 BridgeException 风格的错误（由调用方捕获）。
 */
export function parseRequest(raw: string): BridgeRequest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw createBridgeError('INVALID_PARAMS', 'invalid JSON');
  }

  const validation = validateRequest(data);
  if (validation) {
    throw validation.error;
  }

  return data as BridgeRequest;
}

/**
 * 安全解析 JSON 字符串为 BridgeResponse。
 */
export function parseResponse(raw: string): BridgeResponse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw createBridgeError('INVALID_PARAMS', 'invalid JSON');
  }

  const validation = validateResponse(data);
  if (validation) {
    throw validation.error;
  }

  return data as BridgeResponse;
}

/**
 * 序列化 BridgeResponse / BridgeEvent 为 JSON 字符串。
 */
export function serializeMessage(message: BridgeResponse | BridgeEvent): string {
  return JSON.stringify(message);
}

/**
 * 重复 requestId 检测器。
 * 用于 BridgeServer 检测重复请求（规范 §14）。
 * id 一旦使用过即永久记录，防止同一个 id 被重复使用。
 */
export class RequestIdTracker {
  private readonly used = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly maxSize = 100000;

  /** 注册一个 requestId，返回 false 表示已存在（重复）。 */
  register(id: string): boolean {
    if (this.used.has(id)) return false;
    // 防止内存泄漏
    if (this.used.size >= this.maxSize) {
      this.used.clear();
      this.pending.clear();
    }
    this.used.add(id);
    this.pending.add(id);
    return true;
  }

  /** 完成一个请求（从 pending 中移除，但保留在 used 中）。 */
  complete(id: string): void {
    this.pending.delete(id);
  }

  /** 清理所有 pending 请求（reload / 切后台时调用）。used 保留以防止重放。 */
  clear(): string[] {
    const ids = Array.from(this.pending);
    this.pending.clear();
    return ids;
  }

  /** 当前 pending 请求数量。 */
  size(): number {
    return this.pending.size;
  }

  /** 已使用的 id 总数（用于诊断）。 */
  usedCount(): number {
    return this.used.size;
  }
}
