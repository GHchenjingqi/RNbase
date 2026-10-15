/**
 * WebView 容器组件（对应 Phase 2 / 规范 §4/§24/§26）：承载 H5 业务运行时，
 * 集成加载状态、导航白名单拦截、结构化错误处理与兜底页。
 *
 *  - onMessage：H5 发来的 Bridge 请求 -> BridgeServer -> 回传响应
 *  - onShouldStartLoadWithRequest：域名白名单拦截（规范 §24）
 *  - onError / onHttpError：结构化错误分类（规范 §26）
 *  - loading / error page：加载中与失败兜底展示
 *  - BackHandler：硬件返回键决策交给 H5（native.back 事件 + app.nativeBackResult 回执）；
 *    H5 没消化（或远程模式没有 Bridge）时走容器兜底：优先 WebView 回退一步，
 *    退无可退要「再按一次」才退出（见 ./back-policy.ts）
 *
 * 对应规范 §4/§24/§26/§31/§51。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  Linking,
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setStatusBarInset } from '../bridge/modules/system';
import { setWebViewHandle } from '../bridge/modules/webview-control';
import { isKeyboardVisible } from '../bridge/modules/keyboard';
import { setNativeBackResultHandler } from '../bridge/modules/app';
import { isHarmony } from '../platform/os';
import { createAppBridgeServer } from '../app/compose-bridge-server';
import { deviceLogger, logDeviceCall } from '../diagnostics/device-logger';
import { BRIDGE_EVENTS } from '../bridge/protocol';
import type { CapabilityAdapters } from '../bridge/modules/capabilities/types';
import type { LifecycleHandlers } from '../bridge/modules/app';
import { createWebViewMessageHandler } from './webview-message-handler';
import { useWebViewController } from './web-view-controller';
import { EXIT_CONFIRM_WINDOW_MS, createBackCoordinator } from './back-policy';
import type { BackCoordinator } from './back-policy';
import { decideNavigation } from './navigation';
import { classifyHttpError, classifyNativeError } from './error-handler';
import { WebViewLoading } from './WebViewLoading';
import { WebViewErrorPage } from './WebViewErrorPage';
import { DOMAIN_WHITELIST, REMOTE_H5_LOAD_TIMEOUT_MS } from '../config';
import type { WebViewErrorInfo, WebViewSource } from './types';

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
 * 深浅色同步注入（H5 加载前写入 window.RN_APPEARANCE）。
 * H5 首帧即可同步读取当前深浅色，不必先按浅色画再等异步 GETDARKMODE 后跳变；
 * 运行期切换由 system.darkmodechange 事件补（system.ts 的 Appearance 监听）。
 * 该值是首载快照，与 system.darkmodechange 事件配合使用。
 */
function buildAppearanceInjection(isDark: boolean): string {
  return `(function(){
  try { window.RN_APPEARANCE = ${JSON.stringify(isDark ? 'dark' : 'light')}; } catch(e) {}
})();`;
}

/**
 * 等 H5 回执 native.back 的超时（毫秒）。超时视为 H5 卡死/未就绪，
 * 容器自行兜底（WebView 历史回退，退无可退才退出），避免返回键彻底失灵。
 */
const NATIVE_BACK_ACK_TIMEOUT_MS = 400;

/**
 * 退出容器。Android 走 RN 的 BackHandler.exitApp（NativeModules.ExitApp）；
 * iOS 无硬件返回键，BackHandler 在 iOS 侧是空实现，调过去也是无害空操作。
 * RNOH 既没有 ExitApp 也没实现它，调过去是 `undefined is not a function`，
 * 所以鸿蒙走自研的 BaseSystem.exitApp（ArkTS 侧 terminateSelf）。
 */
