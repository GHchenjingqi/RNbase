/**
 * 设备调用日志单测：
 *  - deviceLogger 级别过滤（默认 info / 仅 error）
 *  - formatCallLine 脱敏与字段完整性
 *  - levelForCall 级别推断
 *  - BridgeServer.onCall 钩子（成功 / 错误 / 方法不存在）
 */
import { BridgeServer } from '../../src/bridge/bridge-server';
import {
  createDeviceLogger,
  formatCallLine,
  levelForCall,
} from '../../src/diagnostics/device-logger';
import type { BridgeCallInfo } from '../../src/diagnostics/device-logger';
import type { BridgeRequest } from '../../src/bridge/protocol';

function req(module: string, action: string, params?: unknown): BridgeRequest {
  return {
    type: 'request',
    id: `log_${module}_${action}`,
    version: '1.0.0',
    module: module as BridgeRequest['module'],
    action,
    params,
  };
}

describe('deviceLogger 级别过滤', () => {
  test('默认级别 info：info/success/warn/error 记录，debug 忽略', () => {
    const lines: Array<[string, string]> = [];
    const logger = createDeviceLogger('info', (level, line) => lines.push([level, line]));

    logger.debug('d');
    logger.info('i');
    logger.success('s');
    logger.warn('w');
    logger.error('e');

    expect(lines.map(([l]) => l)).toEqual(['info', 'success', 'warn', 'error']);
  });

  test('setLevel(error) 后仅记录 error', () => {
    const lines: Array<[string, string]> = [];
    const logger = createDeviceLogger('info', (level, line) => lines.push([level, line]));
    logger.setLevel('error');

    logger.info('i');
    logger.warn('w');
    logger.success('s');
    logger.error('e');

    expect(lines.map(([l]) => l)).toEqual(['error']);
    expect(logger.getLevel()).toBe('error');
  });

  test('isEnabled 按阈值判断', () => {
    const logger = createDeviceLogger('info');
    expect(logger.isEnabled('info')).toBe(true);
    expect(logger.isEnabled('success')).toBe(true);
    expect(logger.isEnabled('warn')).toBe(true);
    expect(logger.isEnabled('error')).toBe(true);
    expect(logger.isEnabled('debug')).toBe(false);
  });
});

describe('formatCallLine / levelForCall', () => {
  test('成功调用：success 级别，含参数与结果', () => {
    const info: BridgeCallInfo = {
      requestId: 'req_1',
      module: 'network',
      action: 'getStatus',
      success: true,
      params: undefined,
      result: { connected: true, type: 'wifi' },
      durationMs: 5,
    };
    expect(levelForCall(info)).toBe('success');
    const line = formatCallLine(info);
    expect(line).toContain('req_1 network.getStatus');
    expect(line).toContain('"connected":true');
    expect(line).toContain('durationMs=5');
  });

  test('失败调用：error 级别，含错误码', () => {
    const info: BridgeCallInfo = {
      requestId: 'req_2',
      module: 'camera',
      action: 'takePhoto',
      success: false,
      params: {},
      error: { code: 'DEVICE_UNSUPPORTED', message: 'camera 能力未接入' },
      durationMs: 1,
    };
    expect(levelForCall(info)).toBe('error');
    const line = formatCallLine(info);
    expect(line).toContain('DEVICE_UNSUPPORTED');
  });

  test('方法不存在：warn 级别', () => {
    const info: BridgeCallInfo = {
      requestId: 'req_3',
      module: 'media',
      action: 'previewImage',
      success: false,
      error: { code: 'METHOD_NOT_FOUND', message: 'media.previewImage' },
      durationMs: 1,
    };
    expect(levelForCall(info)).toBe('warn');
  });

  test('参数脱敏：token/手机号被掩码', () => {
    const info: BridgeCallInfo = {
      requestId: 'req_4',
      module: 'auth',
      action: 'getToken',
      success: true,
      params: { token: 'abcdefghij12345678', phone: '13812345678' },
      result: { token: 'abcdefghij12345678' },
      durationMs: 2,
    };
    const line = formatCallLine(info);
    expect(line).not.toContain('abcdefghij12345678');
    expect(line).not.toContain('13812345678');
    expect(line).toContain('***');
  });
});

describe('BridgeServer.onCall 钩子', () => {
  test('成功调用触发 onCall（含参数/结果/耗时）', async () => {
    const onCall = jest.fn();
    const server = new BridgeServer({ onCall });
    server.register('test', 'echo', params => ({ echoed: params }));
    await server.handle(req('test', 'echo', { hello: 'world' }));
    expect(onCall).toHaveBeenCalledTimes(1);
    const info = onCall.mock.calls[0][0] as BridgeCallInfo;
    expect(info.success).toBe(true);
    expect(info.module).toBe('test');
    expect(info.action).toBe('echo');
    expect(info.params).toEqual({ hello: 'world' });
    expect(info.result).toEqual({ echoed: { hello: 'world' } });
    expect(typeof info.durationMs).toBe('number');
  });

  test('失败调用触发 onCall（含错误码）', async () => {
    const onCall = jest.fn();
    const server = new BridgeServer({ onCall });
    server.register('test', 'fail', () => {
      throw new Error('boom');
    });
    await server.handle(req('test', 'fail'));
    const info = onCall.mock.calls[0][0] as BridgeCallInfo;
    expect(info.success).toBe(false);
    expect(info.error?.code).toBe('UNKNOWN_ERROR');
  });

  test('未注册方法触发 onCall（METHOD_NOT_FOUND，warn 级）', async () => {
    const onCall = jest.fn();
    const server = new BridgeServer({ onCall });
    await server.handle(req('ghost', 'nope'));
    const info = onCall.mock.calls[0][0] as BridgeCallInfo;
    expect(info.success).toBe(false);
    expect(info.error?.code).toBe('METHOD_NOT_FOUND');
  });

  test('未配置 onCall 时不影响正常调用', async () => {
    const server = new BridgeServer();
    server.register('test', 'echo', () => 'ok');
    const res = await server.handle(req('test', 'echo'));
    expect(res.success).toBe(true);
  });
});
