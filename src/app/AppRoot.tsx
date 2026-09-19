/**
 * App 组合根（规则 4/5/9/26/34）：启动状态机 -> 解析 H5 入口 -> 渲染 WebView + Bridge。
 *
 *  - 启动状态机贯穿 BOOT -> ... -> RUNNING（规则 34）
 *  - H5 发送 app.ready 完成握手，标记版本 stable（规则 9）
 *  - 握手超时 / 加载失败 -> ERROR_RECOVERY -> 诊断页（规则 26）
 *  - 解析失败：错误态，可重试
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebViewBridge } from '../webview/WebViewBridge';
import { resolveH5Source } from './resolve-h5-source';
import { createRealRuntime } from './create-real-runtime';
import { FALLBACK_H5_HTML } from './fallback-h5';
import { BootStateMachine } from './boot-state-machine';
import { DiagnosticPage } from '../components/DiagnosticPage';
import { logger } from '../diagnostics/logger';
import { DOMAIN_WHITELIST, HANDSHAKE_TIMEOUT_MS } from '../config';
import type { CapabilityAdapters } from '../bridge/modules/capabilities/types';

type LoadState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      source: { uri: string } | { html: string };
      version: string | null;
    }
  | { kind: 'error'; message: string };

export function AppRoot({
  capabilities,
  allowedOrigin = DOMAIN_WHITELIST[0],
  handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS,
  networkType = 'Wi-Fi',
}: {
  capabilities?: CapabilityAdapters;
  allowedOrigin?: string;
  handshakeTimeoutMs?: number;
  networkType?: string;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [bootState, setBootState] = useState<string>('BOOT');
  const [webViewKey, setWebViewKey] = useState(0);
  const machineRef = useRef(new BootStateMachine());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runtimeRef = useRef(createRealRuntime());

  const apply = useCallback((trigger: Parameters<BootStateMachine['transition']>[0]) => {
    const ok = machineRef.current.transition(trigger);
    if (ok) {
      setBootState(machineRef.current.getState());
    }
  }, []);

  const clearHandshakeTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 启动：解析 H5 入口
  useEffect(() => {
    let mounted = true;
    apply('LOCAL_READY');
    apply('UPDATE_CHECKED');
    resolveH5Source(runtimeRef.current, FALLBACK_H5_HTML)
      .then(source => {
        if (!mounted) {
          return;
        }
        apply('H5_PREPARED');
        setState({
          kind: 'ready',
          source,
          version: null,
        });
      })
      .catch((e: unknown) => {
        if (mounted) {
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      mounted = false;
      clearHandshakeTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webViewKey]);

  // 后台更新检查：有可用版本则下载并激活，成功后刷新 WebView 使用新包。
  // 本次启动仍用旧包（WebView 已按旧入口渲染），冷启动后 resolveH5Source 取新入口。
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const check = await runtimeRef.current.checkForUpdate();
        if (!check.available || cancelled) {
          return;
        }
        await runtimeRef.current.update();
        if (!cancelled) {
          logger.log({
            event: 'h5_update_applied',
            h5Version: check.manifest?.version,
          });
          setWebViewKey(k => k + 1);
        }
      } catch (e) {
        logger.log({
          event: 'h5_update_failed',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [webViewKey]);

  const handleReady = useCallback(
    (info: { h5Version?: string; bridgeVersion?: string }) => {
      clearHandshakeTimer();
      runtimeRef.current.markReady().catch(() => {});
      apply('H5_READY');
      apply('RUNNING');
      logger.log({
        event: 'h5_ready',
        h5Version: info.h5Version,
        bridgeVersion: info.bridgeVersion,
        platform: 'app',
      });
    },
    [apply, clearHandshakeTimer],
  );

  const handleLoadEnd = useCallback(() => {
    apply('WEBVIEW_LOADED');
    apply('HANDSHAKE_START');
    clearHandshakeTimer();
    timerRef.current = setTimeout(() => {
      apply('ERROR');
      logger.log({ event: 'h5_boot_timeout', errorCode: 'H5_BOOT_TIMEOUT' });
    }, handshakeTimeoutMs);
  }, [apply, clearHandshakeTimer, handshakeTimeoutMs]);

  const handleReload = useCallback(() => {
    clearHandshakeTimer();
    machineRef.current = new BootStateMachine();
    setBootState('BOOT');
    setState({ kind: 'loading' });
    setWebViewKey(k => k + 1);
  }, [clearHandshakeTimer]);

  if (state.kind === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>H5 启动失败：{state.message}</Text>
      </View>
    );
  }

  if (bootState === 'ERROR_RECOVERY') {
    return (
      <DiagnosticPage
        version={state.version}
        networkType={networkType}
        errorCode="H5_BOOT_TIMEOUT"
        onReload={handleReload}
        onUsePrevious={handleReload}
      />
    );
  }

  return (
    <WebViewBridge
      key={webViewKey}
      source={state.source}
      capabilities={capabilities}
      lifecycle={{ onReady: handleReady }}
      trustedOrigins={[allowedOrigin]}
      onLoadEnd={handleLoadEnd}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f7',
  },
  error: {
    color: '#b00020',
    fontSize: 14,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
});
