/**
 * Copyright (c) 2025 Huawei Technologies Co., Ltd.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  RNPackageContext,
  RNOHPackage,
  TurboModuleContext,
  TurboModulesFactory,
  UITurboModuleContext,
} from '@rnoh/react-native-openharmony';
import { RNOHPackage as RNOHPackageBase } from '@rnoh/react-native-openharmony';
import { SafeAreaViewPackage } from '@react-native-ohos/react-native-safe-area-context';
import { BasePackage } from './base/BasePackage';
import { createRNOHPackages as createRNOHPackagesAutolinking } from './RNOHPackagesFactory';

/**
 * `react-native-safe-area-context` 的鸿蒙移植包只在 `package.json` 里写了
 * `harmony.alias`，没有 `harmony.autolinking`，所以 `react-native link-harmony`
 * 会 `[skip]` 它 —— `RNCSafeAreaContext` TurboModule 得在这里手工挂上。
 *
 * 不能直接 `new SafeAreaViewPackage(ctx)`：它是按 RNOH 0.72 时代的基类
 * `RNPackage`（现在已标 `@internal @deprecated`）写的，而 `getRNOHPackages` 的返回
 * 类型是新的 `RNOHPackage`（多了 `createWrappedCustomRNComponentBuilderByComponentNameMap`），
 * 直接塞进数组会 ArkTS 10505001 类型不兼容。这里只做一层组合：TurboModule 的创建
 * 完全交给移植包自己的 factory —— RNOH 0.84 的 `RNInstance` 仍会调用
 * `pkg.createTurboModulesFactory(...)`，行为与原生注册一致。
 */
class SafeAreaContextPackage extends RNOHPackageBase {
  private innerPackage: SafeAreaViewPackage;

  constructor(ctx: RNPackageContext) {
    super(ctx);
    this.innerPackage = new SafeAreaViewPackage(ctx);
  }

  createTurboModulesFactory(ctx: UITurboModuleContext): TurboModulesFactory {
    return this.innerPackage.createTurboModulesFactory(ctx as TurboModuleContext);
  }

  getDebugName(): string | undefined {
    return 'SafeAreaContext';
  }
}

export function getRNOHPackages(ctx: RNPackageContext): RNOHPackage[] {
  return [
    ...createRNOHPackagesAutolinking(ctx),
    new SafeAreaContextPackage(ctx),
    new BasePackage(ctx),
  ];
}
