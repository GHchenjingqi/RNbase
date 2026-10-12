/**
 * 鸿蒙侧自研原生能力的 RN Package（Phase 4）。
 *
 * 挂载方式与 `RNOHCorePackage/Package.ets` 一致：覆写 `getUITurboModuleFactoryByNameMap`，
 * 由 RNOH 的 `RNInstance` 在建 TurboModule 时按名字取。
 *
 * 只在 ArkTS 侧实现的模块必须同时在 C++ 侧登记方法名，否则 JS 取用时会抛
 * `Couldn't find Turbo Module on the ArkTs side`（缺 ArkTS 那半边）或拿到
 * `undefined` 方法（缺 C++ 那半边的 `methodMap_`）。两边名字要一起加，
 * 见 `src/main/cpp/ERPTurboModules.h`。
 */
import type { UITurboModuleContext } from '@rnoh/react-native-openharmony';
import { RNOHPackage } from '@rnoh/react-native-openharmony';
import type { UITurboModule } from '@rnoh/react-native-openharmony';
import { ERPCapabilitiesTurboModule } from './ERPCapabilitiesTurboModule';
import { ERPLogTurboModule } from './ERPLogTurboModule';
import { ERPNetworkTurboModule } from './ERPNetworkTurboModule';
import { ERPSystemTurboModule } from './ERPSystemTurboModule';

export class ERPPackage extends RNOHPackage {
  override getUITurboModuleFactoryByNameMap(): Map<string, (ctx: UITurboModuleContext) => UITurboModule | null> {
    return new Map<string, ((ctx: UITurboModuleContext) => UITurboModule)>()
      .set(ERPSystemTurboModule.NAME, (ctx) => new ERPSystemTurboModule(ctx))
      .set(ERPLogTurboModule.NAME, (ctx) => new ERPLogTurboModule(ctx))
      .set(ERPNetworkTurboModule.NAME, (ctx) => new ERPNetworkTurboModule(ctx))
      .set(ERPCapabilitiesTurboModule.NAME, (ctx) => new ERPCapabilitiesTurboModule(ctx));
  }

  getDebugName(): string {
    return 'ERP';
  }
}
