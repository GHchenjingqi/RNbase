/**
 * WebView <-> Bridge 消息处理（与组件解耦，便于单测，规则 25）。
 *
 * H5 通过 WebView.postMessage 发来 BridgeRequest（JSON 字符串），
 * 此处解析后交给 BridgeServer 处理，并把 BridgeResponse 回传。
 * 非 request 类型的消息（如 H5 生命周期事件）直接忽略。
 */
import type { BridgeServer } from '../bridge/bridge-server';
import type { BridgeRequest, BridgeResponse } from '../bridge/protocol';

export function createWebViewMessageHandler(server: BridgeServer) {
  return async (raw: string): Promise<string | null> => {
    let req: BridgeRequest;
    try {
      req = JSON.parse(raw) as BridgeRequest;
    } catch {
      return null;
    }
    if (!req || req.type !== 'request') {
      return null;
    }
    const res: BridgeResponse = await server.handle(req);
    return JSON.stringify(res);
  };
}