function exitContainer(): void {
  if (isHarmony()) {
    const mod = NativeModules.BaseSystem as { exitApp?: () => Promise<void> } | undefined;
    // 后台执行：terminateSelf 返回时窗口已经没了，await 只会让返回键卡住。
    mod?.exitApp?.().catch(() => undefined);
    return;
  }
  BackHandler.exitApp();
}

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
  /**
   * 是否注入并受理 Bridge（默认 true）。
   * 「基座 + URL」模式下置 false：不给第三方页任何原生句柄（window.RN_PLATFORM /
   * RN_SAFE_AREA / window.ReactNativeWebView 都不写），H5 侧发来的消息也直接丢弃 ——
   * 容器只提供外壳（加载/错误页/返回键/导航拦截），不暴露原生能力。
   *
   * 这个开关同时决定安全区（状态栏 / 导航栏遮挡）走哪条路，两条路互斥不叠加：
   *  - true（本地 file:// 子应用）：页面是自己写的，读 window.RN_SAFE_AREA 自己留白；
   *  - false（远程站点）：第三方页不认我们的注入值（实测站点既没 viewport-fit=cover
   *    也没用过 safe-area-inset），改注入一条纯 CSS 给 html 补 padding —— 只写样式，
   *    不碰 window，留白处由站点自己的背景绘制。
   */
  bridgeEnabled?: boolean;
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
  bridgeEnabled = true,
  loadingMessage,
  onRollback,
  canRollback = false,
  onLoadStart,
  onLoadEnd,
  onError,
}: WebViewBridgeProps) {
  const controller = useWebViewController(source);
  const insets = useSafeAreaInsets();
  // WebView / 容器底色跟随系统深浅色：WebView 默认白底，深色模式下启动与页面跳转会白闪。
  // 深色取 #08080D，与基座中性闪屏底色一致，冷启动到首屏色彩连续。
  const isDarkMode = useColorScheme() === 'dark';
  const chromeBackground = isDarkMode ? '#08080D' : '#FFFFFF';

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

  // URL query 只按首次渲染的 insets 拼。Android 上 safe-area-context 首帧即真实值
  // （initialWindowMetrics），这与此前「安卓不重载、鸿蒙才重载」的实测一致；
  // 若随 insets 变化重拼 URI，旋转/分屏/折叠屏会触发 WebView 整页重载，对 H5 SPA 是
  // 体验断裂。运行期变化改走 system.safeareachange 事件（见下方 effect），H5 自行重排。
  // 鸿蒙除外：insets 是异步拿到的，拼进 query 会让 source.uri 在首屏加载后再变一次，
  // ArkTS 侧据此重新 loadUrl（实测 hilog 里 navigationId 1→2），整页白加载一遍。
  // 鸿蒙的 inset 走 window.RN_SAFE_AREA 注入 + RN.SYSTEM.GETSTATUSBARHEIGHT 两条路，
  // H5 侧并不读这几个 query 参数，没有必要为它付一次重载。
  const initialInsetsRef = useRef(insets);
  const webViewSource = useMemo(() => {
    if (!('uri' in source)) {
      return source;
    }
    if (isHarmony() || !bridgeEnabled) {
      // 鸿蒙见上方注释；远程模式不把容器内部参数（safeTop 等）拼到第三方 URL 上，
      // 那既是一次信息外泄，也可能撞上站点自己的路由/缓存键。
      return source;
    }
    const i = initialInsetsRef.current;
    const sep = source.uri.includes('?') ? '&' : '?';
    return {
      ...source,
      uri:
        source.uri +
        `${sep}safeTop=${i.top}&safeRight=${i.right}` +
        `&safeBottom=${i.bottom}&safeLeft=${i.left}`,
    };
  }, [source, bridgeEnabled]);

  // 远程模式的安全区：只往页面里补一条 <style>，把留白交给 html 的 padding。
  // 与本地注入的区别就一条：不写任何 window.*，不给页面原生句柄，能力面仍是零。
  // 为什么放页面里而不是容器 padding：那条带由页面自己的背景绘制，跟站点配色天然一致，
  // 容器 padding 透出的是 RN 窗口背景，会切出一条与头图不同色的白条。
  // !important 是给 SPA 兜底：Vite 这类构建会在运行时往 head 追加样式，排在我们就绪样式之后。
  const safeAreaCssInjection = `(function(){
    var css='html{padding-top:${insets.top}px!important;padding-bottom:${insets.bottom}px!important}';
    var add=function(){
      if(document.getElementById('__rn_safe_area__'))return;
      var s=document.createElement('style');
      s.id='__rn_safe_area__';
      s.textContent=css;
      (document.head||document.documentElement).appendChild(s);
    };
    // document-start 时 <html> 还不存在，退到 DOMContentLoaded 再补（最多一帧未留白）。
    if(document.documentElement)add();
    else document.addEventListener('DOMContentLoaded',add);
  })();`;

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

  // 返回键逻辑只挂一次（见下方 BackHandler effect），用 ref 读取最新的 server/controller，
  // 避免因依赖变化重挂而误清掉「等 H5 回执」的超时。
  const serverRef = useRef(server);
  serverRef.current = server;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const backAckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 远程模式主资源加载超时兜底（见 config REMOTE_H5_LOAD_TIMEOUT_MS 说明）
  const remoteLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 返回键 effect 只挂一次，模式开关同样用 ref 读最新值（远程模式没有 Bridge 通道可问）
  const bridgeEnabledRef = useRef(bridgeEnabled);
  bridgeEnabledRef.current = bridgeEnabled;
  // 「再按一次退出应用」提示的显隐与自动收起计时器
  const [exitHintVisible, setExitHintVisible] = useState(false);
  const exitHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 让容器内的 WebView 回退一步，返回是否真的回退了。
   *
   * 安卓走原生真值查询（`BaseSystem.webViewGoBack`）：react-native-webview v14 的 ref 上
   * 没有 canGoBack 命令（命令表只剩 goBack/reload/…），JS 侧只能读导航事件里的快照，
   * SPA 同文档路由（pushState）/hash 路由/错误页重载都会让快照过期 —— 快照说「退不了」，
   * 容器兜底就会 finish Activity，即「子页面按一次返回键直接退出 App」。
   * 原生查询在按键那一刻读 `WebView.canGoBack()`，判断与动作原子完成，且不依赖 JS ref
   * 是否已挂上。鸿蒙 / iOS 退回 JS 快照，快照说退不了时也只是走「再按一次退出」，不会一步退出。
   */
  const goBackIfPossible = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      const mod = NativeModules.BaseSystem as
        | { webViewGoBack?: () => Promise<boolean> }
        | undefined;
      if (typeof mod?.webViewGoBack === 'function') {
        try {
          return (await mod.webViewGoBack()) === true;
        } catch (e) {
          deviceLogger.warn(`nativeBack.webViewGoBack failed: ${String(e)}`);
        }
      }
    }
    const c = controllerRef.current;
    const wv = c._webViewRef.current;
    if (c.canGoBack() && wv) {
      wv.goBack();
      return true;
    }
    return false;
  }, []);

  // 协调器持有「二次确认」状态，必须跨渲染存活，故放 ref 里只建一次。
  const backCoordinatorRef = useRef<BackCoordinator | null>(null);
  if (!backCoordinatorRef.current) {
    backCoordinatorRef.current = createBackCoordinator({
      goBackIfPossible: () => goBackIfPossible(),
      exit: exitContainer,
    });
  }

  const clearRemoteLoadTimer = useCallback(() => {
    if (remoteLoadTimerRef.current) {
      clearTimeout(remoteLoadTimerRef.current);
      remoteLoadTimerRef.current = null;
    }
  }, []);

  // 卸载时清理远程加载超时计时器，避免定时器泄漏
  useEffect(() => clearRemoteLoadTimer, [clearRemoteLoadTimer]);

  // 将 RN → H5 事件（如 system.darkmodechange / auth.logout / network.changed）
  // 通过 WebView postMessage 透传给 H5 侧订阅（规范 §62）。
  useEffect(() => {
    if (!bridgeEnabled) {
      return;
    }
    server.eventBus.setGlobalListener((e) => {
      const wv = controller._webViewRef.current;
      if (wv && typeof wv.postMessage === 'function') {
        wv.postMessage(JSON.stringify(e));
      }
    });
    return () => server.eventBus.clearGlobalListener();
  }, [server, controller, bridgeEnabled]);

  // insets 运行期变化（旋转 / 分屏 / 折叠屏展开）：URL query 与 window.RN_SAFE_AREA
  // 都是首载快照不再更新，运行期变化以本事件为准，H5 订阅后自行重排（见
  // BRIDGE_EVENTS.SAFE_AREA_CHANGE 注释）。必须放在 setGlobalListener 的 effect 之后，
  // 确保发射时转发通道已就位。首载即等于初值，不会多发一条。
  useEffect(() => {
    if (!bridgeEnabled) {
      return;
    }
    const i0 = initialInsetsRef.current;
    if (
      insets.top === i0.top &&
      insets.bottom === i0.bottom &&
      insets.left === i0.left &&
      insets.right === i0.right
    ) {
      return;
    }
    server.eventBus.emit(BRIDGE_EVENTS.SAFE_AREA_CHANGE, {
      top: insets.top,
      right: insets.right,
      bottom: insets.bottom,
      left: insets.left,
    });
  }, [server, bridgeEnabled, insets.top, insets.right, insets.bottom, insets.left]);

  // App 前后台生命周期事件桥接（升级方案 §8/§26）：AppState 变化 -> eventBus -> postMessage 推给 H5。
  // H5 侧通过 RN.ON('app.background' / 'app.resume', handler) 订阅。
  // （PermissionProvider 中另有 AppState 监听，仅用于权限刷新，互不冲突。）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
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

  // 硬件返回拦截：H5 是单 WebView 容器，不拦截时系统直接 finish Activity，
  // 表现为「在子页面按返回就退出 App」。两级决策（见 src/webview/back-policy.ts）：
  //  1. 本地（离线包）模式把决策交给 H5（关弹层 → 退路由 → 退出确认），
  //     H5 用 app.nativeBackResult 回执 consumed；
  //  2. 回执 consumed=false、超时未回执，或远程（基座 + URL）模式没有 Bridge 通道时，
  //     走容器兜底：先让 WebView 回退一步，退无可退则要求 2 秒内再按一次才退出。
  useEffect(() => {
    const clearAckTimer = () => {
      if (backAckTimerRef.current) {
        clearTimeout(backAckTimerRef.current);
        backAckTimerRef.current = null;
      }
    };
    const clearExitHintTimer = () => {
      if (exitHintTimerRef.current) {
        clearTimeout(exitHintTimerRef.current);
        exitHintTimerRef.current = null;
      }
    };
    // 容器兜底：能回退就回退；退无可退只提示，窗口内第二次才真正退出。
    const requestContainerBack = () => {
      clearAckTimer();
      backCoordinatorRef.current
        ?.handle()
        .then((outcome) => {
          if (outcome !== 'exit-confirm') return;
          setExitHintVisible(true);
          clearExitHintTimer();
          exitHintTimerRef.current = setTimeout(() => {
            setExitHintVisible(false);
            exitHintTimerRef.current = null;
          }, EXIT_CONFIRM_WINDOW_MS);
        })
        .catch(() => undefined);
    };
    setNativeBackResultHandler((consumed) => {
      if (!consumed) requestContainerBack();
      else clearAckTimer();
    });
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // 键盘弹起时返回键先收键盘，和原生页面一致
      if (isKeyboardVisible()) {
        Keyboard.dismiss();
        return true;
      }
      // 远程模式页面拿不到 Bridge，没有 native.back 通道可问，直接走容器兜底。
      // 本地模式有 WebView 才问 H5；WebView 尚未挂载时不再直接退出 App ——
      // 交给兜底（原生按视图树查历史，退无可退也只提示一次）。
      if (bridgeEnabledRef.current && controllerRef.current._webViewRef.current) {
        serverRef.current.eventBus.emit(BRIDGE_EVENTS.NATIVE_BACK, { ts: Date.now() });
        clearAckTimer();
        backAckTimerRef.current = setTimeout(requestContainerBack, NATIVE_BACK_ACK_TIMEOUT_MS);
        return true;
      }
      requestContainerBack();
      return true;
    });
    return () => {
      sub.remove();
      setNativeBackResultHandler(null);
      clearAckTimer();
      clearExitHintTimer();
    };
  }, []);

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
    clearRemoteLoadTimer();
    const structured = classifyNativeError(
      e.nativeEvent as Parameters<typeof classifyNativeError>[0]
    );
    controller._onError(structured);
    onError?.(structured);
  };

  const handleHttpError = (e: { nativeEvent: unknown }) => {
    clearRemoteLoadTimer();
    const structured = classifyHttpError(e.nativeEvent as Parameters<typeof classifyHttpError>[0]);
    // 鸿蒙：只记日志，不切错误页。port 侧 WebViewBaseOperate.ets 的 emitHttpError
    // 没有像 emitLoadingError 那样过滤 request.isMainFrame()，任何一个子资源
    // （favicon、SSE 代理等）返回 4xx 都会抛过来，落到 _onHttpError 就是把
    // 正常渲染中的 H5 整屏盖成「页面加载失败」——实测首屏即被 /dev-api 的 404 触发。
    // 真正的整页失败仍有兜底：loadingError（该 port 已按 main frame 过滤）+ 握手超时。
    if (isHarmony()) {
      deviceLogger.warn(
        `httpError.ignored(sub-resource) code=${structured.httpStatus ?? '?'}` +
          ` url=${structured.url ?? '?'}`
      );
      return;
    }
    controller._onHttpError(structured);
    onError?.(structured);
  };

  return (
    <View style={[styles.container, { backgroundColor: chromeBackground }]}>
      <WebView
        // react-native-webview v14 类型定义为 FunctionComponent（未 forwardRef），ref 类型为 never，运行时实际支持
        // @ts-expect-error ref injection for react-native-webview v14
        ref={controller._webViewRef}
        source={webViewSource}
        onLoadStart={(event) => {
          controller._onLoadStart(event.nativeEvent.canGoBack);
          onLoadStart?.();
          // 远程模式：主资源未在时限内到达即判超时（见 REMOTE_H5_LOAD_TIMEOUT_MS）
          if (!bridgeEnabled) {
            clearRemoteLoadTimer();
            remoteLoadTimerRef.current = setTimeout(() => {
              const timedOut: WebViewErrorInfo = {
                type: 'timeout',
                code: 'REMOTE_LOAD_TIMEOUT',
                message: '远程站点主资源加载超时',
                url: 'uri' in source ? source.uri : undefined,
              };
              controller._onError(timedOut);
              onError?.(timedOut);
            }, REMOTE_H5_LOAD_TIMEOUT_MS);
          }
        }}
        onLoadEnd={(event) => {
          clearRemoteLoadTimer();
          controller._onLoadEnd(event.nativeEvent.canGoBack);
          onLoadEnd?.();
        }}
        onError={handleNativeError}
        onHttpError={handleHttpError}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={async (event: { nativeEvent: { data: string } }) => {
          if (!bridgeEnabled) {
            // 远程模式：容器不受理任何来自页面的消息（原生能力面为零）。
            return;
          }
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
        // 显式开启 HTTP 缓存：远程站点的 JS/CSS 带内容哈希，缓存命中可显著加快二次启动
        cacheEnabled
        // 远程模式连消息通道也不建：v14 建通道走 androidx.webkit 的 addWebMessageListener，
        // 该类在 API 28 上不存在（装机实测抛 ClassNotFoundException 并被吞掉），
        // 关掉既符合「不暴露能力」，也省掉一条无用的异常。
        messagingEnabled={bridgeEnabled}
        allowsInlineMediaPlayback
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowContentAccess
        originWhitelist={[
          'file://',
          'content://',
          'android.resource://',
          // 鸿蒙离线包两个形态都要放行：JS 侧下发 asset://h5/index.html，ArkWeb 报回来的
          // 是翻译后的 resource://rawfile/assets/h5/index.html。上游
          // createOnShouldStartLoadWithRequest 在过不了这份白名单时根本不调
          // onShouldStartLoadWithRequest，而是直接 Linking + `Can't open url` 掐掉首屏导航
          // （模拟器实测），所以 decideNavigation 放行不够，这里必须同步放开。
          ...(isHarmony() ? ['asset://', 'resource://'] : []),
          ...trustedOrigins,
        ]}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        overScrollMode="never"
        injectedJavaScriptBeforeContentLoaded={
          bridgeEnabled
            ? `${devCorsBypassInjection}\n${platformInjection}\n${buildAppearanceInjection(
                isDarkMode
              )}\n${safeAreaInjection}\nwindow.__H5_INJECT_END__='1';`
            : safeAreaCssInjection
        }
        style={styles.webView}
        backgroundColor={chromeBackground}
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
      {/* 退无可退时的「再按一次退出应用」提示（见 back-policy.ts）。
          盖在 WebView 上方但不吃事件，2 秒后自动收起。 */}
      {exitHintVisible ? (
        <View pointerEvents="none" style={[styles.exitHintWrap, { bottom: insets.bottom + 48 }]}>
          <View style={styles.exitHint}>
            <Text style={styles.exitHintText}>再按一次退出应用</Text>
          </View>
        </View>
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
  exitHintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  exitHint: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  exitHintText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
