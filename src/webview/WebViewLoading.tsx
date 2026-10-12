/**
 * H5 加载中状态组件（对应 Phase 2 / 规范 §4）。
 * 在 WebView loadStart 时展示，loadEnd 后消失。
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type WebViewLoadingProps = {
  message?: string;
};

export function WebViewLoading({ message = '加载中...' }: WebViewLoadingProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  text: {
    fontSize: 14,
    color: '#666666',
  },
});
