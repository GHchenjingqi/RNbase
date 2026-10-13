/**
 * Base Mobile App 入口（组合根）。
 *
 * 权限体系与 Bridge 由子模块承载；此处仅做生命周期容器与组合装配，
 * H5 业务运行时通过 WebView 加载（规则 4：业务代码不外溢到 RN）。
 */
import React, { useEffect, useState } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PermissionManagerProvider } from './src/permissions/PermissionProvider';
import { WebViewBridge } from './src/webview/WebViewBridge';
import { WebViewErrorPage } from './src/webview/WebViewErrorPage';
import { getH5EntryUri } from './src/app/resolve-h5-entry';
import { REMOTE_H5_ORIGIN, REMOTE_H5_URL, validateClientIds } from './src/config';
import { runHarmonyNativeSelfTest } from './src/diagnostics/harmony-native-self-test';
import {
  installGlobalErrorHandlers,
  setCrashUploader,
  createHttpCrashUploader,
} from './src/diagnostics/crash-reporter';
import { CRASH_REPORT_ENDPOINT } from './src/config';
import { deviceLogger } from './src/diagnostics/device-logger';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';

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
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <PermissionManagerProvider>
        <AppErrorBoundary>
          {h5Uri ? (
            <WebViewBridge
              source={{ uri: h5Uri }}
              bridgeEnabled={!isRemote}
              trustedOrigins={isRemote && REMOTE_H5_ORIGIN ? [REMOTE_H5_ORIGIN] : undefined}
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
    </SafeAreaProvider>
  );
}
