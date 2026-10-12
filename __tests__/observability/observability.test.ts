/**
 * Phase 13：可观测性单元测试（规范 §27、§35）。
 */
import { createLogEntry, resetLogIdCounter } from '../../src/observability/log-entry';
import {
  redact,
  maskStringValue,
  isSensitiveKey,
  redactLogEntry,
} from '../../src/observability/redact';
import { LogManager, createConsoleSink } from '../../src/observability/log-manager';
import {
  createAllCollectors,
  BridgeLogCollector,
  UpdateLogCollector,
  WebViewLogCollector,
  H5ErrorCollector,
  AppLogCollector,
} from '../../src/observability/collectors';
import type { LogContext } from '../../src/observability/log-entry';

const testContext: LogContext = {
  appVersion: '1.0.0',
  bridgeVersion: '1.0.0',
  h5Version: '20260831001',
  platform: 'android',
  networkType: 'wifi',
};

describe('P13.1 统一日志模型', () => {
  beforeEach(() => resetLogIdCounter());

  test('createLogEntry 填充必填字段', () => {
    const entry = createLogEntry('bridge', 'info', 'test_event', testContext);
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.category).toBe('bridge');
    expect(entry.level).toBe('info');
    expect(entry.event).toBe('test_event');
    expect(entry.appVersion).toBe('1.0.0');
    expect(entry.bridgeVersion).toBe('1.0.0');
    expect(entry.h5Version).toBe('20260831001');
    expect(entry.platform).toBe('android');
    expect(entry.networkType).toBe('wifi');
  });

  test('createLogEntry 支持额外字段', () => {
    const entry = createLogEntry('bridge', 'error', 'test_error', testContext, {
      requestId: 'req_001',
      module: 'scanner',
      action: 'scan',
      errorCode: 'PERMISSION_DENIED',
      durationMs: 100,
    });
    expect(entry.requestId).toBe('req_001');
    expect(entry.module).toBe('scanner');
    expect(entry.action).toBe('scan');
    expect(entry.errorCode).toBe('PERMISSION_DENIED');
    expect(entry.durationMs).toBe(100);
  });

  test('日志 ID 递增', () => {
    const e1 = createLogEntry('app', 'info', 'e1', testContext);
    const e2 = createLogEntry('app', 'info', 'e2', testContext);
    expect(e1.id).not.toBe(e2.id);
  });
});

describe('P13.2 日志脱敏层', () => {
  test('敏感 key 的值被替换为 ***', () => {
    const result = redact({ access_token: 'secret123', name: 'test' });
    expect(result).toEqual({ access_token: '***', name: 'test' });
  });

  test('手机号自动掩码', () => {
    expect(maskStringValue('13812345678')).toBe('138****5678');
  });

  test('身份证号自动掩码', () => {
    expect(maskStringValue('110101199001011234')).toBe('110101********1234');
  });

  test('邮箱自动掩码', () => {
    expect(maskStringValue('test@example.com')).toBe('te***@example.com');
  });

  test('长令牌自动掩码', () => {
    expect(maskStringValue('this-is-a-very-long-token-value')).toBe('***');
  });

  test('URL 中的敏感 query 参数被掩码', () => {
    const url = 'https://example.com/api?token=secret123&name=test';
    const result = maskStringValue(url);
    expect(result).toContain('token=***');
    expect(result).toContain('name=test');
  });

  test('递归脱敏嵌套对象', () => {
    const result = redact({
      user: { name: 'test', password: 'secret' },
      tokens: { access_token: 'abc', refresh_token: 'def' },
    });
    expect(result).toEqual({
      user: { name: 'test', password: '***' },
      tokens: { access_token: '***', refresh_token: '***' },
    });
  });

  test('脱敏数组', () => {
    const result = redact([{ token: 'a' }, { token: 'b' }, 'normal']);
    expect(result).toEqual([{ token: '***' }, { token: '***' }, 'normal']);
  });

  test('isSensitiveKey 检测', () => {
    expect(isSensitiveKey('access_token')).toBe(true);
    expect(isSensitiveKey('Access_Token')).toBe(true);
    expect(isSensitiveKey('name')).toBe(false);
  });

  test('redactLogEntry 脱敏日志条目', () => {
    const entry = {
      event: 'test',
      data: { token: 'secret', name: 'test' },
      errorMessage: 'token=secret123 error',
    };
    const result = redactLogEntry(entry);
    expect(result.data).toEqual({ token: '***', name: 'test' });
  });
});

