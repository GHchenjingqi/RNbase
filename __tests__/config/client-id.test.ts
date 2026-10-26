/**
 * clientId 启动校验（src/config 的 validateClientIds）。
 *
 * 为什么单独立一份：这条校验跑在每次冷启动的 App.tsx 里，是设备日志第一行。
 * 早先它遍历全部三端，于是每一个安卓包都打一条 `CLIENT_ID 未配置：ios` 的 ERROR，
 * 既修不掉（iOS 的 id 要后端分配）又会把真故障淹在噪声里——现在只看当前运行端。
 */
import { CLIENT_ID, validateClientIds } from '../../src/config';

describe('validateClientIds 只校验当前运行端', () => {
  test('任何一端的判定结果都不掺入其他端（安卓启动不再因 iOS 占位值报错）', () => {
    ['android', 'ios', 'harmony', 'web'].forEach(platform => {
      expect(validateClientIds(platform).filter(p => p !== platform)).toEqual([]);
    });
  });

  test('安卓/鸿蒙已配置 → 该端启动无告警', () => {
    expect(validateClientIds('android')).toEqual([]);
    expect(validateClientIds('harmony')).toEqual([]);
  });

  test('iOS 仍是占位值 → 只有 iOS 启动时告警（platforms/ios/TODO.md #1 完成后同步改这条）', () => {
    expect(CLIENT_ID.ios).toBe('PLEASE_SET_IOS_CLIENT_ID');
    expect(validateClientIds('ios')).toEqual(['ios']);
  });

  test('未登记 clientId 的平台不校验，不返回一个查无此端的告警', () => {
    expect(validateClientIds('windows')).toEqual([]);
  });
});
