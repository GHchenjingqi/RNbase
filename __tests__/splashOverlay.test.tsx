/**
 * SplashOverlay（启动闪屏）行为锁定。
 *
 * 闪屏是用户每次冷启动看到的第一屏，错一点都很显眼：
 *  - 首帧就要显示正确的倒计时数字（3），不能从 0 或空白跳变；
 *  - 到时自动淡出并回调 onFinish，倒计时期间数字逐秒递减到 0 后隐藏；
 *  - 点击任意位置可跳过，同样走 onFinish；
 *  - durationMs <= 0 视为关闭闪屏，立即回调。
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SplashOverlay } from '../src/app/SplashOverlay';

const IMAGE = { uri: 'splash-default.jpg' } as const;

describe('SplashOverlay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const render = (durationMs: number, onFinish: () => void) =>
    ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <SplashOverlay durationMs={durationMs} imageSource={IMAGE} onFinish={onFinish} />
      );
    });

  const countdownText = (root: ReactTestRenderer.ReactTestRenderer) => {
    const node = root.root.findAll((n) => n.props.testID === 'splash-countdown')[0] as
      | ReactTestRenderer.ReactTestInstance
      | undefined;
    return node ? String(node.props.children) : null;
  };

  it('首帧显示 3，随后逐秒递减，到 0 后隐藏数字并回调 onFinish', async () => {
    const onFinish = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <SplashOverlay durationMs={3000} imageSource={IMAGE} onFinish={onFinish} />
      );
    });
    expect(countdownText(renderer)).toBe('3');

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(1100);
    });
    expect(countdownText(renderer)).toBe('2');

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(countdownText(renderer)).toBe('1');

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(1000);
    });
    // 淡出动画（300ms）完成后才回调。
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
    // 数字归 0 后不再显示「0」。
    expect(countdownText(renderer)).toBeNull();
  });

  it('点击任意位置跳过，同样走 onFinish', async () => {
    const onFinish = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SplashOverlay durationMs={3000} imageSource={IMAGE} onFinish={onFinish} />
      );
    });

    const pressable = renderer.root.findByProps({ accessibilityLabel: '跳过启动闪屏' });
    await ReactTestRenderer.act(async () => {
      pressable.props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('durationMs 为 0 视为关闭：立即淡出并回调', async () => {
    const onFinish = jest.fn();
    await render(0, onFinish);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('onFinish 只回调一次（淡出完成后重复触发被忽略）', async () => {
    const onFinish = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SplashOverlay durationMs={1000} imageSource={IMAGE} onFinish={onFinish} />
      );
    });
    // 到时自动结束。
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
    // 用户此时再点一下，不应产生第二次回调。
    const pressable = renderer.root.findByProps({ accessibilityLabel: '跳过启动闪屏' });
    await ReactTestRenderer.act(async () => {
      pressable.props.onPress();
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  // ── holdUntil / holdMaxMs：倒计时走完但 H5 首屏还没就绪时继续盖着，不露白屏 ──

  const hasLoading = (root: ReactTestRenderer.ReactTestRenderer) =>
    root.root.findAll((n) => n.props.testID === 'splash-loading').length > 0;

  const mountSplash = async (element: React.ReactElement) => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(element);
    });
    return renderer;
  };

  it('holdUntil 为真：倒计时走完不立即退场，转入等待态（数字隐藏、显示载入中）', async () => {
    const onFinish = jest.fn();
    const renderer = await mountSplash(
      <SplashOverlay durationMs={3000} imageSource={IMAGE} onFinish={onFinish} holdUntil />
    );
    expect(hasLoading(renderer)).toBe(false);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(3100);
    });
    expect(onFinish).not.toHaveBeenCalled();
    expect(hasLoading(renderer)).toBe(true);
    // 等待态下不再显示倒计时数字
    expect(countdownText(renderer)).toBeNull();
  });

  it('等待中页面加载完成（holdUntil 转 false）→ 淡出并回调一次', async () => {
    const onFinish = jest.fn();
    const renderer = await mountSplash(
      <SplashOverlay durationMs={1000} imageSource={IMAGE} onFinish={onFinish} holdUntil />
    );
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1100);
    });
    expect(hasLoading(renderer)).toBe(true);
    expect(onFinish).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <SplashOverlay durationMs={1000} imageSource={IMAGE} onFinish={onFinish} holdUntil={false} />
      );
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('等待超时兜底：holdUntil 一直为真也会在 holdMaxMs 后退场（网络异常不卡死）', async () => {
    const onFinish = jest.fn();
    await mountSplash(
      <SplashOverlay
        durationMs={1000}
        imageSource={IMAGE}
        onFinish={onFinish}
        holdUntil
        holdMaxMs={2000}
      />
    );
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1100);
    });
    expect(onFinish).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('等待态下点击可立即跳过，不必等到 holdMaxMs', async () => {
    const onFinish = jest.fn();
    const renderer = await mountSplash(
      <SplashOverlay
        durationMs={1000}
        imageSource={IMAGE}
        onFinish={onFinish}
        holdUntil
        holdMaxMs={10000}
      />
    );
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1100);
    });
    expect(hasLoading(renderer)).toBe(true);

    const pressable = renderer.root.findByProps({ accessibilityLabel: '跳过启动闪屏' });
    await ReactTestRenderer.act(async () => {
      pressable.props.onPress();
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('倒计时进行中 holdUntil 变化不得重启倒计时（数字不回跳）', async () => {
    const onFinish = jest.fn();
    const renderer = await mountSplash(
      <SplashOverlay durationMs={3000} imageSource={IMAGE} onFinish={onFinish} holdUntil />
    );
    expect(countdownText(renderer)).toBe('3');

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(2100);
    });
    expect(countdownText(renderer)).toBe('1');

    // 页面提前加载完成：holdUntil 翻转只应影响「走完后是否等待」，不能让倒计时从头再来
    await ReactTestRenderer.act(async () => {
      renderer.update(
        <SplashOverlay durationMs={3000} imageSource={IMAGE} onFinish={onFinish} holdUntil={false} />
      );
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(countdownText(renderer)).toBe('1');

    // 已就绪 → 走完即退场
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('传入 appName 时居中叠加显示应用中文名；不传则不渲染文字', async () => {
    const onFinish = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SplashOverlay durationMs={3000} imageSource={IMAGE} onFinish={onFinish} appName="古韵诗笺" />
      );
    });
    const node = renderer.root.findByProps({ testID: 'splash-appname' });
    expect(node.props.children).toBe('古韵诗笺');

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <SplashOverlay durationMs={3000} imageSource={IMAGE} onFinish={onFinish} appName="" />
      );
    });
    expect(renderer.root.findAll((n) => n.props.testID === 'splash-appname').length).toBe(0);
  });
});
