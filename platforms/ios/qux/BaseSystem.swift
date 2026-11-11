/**
 * iOS 系统信息原生模块（对齐上游基座 2026-11-11 的最新 iOS 实现，
 * 模块名用本基座的 Base 前缀）。
 *
 * 对应 RN 侧 src/middleware/native/system-native-adapter.ts 的
 * NativeModules.BaseSystem.getDeviceInfo，返回字段与 Android 完全一致：
 * brand / model / systemVersion / sdkInt / batteryLevel / isCharging /
 * totalStorage / freeStorage / timezone。
 *
 * 桥接：RCT_EXTERN_MODULE 声明在 BaseBridge.m。
 */
import Foundation
import React
import UIKit

@objc(BaseSystem)
class BaseSystem: NSObject {

  @objc(getDeviceInfo:rejecter:)
  func getDeviceInfo(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let device = UIDevice.current
      let systemVersion = device.systemVersion
      let majorVersion = Int(systemVersion.split(separator: ".").first ?? "0") ?? 0

      device.isBatteryMonitoringEnabled = true
      let rawLevel = device.batteryLevel
      let batteryLevel = rawLevel < 0 ? -1.0 : Double(rawLevel) * 100.0
      let batteryState = device.batteryState
      let isCharging = batteryState == .charging || batteryState == .full

      let storage = BaseSystem.storageUsage()

      resolve([
        "brand": "Apple",
        "model": BaseSystem.machineModel(),
        "systemVersion": systemVersion,
        "sdkInt": majorVersion,
        "batteryLevel": batteryLevel,
        "isCharging": isCharging,
        "totalStorage": storage.total,
        "freeStorage": storage.free,
        "timezone": TimeZone.current.identifier,
      ])
    }
  }

  /// 设备机型标识（如 iPhone15,2），与 Android Build.MODEL 同义。
  private static func machineModel() -> String {
    var systemInfo = utsname()
    uname(&systemInfo)
    let mirror = Mirror(reflecting: systemInfo.machine)
    let identifier = mirror.children.reduce(into: "") { result, element in
      guard let value = element.value as? Int8, value != 0 else { return }
      result.append(Character(UnicodeScalar(UInt8(bitPattern: value))))
    }
    return identifier.isEmpty ? UIDevice.current.model : identifier
  }

  /// 存储容量（字节）：Android 用 StatFs(dataDirectory)，这里取 App 数据卷。
  private static func storageUsage() -> (total: Double, free: Double) {
    do {
      let attrs = try FileManager.default.attributesOfFileSystem(forPath: NSHomeDirectory())
      let total = (attrs[.systemSize] as? NSNumber)?.doubleValue ?? 0
      let free = (attrs[.systemFreeSize] as? NSNumber)?.doubleValue ?? 0
      return (total, free)
    } catch {
      return (0, 0)
    }
  }
}
