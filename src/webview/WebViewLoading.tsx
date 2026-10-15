/**
 * H5 加载中状态组件（对应 Phase 2 / 规范 §4）。
 * 在 WebView loadStart 时展示，loadEnd 后消失。
 * 底色跟随系统深浅色（与 WebViewBridge 的 chromeBackground 同值），避免深色模式白闪。
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useColorScheme } from 'react-native';

type WebViewLoadingProps = {
  message?: string;
};

export function WebViewLoading({ message = '加载中...' }: WebViewLoadingProps) {
  const isDarkMode = useColorScheme() === 'dark';
  const styles = createStyles(isDarkMode);
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

function createStyles(dark: boolean) {
  return StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFill,
      backgroundColor: dark ? '#08080D' : '#FFFFFF',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
    },
    text: {
      fontSize: 14,
      color: dark ? '#999999' : '#666666',
    },
  });
}