describe('P13.3 日志管理器', () => {
  let logManager: LogManager;

  beforeEach(() => {
    logManager = new LogManager({
      context: testContext,
      maxBufferSize: 100,
      batchSize: 5,
      flushIntervalMs: 10000, // 测试中不自动触发
      sink: undefined, // 不输出到控制台
    });
  });

  afterEach(() => {
    logManager.destroy();
  });

  test('记录日志并加入缓冲', () => {
    logManager.app('info', 'test_event');
    const buffer = logManager.getBuffer();
    expect(buffer).toHaveLength(1);
    expect(buffer[0].event).toBe('test_event');
    expect(buffer[0].category).toBe('app');
  });

  test('五类日志便捷方法', () => {
    logManager.app('info', 'app_event');
    logManager.bridge('info', 'bridge_event');
    logManager.h5Error('error', 'h5_error');
    logManager.update('info', 'update_event');
    logManager.webview('error', 'webview_error');
    const buffer = logManager.getBuffer();
    expect(buffer).toHaveLength(5);
    expect(buffer.map(e => e.category)).toEqual(['app', 'bridge', 'h5_error', 'update', 'webview']);
  });

  test('按分类过滤', () => {
    logManager.app('info', 'app1');
    logManager.bridge('info', 'bridge1');
    logManager.app('info', 'app2');
    const appLogs = logManager.getBuffer('app');
    expect(appLogs).toHaveLength(2);
  });

  test('级别过滤', () => {
    const manager = new LogManager({
      context: testContext,
      minLevel: 'warn',
      sink: undefined,
    });
    manager.app('debug', 'debug_event');
    manager.app('info', 'info_event');
    manager.app('warn', 'warn_event');
    manager.app('error', 'error_event');
    const buffer = manager.getBuffer();
    expect(buffer).toHaveLength(2);
    expect(buffer.map(e => e.level)).toEqual(['warn', 'error']);
    manager.destroy();
  });

  test('环形缓冲限制大小', () => {
    const manager = new LogManager({
      context: testContext,
      maxBufferSize: 3,
      sink: undefined,
    });
    for (let i = 0; i < 5; i++) {
      manager.app('info', `event_${i}`);
    }
    const buffer = manager.getBuffer();
    expect(buffer).toHaveLength(3);
    expect(buffer[0].event).toBe('event_2'); // 最旧的被移除
    manager.destroy();
  });

  test('getRecentErrors 返回错误和警告', () => {
    logManager.app('info', 'info1');
    logManager.app('warn', 'warn1');
    logManager.app('error', 'error1');
    const errors = logManager.getRecentErrors();
    expect(errors).toHaveLength(2);
    expect(errors[0].event).toBe('error1'); // 最新的在前
  });

  test('getUpdateHistory 返回更新日志', () => {
    logManager.app('info', 'app1');
    logManager.update('info', 'update1');
    logManager.update('error', 'update2');
    const history = logManager.getUpdateHistory();
    expect(history).toHaveLength(2);
  });

  test('getByRequestId 追踪全链路', () => {
    logManager.bridge('info', 'request', { requestId: 'req_001' });
    logManager.bridge('info', 'response', { requestId: 'req_001' });
    logManager.bridge('info', 'other', { requestId: 'req_002' });
    const trace = logManager.getByRequestId('req_001');
    expect(trace).toHaveLength(2);
  });

  test('日志自动脱敏', () => {
    logManager.app('info', 'test', {
      data: { token: 'secret', name: 'test' },
      errorMessage: 'token=secret123',
    });
    const buffer = logManager.getBuffer();
    expect(buffer[0].data).toEqual({ token: '***', name: 'test' });
  });

  test('批量上报触发', async () => {
    const reporter = jest.fn(async () => true);
    const manager = new LogManager({
      context: testContext,
      batchSize: 3,
      flushIntervalMs: 10000,
      reporter,
      sink: undefined,
    });
    for (let i = 0; i < 3; i++) {
      manager.app('info', `event_${i}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(reporter).toHaveBeenCalled();
    manager.destroy();
  });

  test('上报失败后重试', async () => {
    let callCount = 0;
    const reporter = jest.fn(async () => {
      callCount += 1;
      return callCount >= 2; // 第一次失败，第二次成功
    });
    const manager = new LogManager({
      context: testContext,
      batchSize: 2,
      flushIntervalMs: 10000,
      reporter,
      sink: undefined,
    });
    manager.app('info', 'e1');
    manager.app('info', 'e2');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(reporter).toHaveBeenCalledTimes(1);
    // 手动触发再次上报
    await manager.flush();
    expect(reporter).toHaveBeenCalledTimes(2);
    manager.destroy();
  });

  test('updateContext 更新上下文', () => {
    logManager.app('info', 'before');
    logManager.updateContext({ h5Version: '20260901001' });
    logManager.app('info', 'after');
    const buffer = logManager.getBuffer();
    expect(buffer[0].h5Version).toBe('20260831001');
    expect(buffer[1].h5Version).toBe('20260901001');
  });

  test('createConsoleSink 创建控制台输出', () => {
    const sink = createConsoleSink();
    expect(typeof sink).toBe('function');
  });
});

describe('P13.4 五类日志采集器', () => {
  let logManager: LogManager;
  let collectors: ReturnType<typeof createAllCollectors>;

  beforeEach(() => {
    logManager = new LogManager({ context: testContext, sink: undefined });
    collectors = createAllCollectors(logManager);
  });

  afterEach(() => {
    logManager.destroy();
  });

  test('BridgeLogCollector 记录请求/响应/错误', () => {
    collectors.bridge.onRequest('req_001', 'scanner', 'scan');
    collectors.bridge.onResponse('req_001', 'scanner', 'scan', 100);
    collectors.bridge.onError(
      'req_002',
      'camera',
      'takePhoto',
      'PERMISSION_DENIED',
      '权限被拒绝',
      50,
    );
    collectors.bridge.onEvent('network.changed', { type: 'wifi' });
    collectors.bridge.onTimeout('req_003', 'file', 'pick', 30000);

    const buffer = logManager.getBuffer('bridge');
    expect(buffer).toHaveLength(5);
    expect(buffer[0].event).toBe('bridge_request');
    expect(buffer[1].event).toBe('bridge_response');
    expect(buffer[2].event).toBe('bridge_error');
    expect(buffer[2].errorCode).toBe('PERMISSION_DENIED');
    expect(buffer[3].event).toBe('network.changed');
    expect(buffer[4].event).toBe('bridge_timeout');
  });

  test('UpdateLogCollector 记录状态机流转和结果', () => {
    collectors.update.onStateChange('IDLE', 'CHECKING', '1.0.1');
    collectors.update.onCheckResult(true, 'update_available', '1.0.1');
    collectors.update.onDownloadProgress('1.0.1', 50, 512, 1024);
    collectors.update.onDownloadComplete('1.0.1', 2000, 1024);
    collectors.update.onDownloadFailed('1.0.1', '网络错误');
    collectors.update.onVerifyResult('1.0.1', true);
    collectors.update.onInstallResult('1.0.1', true);
    collectors.update.onActivateResult('1.0.1', '1.0.0', true);
    collectors.update.onRollback('1.0.1', '1.0.0', 'js_crash', false);
    collectors.update.onReadyConfirmed('1.0.1', 5000);

    const buffer = logManager.getBuffer('update');
    expect(buffer.length).toBeGreaterThanOrEqual(9);
  });

  test('WebViewLogCollector 记录加载和错误', () => {
    collectors.webview.onLoadStart('https://example.com');
    collectors.webview.onLoadEnd('https://example.com', 1000);
    collectors.webview.onError('NET_ERROR', '网络错误', 'https://example.com');
    collectors.webview.onHttpError(500, '服务器错误', 'https://example.com/api');
    collectors.webview.onWhiteScreenDetected(3000);
    collectors.webview.onReadyTimeout(15000);

    const buffer = logManager.getBuffer('webview');
    expect(buffer).toHaveLength(6);
    expect(buffer[2].errorCode).toBe('NET_ERROR');
    expect(buffer[3].errorCode).toBe('HTTP_500');
    expect(buffer[4].errorCode).toBe('WHITE_SCREEN');
    expect(buffer[5].errorCode).toBe('H5_BOOT_TIMEOUT');
  });

  test('H5ErrorCollector 记录 H5 错误', () => {
    collectors.h5Error.onWindowError('TypeError: undefined is not a function', 'index.js', 10, 20);
    collectors.h5Error.onUnhandledRejection('Promise rejected');
    collectors.h5Error.onResourceLoadFailed('script', 'https://example.com/app.js');
    collectors.h5Error.onCustomError('BUSINESS_ERROR', '业务错误', {
      orderId: '123',
    });

    const buffer = logManager.getBuffer('h5_error');
    expect(buffer).toHaveLength(4);
    expect(buffer[0].errorCode).toBe('H5_RUNTIME_ERROR');
    expect(buffer[1].errorCode).toBe('H5_UNHANDLED_REJECTION');
  });

  test('AppLogCollector 记录 App 事件', () => {
    collectors.app.onAppLaunch(true);
    collectors.app.onBootStateChange('BOOT', 'RUNNING');
    collectors.app.onLifecycle('foreground');
    collectors.app.onNetworkChange('wifi', true);
    collectors.app.onCrash(new Error('test crash'), true);
    collectors.app.onPermissionResult('camera', true);

    const buffer = logManager.getBuffer('app');
    expect(buffer).toHaveLength(6);
    expect(buffer[0].event).toBe('app_cold_start');
    expect(buffer[4].errorCode).toBe('FATAL_CRASH');
  });

  test('createAllCollectors 创建全部五类采集器', () => {
    expect(collectors.bridge).toBeInstanceOf(BridgeLogCollector);
    expect(collectors.update).toBeInstanceOf(UpdateLogCollector);
    expect(collectors.webview).toBeInstanceOf(WebViewLogCollector);
    expect(collectors.h5Error).toBeInstanceOf(H5ErrorCollector);
    expect(collectors.app).toBeInstanceOf(AppLogCollector);
  });
});
