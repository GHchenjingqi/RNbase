/**
 * Base Mobile App 入口（组合根）。
 *
 * 权限体系与 Bridge 由子模块承载；此处仅做生命周期容器与组合装配，
 * H5 业务运行时通过 WebView 加载（规则 4：业务代码不外溢到 RN）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PermissionManagerProvider } from './src/permissions/PermissionProvider';
import { WebViewBridge } from './src/webview/WebViewBridge';
import { WebViewErrorPage } from './src/webview/WebViewErrorPage';
import { getH5EntryUri } from './src/app/resolve-h5-entry';
import {
  APP_NAME,
  CRASH_REPORT_ENDPOINT,
  REMOTE_H5_ORIGIN,
  REMOTE_H5_URL,
  SPLASH_DURATION_MS,
  STATUS_BAR_STYLE,
  validateClientIds,
} from './src/config';
import { runHarmonyNativeSelfTest } from './src/diagnostics/harmony-native-self-test';
import {
  installGlobalErrorHandlers,
  setCrashUploader,
  createHttpCrashUploader,
} from './src/diagnostics/crash-reporter';
import { deviceLogger } from './src/diagnostics/device-logger';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { SplashOverlay } from './src/app/SplashOverlay';
import { setH5BarStyleListener } from './src/bridge/modules/statusbar';
import type { BarStyle } from './src/bridge/modules/statusbar';
import splashDefaultImage from './src/assets/splash/splash-default.jpg';
import { SPLASH_ACTIVE } from './src/assets/splash/active';

// H5 入口两条路（开关是 version.json 的 remoteUrl，见 README「基座 + URL（远程站点模式）」）：
//  - 远程模式：入口就是那个站点，不读内置 assets，也不给第三方 origin 注入 Bridge
//    （window.ReactNativeWebView 一给出去，相机/文件/定位/剪贴板就成了它的攻击面）。
//  - 本地模式：按平台取内置资源 ——
//      · 安卓：file:///android_asset/index.html
//      · iOS：file://{App bundle}/h5/index.html（由原生 H5BundleBasePath 暴露，需 Xcode 加 folder reference）
//      · 鸿蒙：asset://h5/index.html（rawfile）
//    本地模式不可解析（如 iOS 未打包 h5）时返回 null，下方渲染「配置缺失」错误页。
export default function App() {
  const isDarkMode = useColorScheme() === 'dark';
  // 入口每次冷启动算一次就够；但本地模式为 null 时「重新加载」需重算，故用 state。
  const [h5Uri, setH5Uri] = useState<string | null>(() => REMOTE_H5_URL ?? getH5EntryUri());
  const isRemote = REMOTE_H5_URL !== null;
  // barStyle 仲裁，优先级：H5 Bridge 接管 > version.json 的 statusBarStyle（远程模式
  // 没有 Bridge，只能靠配置声明）> 系统深浅色。远程模式无 Bridge，天然只有后两级。
  const [h5BarStyle, setH5BarStyle] = useState<BarStyle | null>(null);
  // 启动闪屏：盖在 WebView 上面倒数 3 秒（点击可跳过），期间 H5 在底下照常装载。
  // SPLASH_DURATION_MS 为 0 时直接不渲染（关闭闪屏）。
  const [splashVisible, setSplashVisible] = useState(SPLASH_DURATION_MS > 0);
  // 页面是否已完成首次加载。闪屏倒计时结束后若页面还没好，
  // 闪屏继续盖着（显示「正在翻开诗卷…」），避免露出 WebView 的白屏。
  const [h5Loaded, setH5Loaded] = useState(false);
  const handleH5Loaded = useCallback(() => setH5Loaded(true), []);
  useEffect(() => {
    setH5BarStyleListener((style) => setH5BarStyle(style));
    return () => setH5BarStyleListener(null);
  }, []);

  // 鸿蒙原生能力自检（Phase 4 验收通道）：结果写设备日志，登录前即可用 hdc 取回。
  // 非 harmony 平台直接 return，安卓/iOS 启动链路零成本。
  useEffect(() => {
    runHarmonyNativeSelfTest();
  }, []);

  // 全局异常兜底：release 下接管 ErrorUtils + 未处理 Promise 拒绝，统一进设备日志；
  // dev 下只上报、保留 RedBox。必须早于任何业务渲染，确保首屏前的异常也能捕获。
  useEffect(() => {
    installGlobalErrorHandlers();
    // 崩溃上报闭环：配置了网关地址则注册 HTTP 上报器，崩溃经离线缓冲异步冲刷。
    if (CRASH_REPORT_ENDPOINT) {
      setCrashUploader(createHttpCrashUploader(CRASH_REPORT_ENDPOINT));
    }
  }, []);

  // 打包前 clientId 校验（尤其 iOS 默认占位值会导致登录被拒）。
  useEffect(() => {
    const missing = validateClientIds();
    if (missing.length > 0) {
      const msg = `[config] CLIENT_ID 未配置：${missing.join(
        ', '
      )}（占位值将导致对应端登录被后端拒绝）`;
      console.error(msg);
      deviceLogger.error(msg);
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={h5BarStyle ?? STATUS_BAR_STYLE ?? (isDarkMode ? 'light-content' : 'dark-content')}
      />
      <PermissionManagerProvider>
        <AppErrorBoundary>
          {h5Uri ? (
            <WebViewBridge
              source={{ uri: h5Uri }}
              bridgeEnabled={!isRemote}
              trustedOrigins={isRemote && REMOTE_H5_ORIGIN ? [REMOTE_H5_ORIGIN] : undefined}
              onLoadEnd={handleH5Loaded}
            />
          ) : (
            <WebViewErrorPage
              error={{
                type: 'config',
                message:
                  'iOS 本地 H5 尚未打包：请在 Xcode 中将 h5/ 作为 folder reference 加入 App target，或配置远程站点模式（version.json 的 remoteUrl）。',
              }}
              onReload={() => setH5Uri(REMOTE_H5_URL ?? getH5EntryUri())}
            />
          )}
        </AppErrorBoundary>
      </PermissionManagerProvider>
      {splashVisible ? (
        <SplashOverlay
          durationMs={SPLASH_DURATION_MS}
          imageSource={SPLASH_ACTIVE ?? splashDefaultImage}
          appName={APP_NAME}
          // 倒计时走完但页面尚未加载完时继续等待（最多 8s），不露出白屏
          holdUntil={!h5Loaded}
          holdMaxMs={8000}
          onFinish={() => setSplashVisible(false)}
        />
      ) : null}
    </SafeAreaProvider>
  );
}
