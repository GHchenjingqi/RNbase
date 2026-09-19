/**
 * Phase 3：Bridge schema 校验与 id 生成单元测试（规范 §11/§14）。
 */
import {
  generateRequestId,
  parseRequest,
  RequestIdTracker,
  validateRequest,
  validateResponse,
} from '../../src/bridge/schema';

describe('generateRequestId', () => {
  test('生成唯一 id', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
    expect(id1.startsWith('req_')).toBe(true);
  });
});

describe('validateRequest', () => {
  test('合法 request 通过', () => {
    const result = validateRequest({
      type: 'request',
      id: 'req_1',
      module: 'app',
      action: 'getInfo',
      version: '1.0.0',
      params: {},
    });
    expect(result).toBeNull();
  });

  test('非对象返回错误', () => {
    expect(validateRequest(null)).not.toBeNull();
    expect(validateRequest('string')).not.toBeNull();
    expect(validateRequest(123)).not.toBeNull();
  });

  test('type 错误返回错误', () => {
    const result = validateRequest({
      type: 'response',
      id: '1',
      module: 'app',
      action: 'x',
    });
    expect(result?.error.code).toBe('INVALID_PARAMS');
  });

  test('缺少 id 返回错误', () => {
    const result = validateRequest({
      type: 'request',
      module: 'app',
      action: 'x',
    });
    expect(result?.error.code).toBe('INVALID_PARAMS');
  });

  test('缺少 module 返回错误', () => {
    const result = validateRequest({ type: 'request', id: '1', action: 'x' });
    expect(result?.error.code).toBe('INVALID_PARAMS');
  });

  test('缺少 action 返回错误', () => {
    const result = validateRequest({ type: 'request', id: '1', module: 'app' });
    expect(result?.error.code).toBe('INVALID_PARAMS');
  });

  test('version 非字符串返回错误', () => {
    const result = validateRequest({
      type: 'request',
      id: '1',
      module: 'app',
      action: 'x',
      version: 123,
    });
    expect(result?.error.code).toBe('INVALID_PARAMS');
  });
});

describe('validateResponse', () => {
  test('合法 response 通过', () => {
    const result = validateResponse({
      type: 'response',
      id: 'req_1',
      success: true,
      data: { ok: true },
      error: null,
    });
    expect(result).toBeNull();
  });

  test('缺少 success 返回错误', () => {
    const result = validateResponse({
      type: 'response',
      id: '1',
      data: null,
      error: null,
    });
    expect(result?.error.code).toBe('INVALID_PARAMS');
  });
});

describe('parseRequest', () => {
  test('合法 JSON 解析成功', () => {
    const raw = JSON.stringify({
      type: 'request',
      id: '1',
      module: 'app',
      action: 'getInfo',
    });
    const req = parseRequest(raw);
    expect(req.module).toBe('app');
    expect(req.action).toBe('getInfo');
  });

  test('非法 JSON 抛出错误', () => {
    expect(() => parseRequest('invalid json')).toThrow();
  });
});

describe('RequestIdTracker', () => {
  test('注册新 id 返回 true', () => {
    const tracker = new RequestIdTracker();
    expect(tracker.register('req_1')).toBe(true);
    expect(tracker.size()).toBe(1);
  });

  test('重复 id 返回 false', () => {
    const tracker = new RequestIdTracker();
    tracker.register('req_1');
    expect(tracker.register('req_1')).toBe(false);
  });

  test('complete 后 id 仍被记录，不可重新注册（防重放）', () => {
    const tracker = new RequestIdTracker();
    tracker.register('req_1');
    tracker.complete('req_1');
    expect(tracker.size()).toBe(0);
    expect(tracker.register('req_1')).toBe(false);
  });

  test('clear 返回所有 id 并清空', () => {
    const tracker = new RequestIdTracker();
    tracker.register('req_1');
    tracker.register('req_2');
    const ids = tracker.clear();
    expect(ids).toContain('req_1');
    expect(ids).toContain('req_2');
    expect(tracker.size()).toBe(0);
  });
});
