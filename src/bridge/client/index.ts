/**
 * H5 侧 Bridge 客户端聚合入口。
 *
 * 提供：BridgeClient、两类 transport、以及 Native 门面工厂。
 * 浏览器开发默认走 Mock（规则 42），RN WebView 内走真实桥接（规则 43）。
 */
import { BridgeClient } from './bridge-client';
import { createNative } from './Native';
import { createRnWebViewTransport, isInRnWebView } from './adapters/rn-web-view-transport';
import { createBrowserMockTransport } from './adapters/mock-transport';
import type { NativeFacade } from './types';

export { BridgeClient } from './bridge-client';
export type { BridgeClientOptions } from './bridge-client';
export type { BridgeTransport, NativeFacade } from './types';
export { createRnWebViewTransport, isInRnWebView } from './adapters/rn-web-view-transport';
export { createMockTransport, createBrowserMockTransport } from './adapters/mock-transport';

/** 依据运行环境选择 transport 创建默认可用实例（浏览器=Mock，WebView=真实）。 */
export function createDefaultNative(): NativeFacade {
  const transport = isInRnWebView() ? createRnWebViewTransport() : createBrowserMockTransport();
  return createNative(new BridgeClient(transport));
}

export { createNative } from './Native';
