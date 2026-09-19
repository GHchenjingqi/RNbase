/**
 * ERP Mobile App 入口（组合根）。
 *
 * 权限体系与 Bridge 由子模块承载；此处仅做生命周期容器与组合装配，
 * H5 业务运行时通过 WebView 加载（规则 4：业务代码不外溢到 RN）。
 */
import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PermissionManagerProvider } from './src/permissions/PermissionProvider';
import { WebViewBridge } from './src/webview/WebViewBridge';
import { getH5EntryUri } from './src/app/resolve-h5-entry';

// H5 入口统一由 assets/index.html 资源 URL 提供（方案 C）：
// debug 下指向 Metro 资源服务，改文件后刷新（reload）即生效；
// 后续替换为打包后的前端子项目产物时，仅需更新此资源。
const H5_ENTRY_URI = getH5EntryUri();

export default function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <PermissionManagerProvider>
        <WebViewBridge source={{ uri: H5_ENTRY_URI }} />
      </PermissionManagerProvider>
    </SafeAreaProvider>
  );
}
