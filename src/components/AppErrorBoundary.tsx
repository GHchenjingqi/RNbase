/**
 * App 级错误边界（P0-1 韧性地基）。
 *
 * 此前基座在 App.tsx 直接挂载 WebViewBridge，任何渲染期异常（H5 注入、Bridge 装配、
 * 安全区计算等）在 release 下都会整屏白屏且无记录。本边界：
 *
 *  - 捕获子树渲染异常，渲染降级 UI（居中卡片，与 WebViewErrorPage 同风格）；
 *  - 通过 crash-reporter 上报 message + componentStack 到设备日志；
 *  - 提供「重试」：重置边界状态，瞬态错误可自愈（如 H5 资源偶发不可用）。
 *
 * 仅做渲染期兜底；非渲染异常（事件回调、定时器、Promise）由 crash-reporter 的全局处理器覆盖。
 */
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { reportCrash } from '../diagnostics/crash-reporter';

type Props = {
  children: ReactNode;
  /** 重试前的额外动作（如强制重载 WebView 资源）。 */
  onReset?: () => void;
};

type State = {
  hasError: boolean;
  message?: string;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportCrash(error, `render:${info.componentStack ?? ''}`);
  }

  private handleRetry = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, message: undefined });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <View style={styles.container}>
        <Text style={styles.title}>应用出现异常</Text>
        <Text style={styles.subtitle}>已记录错误日志，可尝试恢复</Text>
        {__DEV__ && this.state.message ? (
          <Text style={styles.detail} numberOfLines={6}>
            {this.state.message}
          </Text>
        ) : null}
        <TouchableOpacity
          style={styles.button}
          onPress={this.handleRetry}
          testID="error-boundary-retry"
        >
          <Text style={styles.buttonText}>重试</Text>
        </TouchableOpacity>
      </View>
    );
  }
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#555555',
    marginBottom: 16,
  },
  detail: {
    fontSize: 12,
    color: '#888888',
    maxWidth: 320,
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#1677ff',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
  },
});
