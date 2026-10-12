/**
 * 平台判定工具。
 *
 * RN 的类型里 `Platform.OS` 是封闭联合（'ios' | 'android' | 'windows' | 'macos' | 'web'），
 * RNOH 在鸿蒙上注入的是字符串 'harmony'，不在该联合里：直接写 `Platform.OS === 'harmony'`
 * 会被 TS 判成「两种类型没有重叠的比较」（TS2367）而编译失败。所以所有鸿蒙分支都从这里取，
 * 只在这一处做一次类型放宽。
 */
import { Platform } from 'react-native';

/** 当前平台标识（鸿蒙下为 'harmony'，由 RNOH 注入）。 */
export function currentOs(): string {
  return Platform.OS as string;
}

export function isHarmony(): boolean {
  return currentOs() === 'harmony';
}

export function isIos(): boolean {
  return currentOs() === 'ios';
}
