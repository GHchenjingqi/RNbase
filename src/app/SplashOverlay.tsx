/**
 * 启动闪屏（RN 跨端实现，三端表现一致）。
 *
 * 职责：全屏展示默认闪图 + 倒计时数字，到时或点击后淡出并回调 onFinish。
 * 在 App 组合根里盖在最上层，WebView 在其下方继续装载——闪屏期间 H5 加载不空转，
 * 结束时直接露出已就绪（或仍在加载）的页面，不额外等待。
 *
 * 为什么不用原生 SplashActivity：三端各写一套（安卓 Kotlin 计时 + 鸿蒙启动窗口 +
 * iOS LaunchScreen 做不了倒计时）行为难一致；RN 层一份实现 + version.json 一个
 * 时长字段（splashDurationMs，见 src/config 的 SPLASH_DURATION_MS）就够了。
 * 原生 windowBackground（colors.xml 的 splash_bg）只负责遮盖 RN 装载前的空白，
 * 颜色与闪图同系，衔接处不闪白。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

/** 淡出动画时长：退场别太急，也不能拖慢进入正题。 */
const FADE_OUT_MS = 300;
/** 倒计时刷新间隔：显示秒级数字，200ms 轮询足够平滑且省电。 */
const TICK_MS = 200;

export interface SplashOverlayProps {
  /** 总时长（毫秒）；<=0 立即淡出（相当于关闭闪屏）。 */
  durationMs: number;
  /** 全屏闪图资源。 */
  imageSource: ImageSourcePropType;
  /** 闪屏结束（淡出完成）后回调；点击跳过同样走这里。只回调一次。 */
  onFinish: () => void;
  /**
   * 闪屏底色：填充闪图 contain 显示后的留白区域（取 version.json 的
   * splashBackgroundColor，与闪图背景同系时视觉无缝，任意屏幕比例不裁不变形）。
   */
  backgroundColor?: string;
  /**
   * 倒计时走完后是否继续等待（默认 false）。
   * true = 页面还没加载好就继续盖着闪屏，显示「正在载入」而不是露出白屏；
   * 变为 false（或超过 holdMaxMs 兜底）才淡出。
   */
  holdUntil?: boolean;
  /** 等待阶段的兜底上限（毫秒），避免网络异常时一直卡在闪屏。 */
  holdMaxMs?: number;
}

export function SplashOverlay({
  durationMs,
  imageSource,
  onFinish,
  holdUntil = false,
  holdMaxMs = 8000,
  backgroundColor = '#EAEFF7',
}: SplashOverlayProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const finishedRef = useRef(false);
  // 初始值直接算好，首帧就显示「3」而不是从 0 跳变。
  const [remainingSec, setRemainingSec] = useState(() => Math.ceil(durationMs / 1000));
  // 倒计时已走完、但页面还没就绪：进入等待态（显示载入中，不露出白屏）
  const [waiting, setWaiting] = useState(false);
  // 用 ref 读最新的 holdUntil：它只决定「倒计时走完后是等待还是退场」，
  // 若直接进倒计时 effect 的依赖，页面中途加载完会让 effect 重跑、startedAt 重置
  // → 倒计时从头再数一遍（数字回跳）。
  const holdUntilRef = useRef(holdUntil);
  useEffect(() => {
    holdUntilRef.current = holdUntil;
  }, [holdUntil]);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    Animated.timing(opacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(
      () => onFinish()
    );
  }, [onFinish, opacity]);

  useEffect(() => {
    if (durationMs <= 0) {
      finish();
      return undefined;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const left = durationMs - (Date.now() - startedAt);
      setRemainingSec(Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) {
        clearInterval(timer);
        // 倒计时结束：页面已就绪就直接退场，否则进入等待态继续盖着白屏
        if (holdUntilRef.current) setWaiting(true);
        else finish();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [durationMs, finish]);

  // 等待态：holdUntil 转 false（页面加载完成）即退场；超时兜底也要退场，
  // 否则网络异常时会永远卡在闪屏上。
  useEffect(() => {
    if (!waiting) return undefined;
    if (!holdUntil) {
      finish();
      return undefined;
    }
    const cap = setTimeout(() => finish(), holdMaxMs);
    return () => clearTimeout(cap);
  }, [waiting, holdUntil, holdMaxMs, finish]);

  return (
    <Animated.View style={[styles.root, { opacity }]} testID="splash-overlay">
      <Pressable style={styles.fill} onPress={finish} accessibilityLabel="跳过启动闪屏">
        {/* 底色铺满全屏（pointerEvents=none 让点击穿透到 Pressable）：
            内容缩放后四周露出的区域仍是底色，不会漏出底下 WebView 造成闪白 */}
        <View style={[styles.fill, { backgroundColor }]} pointerEvents="none" />
        {/* 内容整体缩小 1/2、保持居中（位置不变）：badge / 图 / 文案按各自原始布局等比缩到一半。
            pointerEvents=none 保证整屏任意位置仍可点击跳过 */}
        <View style={styles.scaledContent} pointerEvents="none">
          {/* contain 完整显示：cover 在宽屏手机上会按高度撑满、左右裁切，
              宽幅设计稿的两端（如大字标语）会被切掉；留白由底色补齐，视觉无缝 */}
          <Image source={imageSource} style={styles.fill} resizeMode="contain" />
          {waiting ? (
            <View style={styles.loadingBox} testID="splash-loading">
              <ActivityIndicator size="small" color="#6B7280" />
              <Text style={styles.loadingText}>正在翻开诗卷…</Text>
            </View>
          ) : remainingSec > 0 ? (
            <View style={styles.countdownBadge} testID="splash-countdown-badge">
              <Text style={styles.countdownText} testID="splash-countdown">
                {remainingSec}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // 盖过 WebView 与错误页；elevation 保证安卓上也在同层之上。
    zIndex: 10,
    elevation: 10,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  // 内容层：整层等比缩到 1/2，transform origin 默认视图中心 -> 缩向中心、位置不变、
  // 四周留出底色。里面 Image/badge 全部跟随缩放。
  scaledContent: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ scale: 0.5 }],
  },
  // 倒计时：右上角黑色圆形角标，白字、缩小字号，避开中部的应用名。
  // 整体半透明（0.5）：用户要求「倒计时改成半透明」。
  countdownBadge: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#000000',
    opacity: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 26,
  },
  // 等待态：倒计时走完但页面还没加载好时显示，避免露出白屏
  loadingBox: {
    position: 'absolute',
    bottom: '10%',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
});
