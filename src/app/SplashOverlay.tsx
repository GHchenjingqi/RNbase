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
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
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
}

export function SplashOverlay({ durationMs, imageSource, onFinish }: SplashOverlayProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const finishedRef = useRef(false);
  // 初始值直接算好，首帧就显示「3」而不是从 0 跳变。
  const [remainingSec, setRemainingSec] = useState(() => Math.ceil(durationMs / 1000));

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
        finish();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [durationMs, finish]);

  return (
    <Animated.View style={[styles.root, { opacity }]} testID="splash-overlay">
      <Pressable style={styles.fill} onPress={finish} accessibilityLabel="跳过启动闪屏">
        <Image source={imageSource} style={styles.fill} resizeMode="cover" />
        {remainingSec > 0 ? (
          <Text style={styles.countdown} testID="splash-countdown">
            {remainingSec}
          </Text>
        ) : null}
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
  countdown: {
    position: 'absolute',
    bottom: '10%',
    alignSelf: 'center',
    fontSize: 44,
    lineHeight: 52,
    // 深灰蓝：在浅色渐变闪图上够清楚，又不像纯黑那么生硬。
    color: '#6B7280',
  },
});
