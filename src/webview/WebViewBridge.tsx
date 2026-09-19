/**
 * WebView 容器组件（对应 Phase 2 / 规范 §4/§24/§26）：承载 H5 业务运行时，
 * 集成加载状态、导航白名单拦截、结构化错误处理与兜底页。
 *
 *  - onMessage：H5 发来的 Bridge 请求 -> BridgeServer -> 回传响应
 *  - onShouldStartLoadWithRequest：域名白名单拦截（规范 §24）
 *  - onError / onHttpError：结构化错误分类（规范 §26）
 *  - loading / error page：加载中与失败兜底展示
 *
 * 对应规范 §4/§24/§26/§31/§51。
 */
import React, { useEffect, useMemo } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setStatusBarInset } from '../bridge/modules/system';
import { setWebViewHandle } from '../bridge/modules/webview-control';
import { createAppBridgeServer } from '../app/compose-bridge-server';
import { deviceLogger, logDeviceCall } from '../diagnostics/device-logger';
import { BRIDGE_EVENTS } from '../bridge/protocol';
import type { CapabilityAdapters } from '../bridge/modules/capabilities/types';
import type { LifecycleHandlers } from '../bridge/modules/app';
import { createWebViewMessageHandler } from './webview-message-handler';
import { useWebViewController } from './web-view-controller';
import { decideNavigation } from './navigation';
import { classifyHttpError, classifyNativeError } from './error-handler';
import { WebViewLoading } from './WebViewLoading';
import { WebViewErrorPage } from './WebViewErrorPage';
import { DOMAIN_WHITELIST } from '../config';
import type { WebViewSource } from './types';

/**
 * Dev 模式 CORS 绕过注入：拦截 fetch / XMLHttpRequest，移除后端未放行的自定义 header
 * （如 repeatsubmit），避免开发环境下 WebView 跨域预检失败导致白屏。
 * Release 模式下 __DEV__ 为 false，注入为空字符串，完全不影响真机包。
 */
const devCorsBypassInjection = __DEV__
  ? `(function(){
    try {
      var BLOCKED_HEADERS = ['repeatsubmit'];
      function isBlocked(name) {
        return BLOCKED_HEADERS.indexOf(String(name).toLowerCase()) !== -1;
      }
      // 拦截 fetch
      var _fetch = window.fetch;
      if (_fetch) {
        window.fetch = function(input, init) {
          if (init && init.headers) {
            if (init.headers instanceof Headers) {
              BLOCKED_HEADERS.forEach(function(h){ init.headers.delete(h); });
            } else if (Array.isArray(init.headers)) {
              init.headers = init.headers.filter(function(p){ return !isBlocked(p[0]); });
            } else if (typeof init.headers === 'object') {
              Object.keys(init.headers).forEach(function(k){
                if (isBlocked(k)) delete init.headers[k];
              });
            }
          }
          return _fetch.apply(this, arguments);
        };
      }
      // 拦截 XMLHttpRequest
      var _xhrOpen = XMLHttpRequest.prototype.open;
      var _xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (isBlocked(name)) return;
        return _xhrSetHeader.apply(this, arguments);
      };
    } catch(e) {}
  })();`
  : '';

/**
 * 平台信息同步注入（H5 加载前写入 window.RN_PLATFORM）。
 * 取值来自 RN Platform.OS（原生确定值），H5 可直接同步读取，
 * 避免通过 UA 判断平台不准确的问题。
 */
const platformInjection = `(function(){
  try { window.RN_PLATFORM = ${JSON.stringify(Platform.OS)}; } catch(e) {}
})();`;

/**
 * 注：导航栏固定（.nut-navbar fixed + 等高占位）逻辑已迁移到
 * scripts/fix-h5-safearea.js 构建期注入 H5 index.html——
 * 本注入字符串在部分 RN/WebView 版本会被截断（实测约 2KB），
 * 无法可靠承载过长的 navFixedInjection。
 */
type WebViewBridgeProps = {
  /** WebView 加载源（H5 页面）。 */
  source: WebViewSource;
  /** 原生能力 adapter 注入（规范 §13/§51）。 */
  capabilities?: CapabilityAdapters;
  /** H5 生命周期回调（规范 §9：READY 握手）。 */
  lifecycle?: LifecycleHandlers;
  /** 信任域名白名单（默认使用 config 中的 DOMAIN_WHITELIST）。 */
  trustedOrigins?: string[];
  /** 加载中提示文案。 */
  loadingMessage?: string;
  /** 错误兜底页的「使用上一版本」回调（Phase 8 接入）。 */
  onRollback?: () => void;
  /** 是否有可回滚的历史版本。 */
  canRollback?: boolean;
  onLoadStart?: () => void;
  onLoadEnd?: () => void;
  onError?: (error: unknown) => void;
};

