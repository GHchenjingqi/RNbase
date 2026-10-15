/**
 * 返回键兜底策略单测（src/webview/back-policy.ts）。
 *
 * 锁住三条不变量，它们对应真机上三类必现缺陷：
 *  1. WebView 还有历史时必须回退，不能碰退出逻辑（否则子页面按一次就退出 App）；
 *  2. 退无可退的第一次按键**不允许**退出，只能提示（误触不能杀 App）；
 *  3. 只有确认窗口内再按一次才真正退出。
 */
import { EXIT_CONFIRM_WINDOW_MS, createBackCoordinator } from '../../src/webview/back-policy';

function createHarness(goBackIfPossible: () => Promise<boolean>) {
  let t = 0;
  const exits: number[] = [];
  const coordinator = createBackCoordinator({
    goBackIfPossible,
    exit: () => exits.push(t),
    now: () => t,
  });
  return {
    coordinator,
    exits,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('返回键兜底策略', () => {
  test('确认窗口钉死为 2s（改小等于把误触即退出又放回来）', () => {
    expect(EXIT_CONFIRM_WINDOW_MS).toBe(2000);
  });

  test('WebView 能回退：回退页面，绝不退出', async () => {
    const { coordinator, exits } = createHarness(async () => true);
    for (let i = 0; i < 5; i++) {
      await expect(coordinator.handle()).resolves.toBe('page-back');
    }
    expect(exits).toEqual([]);
  });

  test('退无可退的第一次按键只提示，不退出', async () => {
    const { coordinator, exits } = createHarness(async () => false);
    await expect(coordinator.handle()).resolves.toBe('exit-confirm');
    expect(exits).toEqual([]);
  });

  test('窗口内再按一次才退出，且只退一次', async () => {
    const { coordinator, exits, advance } = createHarness(async () => false);
    await coordinator.handle();
    advance(EXIT_CONFIRM_WINDOW_MS);
    await expect(coordinator.handle()).resolves.toBe('exit');
    expect(exits).toHaveLength(1);

    // 退出后状态复位：下一次又回到「先提示」
    await expect(coordinator.handle()).resolves.toBe('exit-confirm');
    expect(exits).toHaveLength(1);
  });

  test('超过窗口的第二次按键只是重新提示，不退出', async () => {
    const { coordinator, exits, advance } = createHarness(async () => false);
    await coordinator.handle();
    advance(EXIT_CONFIRM_WINDOW_MS + 1);
    await expect(coordinator.handle()).resolves.toBe('exit-confirm');
    expect(exits).toEqual([]);
  });

  test('中途回退过页面会复位二次确认（提示过期作废）', async () => {
    let canGoBack = false;
    const { coordinator, exits } = createHarness(async () => canGoBack);
    await expect(coordinator.handle()).resolves.toBe('exit-confirm');
    canGoBack = true;
    await expect(coordinator.handle()).resolves.toBe('page-back');
    canGoBack = false;
    await expect(coordinator.handle()).resolves.toBe('exit-confirm');
    expect(exits).toEqual([]);
  });

  test('原生查询失败时按「退不了」处理：只提示，不退出', async () => {
    const { coordinator, exits } = createHarness(async () => {
      throw new Error('WEBVIEW_BACK_FAILED');
    });
    await expect(coordinator.handle()).resolves.toBe('exit-confirm');
    expect(exits).toEqual([]);
  });

  test('reset 可清掉二次确认（WebView 重载等场景）', async () => {
    const { coordinator, exits } = createHarness(async () => false);
    await coordinator.handle();
    coordinator.reset();
    await expect(coordinator.handle()).resolves.toBe('exit-confirm');
    expect(exits).toEqual([]);
  });
});
