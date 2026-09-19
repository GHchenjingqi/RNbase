/**
 * WebView 加载失败兜底页（对应 Phase 2 / 规范 §26，Phase 8 接入手动回滚）。
 *
 * 展示结构化错误信息 + 「重新加载」「使用上一版本」「联系客服」按钮。
 * - 重新加载：重试当前版本
 * - 使用上一版本：手动回滚到历史稳定版本（Phase 8）
 * - 联系客服：跳转客服渠道（预留接口）
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { WebViewErrorInfo } from './types';
import { getErrorSuggestion, getErrorTitle } from './error-handler';

type WebViewErrorPageProps = {
  error: WebViewErrorInfo;
  onReload: () => void;
  /** Phase 8 接入：使用上一版本。 */
  onRollback?: () => void;
  /** 是否显示回滚按钮（需要有历史版本时）。 */
  canRollback?: boolean;
  /** 联系客服回调。 */
  onContactSupport?: () => void;
  /** 当前版本号（展示用）。 */
  currentVersion?: string;
  /** 网络状态（展示用）。 */
  networkStatus?: string;
};

export function WebViewErrorPage({
  error,
  onReload,
  onRollback,
  canRollback = false,
  onContactSupport,
  currentVersion,
  networkStatus,
}: WebViewErrorPageProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>!</Text>
      </View>
      <Text style={styles.title}>{getErrorTitle(error)}</Text>
      <Text style={styles.suggestion}>{getErrorSuggestion(error)}</Text>
      {error.message ? (
        <Text style={styles.detail} numberOfLines={2}>
          {error.message}
        </Text>
      ) : null}
      {currentVersion || networkStatus ? (
        <Text style={styles.meta}>
          {currentVersion ? `版本：${currentVersion}` : ''}
          {currentVersion && networkStatus ? '　' : ''}
          {networkStatus ? `网络：${networkStatus}` : ''}
        </Text>
      ) : null}
      <TouchableOpacity style={styles.button} onPress={onReload}>
        <Text style={styles.buttonText}>重新加载</Text>
      </TouchableOpacity>
      {canRollback && onRollback ? (
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={onRollback}>
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>使用上一版本</Text>
        </TouchableOpacity>
      ) : null}
      {onContactSupport ? (
        <TouchableOpacity style={styles.supportButton} onPress={onContactSupport}>
          <Text style={styles.supportButtonText}>联系客服</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF3CD',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#856404',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    textAlign: 'center',
  },
  suggestion: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  detail: {
    fontSize: 12,
    color: '#999999',
    textAlign: 'center',
    marginTop: 4,
  },
  meta: {
    fontSize: 11,
    color: '#AAAAAA',
    textAlign: 'center',
    marginTop: 4,
  },
  button: {
    marginTop: 16,
    paddingHorizontal: 32,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    minWidth: 160,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#007AFF',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#007AFF',
  },
  supportButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  supportButtonText: {
    fontSize: 14,
    color: '#999999',
    textDecorationLine: 'underline',
  },
});
