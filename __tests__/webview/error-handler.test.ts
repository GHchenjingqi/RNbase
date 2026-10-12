/**
 * Phase 2：WebView 错误分类单元测试（规范 §26）。
 */
import {
  classifyHttpError,
  classifyNativeError,
  getErrorSuggestion,
  getErrorTitle,
} from '../../src/webview/error-handler';

describe('classifyNativeError', () => {
  test('网络错误码 -> network', () => {
    const result = classifyNativeError({
      code: -1009,
      message: 'The Internet connection appears to be offline.',
      url: 'https://test.com',
    });
    expect(result.type).toBe('network');
    expect(result.code).toBe(-1009);
  });

  test('timeout 消息 -> timeout', () => {
    const result = classifyNativeError({
      code: -1001,
      message: 'The request timed out.',
    });
    expect(result.type).toBe('timeout');
  });

  test('net:: 错误 -> network', () => {
    const result = classifyNativeError({
      code: -2,
      message: 'net::ERR_INTERNET_DISCONNECTED',
    });
    expect(result.type).toBe('network');
  });

  test('render/crash 消息 -> render', () => {
    const result = classifyNativeError({
      code: 0,
      message: 'Render process crashed',
    });
    expect(result.type).toBe('render');
  });

  test('未知错误 -> unknown', () => {
    const result = classifyNativeError({
      code: 999,
      message: 'Something weird happened',
    });
    expect(result.type).toBe('unknown');
  });

  test('保留 url 和 message', () => {
    const result = classifyNativeError({
      code: -1004,
      message: "Can't connect to server",
      url: 'https://test.com/page',
    });
    expect(result.url).toBe('https://test.com/page');
    expect(result.message).toBe("Can't connect to server");
  });
});

describe('classifyHttpError', () => {
  test('404 -> http 类型', () => {
    const result = classifyHttpError({
      statusCode: 404,
      description: 'Not Found',
      url: 'https://test.com/missing',
    });
    expect(result.type).toBe('http');
    expect(result.httpStatus).toBe(404);
    expect(result.code).toBe(404);
  });

  test('500 -> http 类型', () => {
    const result = classifyHttpError({
      statusCode: 500,
      description: 'Internal Server Error',
    });
    expect(result.type).toBe('http');
    expect(result.httpStatus).toBe(500);
  });
});

describe('getErrorTitle', () => {
  test('network -> 网络连接失败', () => {
    expect(getErrorTitle({ type: 'network' })).toBe('网络连接失败');
  });

  test('http 带状态码 -> 包含状态码', () => {
    expect(getErrorTitle({ type: 'http', httpStatus: 500 })).toContain('500');
  });

  test('timeout -> 加载超时', () => {
    expect(getErrorTitle({ type: 'timeout' })).toBe('加载超时');
  });

  test('render -> 页面渲染异常', () => {
    expect(getErrorTitle({ type: 'render' })).toBe('页面渲染异常');
  });

  test('unknown -> 加载失败', () => {
    expect(getErrorTitle({ type: 'unknown' })).toBe('加载失败');
  });
});

describe('getErrorSuggestion', () => {
  test('network -> 检查网络', () => {
    expect(getErrorSuggestion({ type: 'network' })).toContain('网络');
  });

  test('500 -> 服务器暂时不可用', () => {
    expect(getErrorSuggestion({ type: 'http', httpStatus: 500 })).toContain('服务器');
  });

  test('404 -> 页面不存在', () => {
    expect(getErrorSuggestion({ type: 'http', httpStatus: 404 })).toContain('不存在');
  });

  test('timeout -> 网络较慢', () => {
    expect(getErrorSuggestion({ type: 'timeout' })).toContain('网络');
  });
});
