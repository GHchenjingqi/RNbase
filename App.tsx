/**
 * ERP Mobile App 入口（组合根）。
 *
 * 权限体系与 Bridge 由子模块承载；此处仅做生命周期容器与组合装配，
 * H5 业务运行时通过 WebView 加载（规则 4：业务代码不外溢到 RN）。
 */
import React, { useEffect, useState } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PermissionManagerProvider } from './src/permissions/PermissionProvider';
import { WebViewBridge } from './src/webview/WebViewBridge';
import { getH5EntryUri } from './src/app/resolve-h5-entry';
import { REMOTE_H5_ORIGIN, REMOTE_H5_URL } from './src/config';
import { runHarmonyNativeSelfTest } from './src/diagnostics/harmony-native-self-test';

// H5 入口两条路（开关是 version.json 的 remoteUrl，见 README「基座 + URL（远程站点模式）」）：
//  - 远程模式：入口就是那个站点，不读 APK 内置 assets，也不给第三方 origin 注入 Bridge
//    （window.ReactNativeWebView 一给出去，相机/文件/定位/剪贴板就成了它的攻击面）。
//  - 本地模式：统一由 assets/index.html 资源 URL 提供，debug 下指向 Metro 资源服务，
//    改文件后刷新（reload）即生效。
export default function App() {
  const isDarkMode = useColorScheme() === 'dark';
  // 入口每次冷启动算一次就够（本地模式带防缓存随机参数，重渲染换 URL 会让 WebView 重新加载）。
  const [h5Source] = useState(() => ({ uri: REMOTE_H5_URL ?? getH5EntryUri() }));
  const isRemote = REMOTE_H5_URL !== null;

  // 鸿蒙原生能力自检（Phase 4 验收通道）：结果写设备日志，登录前即可用 hdc 取回。
  // 非 harmony 平台直接 return，安卓/iOS 启动链路零成本。
  useEffect(() => {
    runHarmonyNativeSelfTest();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <PermissionManagerProvider>
        <WebViewBridge
          source={h5Source}
          bridgeEnabled={!isRemote}
          trustedOrigins={isRemote && REMOTE_H5_ORIGIN ? [REMOTE_H5_ORIGIN] : undefined}
        />
      </PermissionManagerProvider>
    </SafeAreaProvider>
  );
}
