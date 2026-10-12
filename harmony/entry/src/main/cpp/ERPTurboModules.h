#pragma once

#include <string>
#include <utility>

#include "RNOH/ArkTSTurboModule.h"

namespace rnoh {

/**
 * 自研 ERP* TurboModule 的 C++ 半边（实现全在 ArkTS 侧的 erp/ 目录）。
 *
 * 只有一个 `ArkTSTurboModule` 壳是不够的：RN 核心的 `TurboModule::create` 仅查
 * `methodMap_`，查不到的属性一律返回 `undefined`，壳只保证拿得到 ArkTS 实例。
 * 所以这里按 RNOH 自家 ArkTS 模块的做法把方法名逐个登记进 `methodMap_`
 * （模板见 `RNOHCorePackage/TurboModules/ShareTurboModule.cpp`）。
 *
 * 全部按 async 登记，ArkTS 侧对应方法一律是 `async`（返回 Promise）：
 * `ERPLog.write` 在安卓是同步 void，RN 侧不取返回值，这里改成 async 是为了
 * 避免「JS 线程同步等主线程」的死锁风险。
 *
 * 没走 codegen：这四个模块在 RN 侧是 `NativeModules.ERP*` 直取（与安卓共用），
 * 加 spec 会牵动安卓侧的 TurboModule 注册。
 */
class ERPSystemTurboModule : public ArkTSTurboModule {
 public:
  ERPSystemTurboModule(Context ctx, std::string name)
      : ArkTSTurboModule(ctx, std::move(name)) {
    methodMap_ = {
        ARK_ASYNC_METHOD_METADATA(getDeviceInfo, 0),
        ARK_ASYNC_METHOD_METADATA(exitApp, 0),
    };
  }
};

class ERPLogTurboModule : public ArkTSTurboModule {
 public:
  ERPLogTurboModule(Context ctx, std::string name)
      : ArkTSTurboModule(ctx, std::move(name)) {
    methodMap_ = {
        ARK_ASYNC_METHOD_METADATA(write, 2),
        ARK_ASYNC_METHOD_METADATA(getLogDir, 0),
        ARK_ASYNC_METHOD_METADATA(listLogs, 0),
        ARK_ASYNC_METHOD_METADATA(readLog, 1),
        ARK_ASYNC_METHOD_METADATA(clearLogs, 0),
    };
  }
};

class ERPNetworkTurboModule : public ArkTSTurboModule {
 public:
  ERPNetworkTurboModule(Context ctx, std::string name)
      : ArkTSTurboModule(ctx, std::move(name)) {
    methodMap_ = {
        ARK_ASYNC_METHOD_METADATA(getStatus, 0),
    };
  }
};

class ERPCapabilitiesTurboModule : public ArkTSTurboModule {
 public:
  ERPCapabilitiesTurboModule(Context ctx, std::string name)
      : ArkTSTurboModule(ctx, std::move(name)) {
    // 名单必须与 ArkTS 侧 ERPCapabilitiesTurboModule 的 public async 方法逐一对应，
    // 且与 RNbase `capability-native-adapters.ts` 的 ERPCapabilitiesNative 同名：
    // 鸿蒙做不到的项（appInstalled / appOpen / appOpenStore / NFC 三件套）这里
    // 干脆不登记，JS 侧取不到方法即报 DEVICE_UNSUPPORTED，比留 reject 空壳更诚实。
    methodMap_ = {
        ARK_ASYNC_METHOD_METADATA(scan, 1),
        ARK_ASYNC_METHOD_METADATA(takePhoto, 0),
        ARK_ASYNC_METHOD_METADATA(pickImage, 1),
        ARK_ASYNC_METHOD_METADATA(saveImage, 1),
        ARK_ASYNC_METHOD_METADATA(filePick, 1),
        ARK_ASYNC_METHOD_METADATA(readFileAsBase64, 1),
        ARK_ASYNC_METHOD_METADATA(fileDownload, 1),
        ARK_ASYNC_METHOD_METADATA(fileOpen, 1),
        ARK_ASYNC_METHOD_METADATA(getCurrentPosition, 0),
        ARK_ASYNC_METHOD_METADATA(setBadge, 1),
        ARK_ASYNC_METHOD_METADATA(playSound, 1),
        ARK_ASYNC_METHOD_METADATA(sendNotification, 2),
        ARK_ASYNC_METHOD_METADATA(clipboardSetString, 1),
        ARK_ASYNC_METHOD_METADATA(clipboardGetString, 0),
        ARK_ASYNC_METHOD_METADATA(clipboardHasString, 0),
        ARK_ASYNC_METHOD_METADATA(appOpenSettings, 0),
        ARK_ASYNC_METHOD_METADATA(appOpenSystemSettings, 1),
        ARK_ASYNC_METHOD_METADATA(share, 3),
    };
  }
};

} // namespace rnoh
