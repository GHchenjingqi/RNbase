/**
 * Base Mobile App 入口（组合根）。
 *
 * 权限体系与 Bridge 由子模块承载；此处仅做生命周期容器与组合装配，
 * H5 业务运行时通过 WebView 加载（规则 4：业务代码不外溢到 RN）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PermissionManagerProvider } from './src/permissions/PermissionProvider';
import { WebViewBridge } from './src/webview/WebViewBridge';
import { WebViewErrorPage } from './src/webview/WebViewErrorPage';
import { getH5EntryUri } from './src/app/resolve-h5-entry';
import { resolveH5Source } from './src/app/resolve-h5-source';
import { createRealRuntime } from './src/app/create-real-runtime';
import {
  CRASH_REPORT_ENDPOINT,
  DOMAIN_WHITELIST,
  DROPPED_TRUSTED_DOMAINS,
  H5_DEV_SERVER_URL,
  H5_MANIFEST_URL,
  HANDSHAKE_TIMEOUT_MS,
  IS_REMOTE_H5,
  REMOTE_H5_URL,
  SPLASH_BG_COLOR,
  SPLASH_DURATION_MS,
  STATUS_BAR_STYLE,
  validateClientIds,
} from './src/config';
import { logger } from './src/diagnostics/logger';
import { runHarmonyNativeSelfTest } from './src/diagnostics/harmony-native-self-test';
import {
  installGlobalErrorHandlers,
  setCrashUploader,
  createHttpCrashUploader,
} from './src/diagnostics/crash-reporter';
import { deviceLogger } from './src/diagnostics/device-logger';
import { currentOs } from './src/platform/os';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { SplashOverlay } from './src/app/SplashOverlay';
import { setH5BarStyleListener } from './src/bridge/modules/statusbar';
import type { BarStyle } from './src/bridge/modules/statusbar';
import splashDefaultImage from './src/assets/splash/splash-default.jpg';
import { SPLASH_ACTIVE } from './src/assets/splash/active';

// H5 入口三条路（开关是 version.json 的 remoteUrl，见 README「基座 + URL（远程站点模式）」）：
//  - 远程模式：入口就是那个站点，不读内置 assets，也不给第三方 origin 注入 Bridge
//    （window.ReactNativeWebView 一给出去，相机/文件/定位/剪贴板就成了它的攻击面）。
//  - 本地模式且已激活 H5 子包：入口是那个子包（OTA 热更新落地的产物，见下方后台更新检查）。
//  - 本地模式且无激活子包：按平台取 APK/HAP/iOS bundle 内置资源 ——
//      · 安卓：file:///android_asset/index.html
//      · iOS：file://{App bundle}/h5/index.html（由原生 H5BundleBasePath 暴露，需 Xcode 加 folder reference）
//      · 鸿蒙：asset://h5/index.html（rawfile）
//    三条都解析不出来（如 iOS 未打包 h5）时返回 null，下方渲染「配置缺失」错误页。
export default function App() {
  const isDarkMode = useColorScheme() === 'dark';
  // 本地模式的入口要先问一次原生「有没有已激活的子包」，所以入口是异步解析的：
  // entryPending 期间不渲染错误页（否则冷启动会闪一下「配置缺失」）。
  const [h5Uri, setH5Uri] = useState<string | null>(REMOTE_H5_URL);
  const [entryPending, setEntryPending] = useState(REMOTE_H5_URL === null);
  // 换 key = 重新解析入口。OTA 激活新包后靠它让 WebView 用上新入口。
  const [entryKey, setEntryKey] = useState(0);
  const isRemote = REMOTE_H5_URL !== null;
  // H5 子包运行时（下载/校验/激活/回滚）。懒建一次：原生 BaseH5 缺失时它自己降级。
  const runtimeRef = useRef<ReturnType<typeof createRealRuntime> | null>(null);
  const getRuntime = useCallback(() => {
    if (!runtimeRef.current) {
      runtimeRef.current = createRealRuntime();
    }
    return runtimeRef.current;
  }, []);
  // 刚被 OTA 激活、还没在设备上跑通过的新子包：等它发 app.ready（规则 9）。
  // 超时不发就 markFailed()（规则 8）—— 原生把 current 指针退回上一版，再换 entryKey
  // 重新解析入口，用户回到还能用的旧包，而不是永远白屏的新包。
  // 只在这一窗口计时：内置包和远程站点都没有回滚对象，计时只会误伤。
  const [awaitHandshake, setAwaitHandshake] = useState(false);
  const handshakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHandshake = useCallback(() => {
    if (handshakeTimer.current) {
      clearTimeout(handshakeTimer.current);
      handshakeTimer.current = null;
    }
  }, []);
  const failPendingVersion = useCallback(() => {
    handshakeTimer.current = null;
    setAwaitHandshake(false);
    logger.log({ event: 'h5_handshake_timeout', errorCode: 'H5_BOOT_TIMEOUT' });
    getRuntime()
      .markFailed()
      .catch(() => {
        // 回滚失败（无上一版可退）也要换入口，否则页面就停在坏包上不动了。
      })
      .then(() => setEntryKey(k => k + 1));
  }, [getRuntime]);
  useEffect(() => clearHandshake, [clearHandshake]);
  // barStyle 仲裁，优先级：H5 Bridge 接管 > version.json 的 statusBarStyle（远程模式
  // 没有 Bridge，只能靠配置声明）> 系统深浅色。远程模式无 Bridge，天然只有后两级。
  const [h5BarStyle, setH5BarStyle] = useState<BarStyle | null>(null);
  // 启动闪屏：盖在 WebView 上面倒数 3 秒（点击可跳过），期间 H5 在底下照常装载。
  // SPLASH_DURATION_MS 为 0 时直接不渲染（关闭闪屏）。
  const [splashVisible, setSplashVisible] = useState(SPLASH_DURATION_MS > 0);
  // 页面是否已完成首次加载。闪屏倒计时结束后若页面还没好，
  // 闪屏继续盖着（显示「正在翻开诗卷…」），避免露出 WebView 的白屏。
  const [h5Loaded, setH5Loaded] = useState(false);
  const handleH5Loaded = useCallback(() => {
    setH5Loaded(true);
    // 待验证的新子包加载完了但还没握手：从这一刻起算期限（页面没加载完就计时只会误判网络慢）。
    if (awaitHandshake && !handshakeTimer.current) {
      handshakeTimer.current = setTimeout(failPendingVersion, HANDSHAKE_TIMEOUT_MS);
    }
  }, [awaitHandshake, failPendingVersion]);
  // 首次加载进度（0~1，仅远程站点模式用于细化就绪判定）。
  const [h5Progress, setH5Progress] = useState(0);
  const handleH5Progress = useCallback((p: number) => setH5Progress(p), []);
  // 远程站点模式：onLoadEnd 在主资源（HTML）到达即触发，远早于 SPA 的 JS/CSS/图片
  // 加载完与首屏绘制；若此刻退场会露出尚未绘制的白屏，再等 1~2s 才出现 H5 自身「加载中」。
  // 故远程模式额外要求进度接近完成（>=0.99）才认为就绪；本地离线包 onLoadEnd≈首屏，
  // 沿用原判定。holdMaxMs 兜底，进度异常停滞也不会永远卡在闪屏。
  const h5FullyReady = isRemote ? h5Loaded && h5Progress >= 0.99 : h5Loaded;
  useEffect(() => {
    setH5BarStyleListener(style => setH5BarStyle(style));
    return () => setH5BarStyleListener(null);
  }, []);

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

  // clientId 校验：只查当前运行端（另一端还是占位值，跟这台设备无关）。
  useEffect(() => {
    const missing = validateClientIds(currentOs());
    if (missing.length > 0) {
      const msg = `[config] CLIENT_ID 未配置：${missing.join(
        ', ',
      )}（占位值将导致对应端登录被后端拒绝）`;
      console.error(msg);
      deviceLogger.error(msg);
    }
  }, []);

  // 信任域配置自检：写法不对的条目已被 src/config 丢弃，这里留一条日志。
  // 为什么必须留痕：手工改的 version.json 不走 apply-app-meta 的校验，写成
  // `https://x.com/app`（带 path）会被静默丢掉，表现为「配了白名单，页面照样被弹到系统浏览器」。
  useEffect(() => {
    if (DROPPED_TRUSTED_DOMAINS.length > 0) {
      const msg = `[config] trustedDomains 被拒的条目：${DROPPED_TRUSTED_DOMAINS.join(
        ', ',
      )}（只接受 scheme://host[:port]，不带 path/query/尾斜杠）`;
      console.error(msg);
      deviceLogger.error(msg);
    }
  }, []);

  // 入口解析（三条路见 resolve-h5-source）：这一层是 OTA 能生效的关键。
  useEffect(() => {
    let cancelled = false;
    setEntryPending(true);
    resolveH5Source({
      runtime: getRuntime(),
      remoteUrl: REMOTE_H5_URL,
      builtinEntry: getH5EntryUri(),
    })
      .then(source => {
        if (cancelled) {
          return;
        }
        setH5Uri(source ? source.uri : null);
        setEntryPending(false);
      })
      .catch(() => {
        if (!cancelled) {
          // 原生查询失败不能让启动卡住：退回内置资源，解析不出来再走错误页。
          setH5Uri(REMOTE_H5_URL ?? getH5EntryUri());
          setEntryPending(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey]);

  // 后台 H5 子包更新：有可用版本则下载校验并激活，成功后换 entryKey 让 WebView 用新入口。
  // 三种情况整段跳过：
  //  - 远程模式：页面在站点那边，本地没有可激活的子包；
  //  - debug 直连本机 H5（H5_DEV_SERVER_URL）：入口就是宿主机源码、保存即生效，
  //    拉子包激活只会把 WebView 重载到比源码旧的包上，跟开发反馈循环打架
  //    （这条也是「debug 期隐藏热更新」的落点——不是藏 UI，是这条链路压根不启动）；
  //  - 没配 manifestUrl：整条 OTA 关闭，不白跑一次网络请求。
  //
  // 依赖是空的（只在挂载时跑一次），不能跟着 entryKey 走：激活成功会 +1 换入口，
  // 若本效也重跑就变成「检查 → 下载 → 换入口 → 再检查」；一旦清单还没反映新状态，
  // 就是一个反复重载 WebView 的循环。真机的下一次检查自然是下一次冷启动。
  useEffect(() => {
    if (IS_REMOTE_H5 || H5_DEV_SERVER_URL || !H5_MANIFEST_URL) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const check = await getRuntime().checkForUpdate();
        if (!check.available || cancelled) {
          return;
        }
        await getRuntime().update();
        if (!cancelled) {
          logger.log({ event: 'h5_update_applied', h5Version: check.manifest?.version });
          setAwaitHandshake(true);
          setEntryKey(k => k + 1);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // H5 发 app.ready = 这一版子包跑通了，标记 stable（规则 9）；
  // 不接这一下，激活过的版本永远停在「未验证」，回滚判定就没有依据。
  const handleH5Ready = useCallback(() => {
    clearHandshake();
    setAwaitHandshake(false);
    getRuntime()
      .markReady()
      .catch(() => {});
  }, [clearHandshake, getRuntime]);

  // WebViewBridge 把 source / lifecycle / trustedOrigins 都当作「重建 Bridge 通道」的依赖，
  // 所以这三样必须引用稳定：h5Uri 不变时 source 不能每渲染换一个新对象，
  // lifecycle 也不能每渲染换一个新函数（否则每次 App 重渲染都换掉 server）。
  const webSource = useMemo(() => ({ uri: h5Uri ?? '' }), [h5Uri]);
  const lifecycle = useMemo(() => ({ onReady: handleH5Ready }), [handleH5Ready]);

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={h5BarStyle ?? STATUS_BAR_STYLE ?? (isDarkMode ? 'light-content' : 'dark-content')}
      />
      <PermissionManagerProvider>
        <AppErrorBoundary>
          {h5Uri ? (
            // trustedOrigins 一律给全量 DOMAIN_WHITELIST（含 version.json 的 trustedDomains +
            // 远程 origin + dev 端口）。以前远程模式只传 [REMOTE_H5_ORIGIN]，等于把子应用自己
            // 声明的 trustedDomains 丢掉：第二个域（支付页、CDN 站点）会被弹到系统浏览器，
            // 而 app.config.json 里配它的人完全看不出原因。
            // 放宽的只是「导航放行」；原生能力面仍由 bridgeEnabled={!isRemote} 关着，
            // 远程站点拿不到 window.ReactNativeWebView。
            <WebViewBridge
              key={h5Uri}
              source={webSource}
              bridgeEnabled={!isRemote}
              trustedOrigins={DOMAIN_WHITELIST}
              lifecycle={lifecycle}
              onLoadEnd={handleH5Loaded}
              onLoadProgress={handleH5Progress}
            />
          ) : entryPending ? null : (
            <WebViewErrorPage
              error={{
                type: 'config',
                message:
                  'iOS 本地 H5 尚未打包：请在 Xcode 中将 h5/ 作为 folder reference 加入 App target，或配置远程站点模式（version.json 的 remoteUrl）。',
              }}
              onReload={() => setEntryKey(k => k + 1)}
            />
          )}
        </AppErrorBoundary>
      </PermissionManagerProvider>
      {splashVisible ? (
        <SplashOverlay
          durationMs={SPLASH_DURATION_MS}
          imageSource={SPLASH_ACTIVE ?? splashDefaultImage}
          backgroundColor={SPLASH_BG_COLOR}
          // 倒计时走完但页面尚未加载完时继续等待（最多 8s），不露出白屏。
          // 远程模式要求进度接近完成才视为就绪，消除「HTML 已到、首屏未绘」的 1~2s 白屏。
          holdUntil={!h5FullyReady}
          holdMaxMs={8000}
          onFinish={() => setSplashVisible(false)}
        />
      ) : null}
    </SafeAreaProvider>
  );
}
