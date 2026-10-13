#pragma once

#include "BaseTurboModules.h"
#include "RNOH/ArkTSTurboModule.h"
#include "RNOH/Package.h"

namespace rnoh {

/**
 * RNOH 里「只在 ArkTS 侧实现」的 TurboModule 必须同时在 C++ 侧登记一个
 * `ArkTSTurboModule` 壳，否则 JS 取用时会抛
 * `Couldn't find Turbo Module on the ArkTs side`（ArkTS 侧日志里明明已经
 * `TM created: xxx`，因为缺的是 C++ 那半边）。RNOH 自己就是这么处理的，
 * 例如核心包里的 `KeyboardObserver` 直接 `std::make_shared<ArkTSTurboModule>`。
 *
 * `react-native-safe-area-context` 的鸿蒙移植包只有 ArkTS 实现（HAR 里没有 cpp），
 * 所以在这里手工补壳。
 *
 * 自研的 Base* 模块不能只补壳：壳的 `methodMap_` 是空的，JS 取任何方法名都会拿到
 * `undefined`（RN 核心 `TurboModule::create` 只查这张表）。它们的 C++ 半边在
 * `BaseTurboModules.h` 里逐个登记了方法名。
 */
class ManualArkTSPackage : public Package {
 public:
  ManualArkTSPackage(Package::Context ctx) : Package(ctx) {}

  std::unique_ptr<TurboModuleFactoryDelegate>
  createTurboModuleFactoryDelegate() override {
    class Delegate : public TurboModuleFactoryDelegate {
     public:
      SharedTurboModule createTurboModule(Context ctx, const std::string &name)
          const override {
        if (name == "RNCSafeAreaContext") {
          return std::make_shared<ArkTSTurboModule>(ctx, name);
        }
        if (name == "BaseSystem") {
          return std::make_shared<BaseSystemTurboModule>(ctx, name);
        }
        if (name == "BaseLog") {
          return std::make_shared<BaseLogTurboModule>(ctx, name);
        }
        if (name == "BaseNetwork") {
          return std::make_shared<BaseNetworkTurboModule>(ctx, name);
        }
        if (name == "BaseCapabilities") {
          return std::make_shared<BaseCapabilitiesTurboModule>(ctx, name);
        }
        return nullptr;
      }
    };
    return std::make_unique<Delegate>();
  }
};

} // namespace rnoh