export function WebViewBridge({
  source,
  capabilities,
  lifecycle,
  trustedOrigins = DOMAIN_WHITELIST,
  loadingMessage,
  onRollback,
  canRollback = false,
  onLoadStart,
  onLoadEnd,
  onError,
}: WebViewBridgeProps) {
  const controller = useWebViewController(source);
  const insets = useSafeAreaInsets();

  // 安全区同步注入（加载前写入 window.RN_SAFE_AREA）：
  // Android 15+（targetSdk 35+）强制 edge-to-edge，StatusBar.currentHeight 已废弃返回 0，
  // 必须用 safe-area-context 的真实 insets（WindowInsets，含刘海屏 cutout）。
  // 单位 dp，WebView 中 1 CSS px ≈ 1 dp（index.html 已设 viewport-fit=cover + width=device-width）。
  const safeAreaInjection = `(function(){
    try {
      window.RN_SAFE_AREA = {
        top: ${insets.top}, right: ${insets.right},
        bottom: ${insets.bottom}, left: ${insets.left}
      };
    } catch(e) {}
  })();`;

  // 双保险：把 insets 拼进 URL query（safeTop 等），H5 从 location.search 同步读取。
  // 不依赖 injectedJavaScriptBeforeContentLoaded 的注入时机（新架构下偶发不执行）。
  const webViewSource = useMemo(() => {
    if (!('uri' in source)) {
      return source;
    }
    const sep = source.uri.includes('?') ? '&' : '?';
    return {
      ...source,
      uri:
        source.uri +
        `${sep}safeTop=${insets.top}&safeRight=${insets.right}` +
        `&safeBottom=${insets.bottom}&safeLeft=${insets.left}`,
    };
  }, [source, insets.top, insets.right, insets.bottom, insets.left]);

  // 同步给 Bridge：老 H5 走 RN.SYSTEM.GETSTATUSBARHEIGHT() 也能拿到真实顶部 inset。
  useEffect(() => {
    setStatusBarInset(insets.top);
  }, [insets.top]);

  // 注入 WebView 实例到 webView 控制模块，支持 H5 调用 RN.WEBVIEW.RELOAD/GOBACK 等。
  useEffect(() => {
    setWebViewHandle(controller._webViewRef.current);
    return () => setWebViewHandle(null);
  }, [controller]);

  const server = useMemo(() => {
    const s = createAppBridgeServer(capabilities, lifecycle, undefined, {
      onCall: logDeviceCall,
    });
    // 启动即写一条 boot 日志，用于验证日志链路与按日期分包
    const entry = 'uri' in source ? source.uri : 'inline';
    deviceLogger.info(`bridge.ready entry=${entry} bridgeVersion=1.0.0`);
    return s;
  }, [capabilities, lifecycle, source]);
  const handleMessage = useMemo(() => createWebViewMessageHandler(server), [server]);

  // 将 RN → H5 事件（如 system.darkmodechange / auth.logout / network.changed）
  // 通过 WebView postMessage 透传给 H5 侧订阅（规范 §62）。
  useEffect(() => {
    server.eventBus.setGlobalListener(e => {
      const wv = controller._webViewRef.current;
      if (wv && typeof wv.postMessage === 'function') {
        wv.postMessage(JSON.stringify(e));
      }
    });
    return () => server.eventBus.clearGlobalListener();
  }, [server, controller]);

  // App 前后台生命周期事件桥接（升级方案 §8/§26）：AppState 变化 -> eventBus -> postMessage 推给 H5。
  // H5 侧通过 RN.ON('app.background' / 'app.resume', handler) 订阅。
  // （PermissionProvider 中另有 AppState 监听，仅用于权限刷新，互不冲突。）
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background') {
        server.eventBus.emit(BRIDGE_EVENTS.APP_BACKGROUND, {
          timestamp: Date.now(),
        });
      } else if (next === 'active') {
        server.eventBus.emit(BRIDGE_EVENTS.APP_RESUME, {
          timestamp: Date.now(),
        });
      }
    });
    return () => sub.remove();
  }, [server]);

  const handleShouldStartLoad = (event: { url: string }): boolean => {
    const decision = decideNavigation(event.url, trustedOrigins);
    if (decision.action === 'open-external') {
      // 白名单外域名走系统浏览器，不继承 Bridge 权限
      Linking.openURL(event.url).catch(() => undefined);
      return false;
    }
    if (decision.action === 'block') {
      // 自定义 scheme / file:// 等安全拦截
      return false;
    }
    return true;
  };

  const handleNativeError = (e: { nativeEvent: unknown }) => {
    const structured = classifyNativeError(
      e.nativeEvent as Parameters<typeof classifyNativeError>[0],
    );
    controller._onError(structured);
    onError?.(structured);
  };

  const handleHttpError = (e: { nativeEvent: unknown }) => {
    const structured = classifyHttpError(e.nativeEvent as Parameters<typeof classifyHttpError>[0]);
    controller._onHttpError(structured);
    onError?.(structured);
  };

  return (
    <View style={styles.container}>
      <WebView
        // react-native-webview v14 类型定义为 FunctionComponent（未 forwardRef），ref 类型为 never，运行时实际支持
        // @ts-expect-error ref injection for react-native-webview v14
        ref={controller._webViewRef}
        source={webViewSource}
        onLoadStart={() => {
          controller._onLoadStart();
          onLoadStart?.();
        }}
        onLoadEnd={() => {
          controller._onLoadEnd();
          onLoadEnd?.();
        }}
        onError={handleNativeError}
        onHttpError={handleHttpError}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={async (event: { nativeEvent: { data: string } }) => {
          const raw = event.nativeEvent.data;
          if (__DEV__) {
            console.log(`[bridge] H5->RN msg=${raw.slice(0, 300)}`);
          }
          const responseRaw = await handleMessage(raw);
          if (responseRaw && controller._webViewRef.current) {
            if (__DEV__) {
              console.log(`[bridge] RN->H5 resp=${responseRaw.slice(0, 300)}`);
            }
            controller._webViewRef.current.postMessage(responseRaw);
          }
        }}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowContentAccess
        originWhitelist={['file://', 'content://', 'android.resource://', ...trustedOrigins]}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        overScrollMode="never"
        injectedJavaScriptBeforeContentLoaded={`${devCorsBypassInjection}\n${platformInjection}\n${safeAreaInjection}\nwindow.__H5_INJECT_END__='1';`}
        style={styles.webView}
      />
      {controller.state === 'loading' ? <WebViewLoading message={loadingMessage} /> : null}
      {controller.state === 'error' && controller.error ? (
        <WebViewErrorPage
          error={controller.error}
          onReload={controller.reload}
          onRollback={onRollback}
          canRollback={canRollback}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
});
