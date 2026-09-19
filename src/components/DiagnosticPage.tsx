/**
 * 白屏 / 启动失败诊断页（规则 26）。
 *
 * 必须基于统一诊断信息展示，而不只是 “WebView error”。
 * 提供：重新加载 / 使用上一版本 / 联系客服 等可恢复动作。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TouchableOpacity } from 'react-native';

type DiagnosticPageProps = {
  title?: string;
  version?: string | null;
  networkType?: string;
  errorCode?: string;
  onReload?: () => void;
  onUsePrevious?: () => void;
  onContact?: () => void;
};

export function DiagnosticPage({
  title = 'H5 加载失败',
  version,
  networkType = '未知',
  errorCode = 'H5_BOOT_TIMEOUT',
  onReload,
  onUsePrevious,
  onContact,
}: DiagnosticPageProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.info}>
        <Text style={styles.row}>当前版本：{version ?? '无'}</Text>
        <Text style={styles.row}>网络状态：{networkType}</Text>
        <Text style={styles.row}>错误码：{errorCode}</Text>
      </View>
      <View style={styles.actions}>
        {onReload ? (
          <TouchableOpacity style={styles.button} onPress={onReload}>
            <Text style={styles.buttonText}>重新加载</Text>
          </TouchableOpacity>
        ) : null}
        {onUsePrevious ? (
          <TouchableOpacity style={styles.button} onPress={onUsePrevious}>
            <Text style={styles.buttonText}>使用上一版本</Text>
          </TouchableOpacity>
        ) : null}
        {onContact ? (
          <TouchableOpacity style={styles.button} onPress={onContact}>
            <Text style={styles.buttonText}>联系客服</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111111',
    marginBottom: 16,
  },
  info: {
    width: '100%',
    maxWidth: 320,
    marginBottom: 24,
  },
  row: {
    fontSize: 14,
    color: '#555555',
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  button: {
    marginHorizontal: 6,
    marginVertical: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#1677ff',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
  },
});
