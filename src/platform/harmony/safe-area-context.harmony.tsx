/**
 * 鸿蒙侧的 `react-native-safe-area-context` 替身（metro 在 platform=harmony 时指向本文件）。
 *
 * 官方移植包 `@react-native-ohos/react-native-safe-area-context` 的 JS 组件要渲染同名原生组件
 * `RNCSafeAreaProvider`，而移植包的 ArkTS 侧仍按 RNOH 0.72 的组件 ABI 编写（没有
 * `createWrappedCustomRNComponentBuilderByComponentNameMap`）。0.84 的 C-API 侧会报
 * `Couldn't find ComponentJSIBinder for: RNCSafeAreaProvider`，整棵子树渲染不出来（白屏）。
 * 基座只用 `SafeAreaProvider` 与 `useSafeAreaInsets`，所以这里用纯 JS 容器直接读窗口避让区。
 *
 * 取值优先级（实测结论，别再退回第一条）：
 *  1. RNOH 自带的 `SafeAreaTurboModule.getInitialInsets()`：ArkTS 侧 `create()` 里
 *     `await ctx.safeAreaInsetsProvider.ready`，合并了 TYPE_SYSTEM + TYPE_CUTOUT +
 *     TYPE_NAVIGATION_INDICATOR，单位 vp（WebView 内 1 vp ≈ 1 CSS px），并且会在
 *     `SAFE_AREA_INSETS_CHANGE` 设备事件里推后续变化（旋转 / 状态栏显隐）。
 *  2. 移植包的 `RNCSafeAreaContext`：它的 `initWindowInstance()` 是 async 且没人 await，
 *     `getConstants()` 在 JS 模块初始化时窗口实例还是 null → 返回硬编码全 0；
 *     它的 `getSafeAreaInsets()` 根本没进 codegen binder，JS 侧调不到。留着只当兜底。
 */
import React, { useEffect, useState } from 'react';
import { DeviceEventEmitter, TurboModuleRegistry } from 'react-native';
import { deviceLogger } from '../../diagnostics/device-logger';

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

type AnyTurboModule = {
  getInitialInsets?: () => unknown;
  getConstants?: () => unknown;
};

const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** RNOH 推送避让区变化的设备事件名（SafeAreaTurboModule.onSafeAreaChange）。 */
const INSETS_EVENT = 'SAFE_AREA_INSETS_CHANGE';

/** 接受 `{top,left,right,bottom}` 或 `{insets:{...}}` 两种形状，拿不到有效数值返回 null。 */
function normalizeInsets(raw: unknown): EdgeInsets | null {
  const holder = (raw ?? {}) as { insets?: Partial<EdgeInsets> } & Partial<EdgeInsets>;
  const src = (holder.insets ?? holder) as Partial<EdgeInsets>;
  const pick = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const top = pick(src.top);
  const right = pick(src.right);
  const bottom = pick(src.bottom);
  const left = pick(src.left);
  if (top === null || right === null || bottom === null || left === null) {
    return null;
  }
  return { top, right, bottom, left };
}

function readInsetsFromNative(): EdgeInsets | null {
  try {
    const safeArea = TurboModuleRegistry.get('SafeAreaTurboModule') as AnyTurboModule | null;
    const fromRnoh = normalizeInsets(safeArea?.getInitialInsets?.());
    if (fromRnoh) {
      return fromRnoh;
    }
    const legacy = TurboModuleRegistry.get('RNCSafeAreaContext') as AnyTurboModule | null;
    const constants = legacy?.getConstants?.() as { initialWindowMetrics?: unknown } | undefined;
    return normalizeInsets(constants?.initialWindowMetrics);
  } catch {
    return null;
  }
}

const SafeAreaInsetsContext = React.createContext<EdgeInsets>(ZERO_INSETS);

export function SafeAreaProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [insets, setInsets] = useState<EdgeInsets>(() => readInsetsFromNative() ?? ZERO_INSETS);

  useEffect(() => {
    const apply = (next: EdgeInsets | null) => {
      if (next) {
        setInsets(next);
      }
    };
    const sub = DeviceEventEmitter.addListener(INSETS_EVENT, (payload: unknown) => {
      apply(normalizeInsets(payload));
    });
    // 首帧可能在窗口避让区就绪前取到空值，挂载后再主动读一次；仍拿不到就打日志，
    // 免得症状退化成「导航栏和状态栏重叠」这种没人知道为什么的问题。
    const next = readInsetsFromNative();
    if (next) {
      apply(next);
    } else {
      deviceLogger.warn(
        'safeArea.harmony=no-insets（SafeAreaTurboModule 与 RNCSafeAreaContext 都没给出数值）',
      );
    }
    return () => sub.remove();
  }, []);

  return <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>;
}

export function useSafeAreaInsets(): EdgeInsets {
  return React.useContext(SafeAreaInsetsContext);
}
