/**
 * App 组合根（规则 4/5/9/26/34）：启动状态机 -> 解析 H5 入口 -> 渲染 WebView + Bridge。
 *
 *  - 启动状态机贯穿 BOOT -> ... -> RUNNING（规则 34）
 *  - H5 发送 app.ready 完成握手，标记版本 stable（规则 9）
 *  - 握手超时 / 加载失败 -> ERROR_RECOVERY -> 诊断页（规则 26）
 *  - 解析失败：错误态，可重试
 *
 * 「基座 + URL」容器模式（version.json 的 remoteUrl 非空，见 config 的 IS_REMOTE_H5）：
 * 入口就是那个站点，不等握手（加载完成即 RUNNING）、不跑 H5 子包更新、不注入 Bridge，
 * 信任域收窄到站点自身。本地 H5 模式下以上分支全部不生效。
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
import {
  DOMAIN_WHITELIST,
  HANDSHAKE_TIMEOUT_MS,
  IS_REMOTE_H5,
  REMOTE_H5_ORIGIN,
  REMOTE_H5_URL,
} from '../config';
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
    resolveH5Source(runtimeRef.current, FALLBACK_H5_HTML, REMOTE_H5_URL)
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
  // 远程模式下整段跳过：页面在站点那边，本地没有可激活的子包，跑一次只会白拉 manifest 并可能换 key 重载。
  useEffect(() => {
    if (IS_REMOTE_H5) {
      return;
    }
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
    if (IS_REMOTE_H5) {
      // 远程站点不实现本基座的 Bridge 协议，永远不会发 app.ready；
      // 起了定时器就是 10s 后必进诊断页。加载完成即视为就绪。
      apply('H5_READY');
      apply('RUNNING');
      logger.log({ event: 'remote_h5_loaded', message: String(REMOTE_H5_URL) });
      return;
    }
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
      // 远程模式只信任站点自身：域内跳转留在 WebView，域外一律走系统浏览器（不继承容器权限）。
      trustedOrigins={REMOTE_H5_ORIGIN ? [REMOTE_H5_ORIGIN] : [allowedOrigin]}
      // 远程模式不注入 Bridge：站点是第三方 origin，给它 window.ReactNativeWebView 就等于
      // 把相机/文件/定位/剪贴板/系统设置这些原生能力面交给那个域，域名或内容一旦被换掉就是攻击面。
      bridgeEnabled={!IS_REMOTE_H5}
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
