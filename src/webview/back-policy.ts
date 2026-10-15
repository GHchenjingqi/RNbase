/**
 * 硬件返回键的容器侧兜底策略（WebViewBridge 的 BackHandler 逻辑，规范 §4/§9）。
 *
 * 决策分两级，优先级从高到低：
 *  1. H5 决策：本地（离线包）模式推 `native.back` 事件，H5 用 `app.nativeBackResult`
 *     回执 consumed —— 关弹层、退路由、退出确认都由页面说了算；
 *  2. 容器兜底（本模块）：H5 回执 consumed=false、超时未回执，或远程（基座 + URL）模式
 *     压根没有 Bridge 通道时 —— 先问 WebView 还有没有历史，有就回退一步；
 *     退无可退**不立刻退出**，而是要求 2 秒内再按一次（避免一次误触杀掉 App）。
 *
 * 为什么「退无可退」不能直接退出：套壳网站里大量页面是不写 history 的（纯组件切换的 SPA），
 * 或者写的是 replaceState，WebView 里只有一条历史。此时按返回键即等价于「退出 App」——
 * 这是真机必现且用户无法理解的行为。二次确认把「误触即退出」变成「明确要退才退」。
 */

/** 「再按一次退出应用」的确认窗口（毫秒）。窗口内再按一次才真正退出。 */
export const EXIT_CONFIRM_WINDOW_MS = 2000;

/** 一次返回键的兜底结论。 */
export type BackOutcome =
  /** 已在 WebView 内回退一步（页面历史前进），容器不动。 */
  | 'page-back'
  /** 退无可退，已提示「再按一次退出应用」，等待窗口内的第二次按键。 */
  | 'exit-confirm'
  /** 退无可退且窗口内再次按下，已调用退出。 */
  | 'exit';

export type BackCoordinatorDeps = {
  /**
   * 尝试让容器内的 WebView 回退一步。
   * @returns true = 已回退；false = 当前没有可回退的历史。
   */
  goBackIfPossible: () => Promise<boolean>;
  /** 退出容器（Android/iOS 走 BackHandler.exitApp，鸿蒙走 BaseSystem.exitApp）。 */
  exit: () => void;
  /** 取当前时间（毫秒），测试注入用。 */
  now?: () => number;
  /** 覆盖确认窗口，测试注入用。 */
  windowMs?: number;
};

export type BackCoordinator = {
  /** 处理一次返回键，返回兜底结论（调用方据此决定是否弹提示）。 */
  handle: () => Promise<BackOutcome>;
  /** 复位二次确认状态（首次按键的时间戳）。 */
  reset: () => void;
};

/**
 * 创建返回键兜底协调器。
 *
 * 关键不变量：`exit` 只在「同一确认窗口内被按了两次，且两次都没有可回退的历史」时调用。
 * 所以任何一层判断出错（原生查询失败、快照过期、H5 没回执）都不会一步退出 App。
 */
export function createBackCoordinator({
  goBackIfPossible,
  exit,
  now = Date.now,
  windowMs = EXIT_CONFIRM_WINDOW_MS,
}: BackCoordinatorDeps): BackCoordinator {
  let armedAt: number | null = null;

  return {
    async handle(): Promise<BackOutcome> {
      let canGoBack = false;
      try {
        canGoBack = await goBackIfPossible();
      } catch {
        // 原生查询失败按「退不了」处理：宁可多要一次确认，也不能误杀 App。
        canGoBack = false;
      }

      if (canGoBack) {
        armedAt = null;
        return 'page-back';
      }

      const t = now();
      if (armedAt !== null && t - armedAt <= windowMs) {
        armedAt = null;
        exit();
        return 'exit';
      }

      armedAt = t;
      return 'exit-confirm';
    },

    reset(): void {
      armedAt = null;
    },
  };
}
