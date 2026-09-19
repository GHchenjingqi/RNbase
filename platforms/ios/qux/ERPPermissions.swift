/**
 * iOS 权限原生模块（Skill 规则 50/51）。
 *
 * 对应 RN 侧 src/permissions/adapters/iosPermissionAdapter.ts 调用的
 * NativeModules.ERPPermissions。
 *
 * 注册方式：将本文件加入 Xcode 的 App Target（Build Phases -> Compile Sources）。
 * 模块名导出的 JS 名为 "ERPPermissions"。
 *
 * check/request 返回统一状态字符串：
 *   authorized | limited | notDetermined | restricted | denied | unavailable
 */
import AVFoundation
import Foundation
import Photos
import React
import UserNotifications

@objc(ERPPermissions)
class ERPPermissions: NSObject, RCTBridgeModule {
  static func moduleName() -> String! {
    "ERPPermissions"
  }

  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(check:resolver:rejecter:)
  func check(
    _ permission: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(statusFor(permission))
  }

  @objc(request:resolver:rejecter:)
  func request(
    _ permission: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    requestPermission(permission) { granted in
      resolve(statusFor(permission))
    }
  }

  // MARK: - 状态映射

  private func statusFor(_ permission: String) -> String {
    switch permission {
    case "camera":
      let s = AVCaptureDevice.authorizationStatus(for: .video)
      return mapAvStatus(s)
    case "photo":
      let s = PHPhotoLibrary.authorizationStatus()
      return mapPhStatus(s)
    case "location", "locationWhenInUse":
      let s = CLLocationManager.authorizationStatus()
      return mapLocationStatus(s)
    case "notification":
      // 通知权限需异步查询，统一在 request 中处理；check 返回当前缓存值
      return "notDetermined"
    case "microphone":
      let s = AVAudioSession.sharedInstance().recordPermission
      return mapAudioStatus(s)
    case "file":
      return "authorized"
    default:
      return "unavailable"
    }
  }

  private func mapAvStatus(_ s: AVAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "authorized"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  private func mapPhStatus(_ s: PHAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "authorized"
    case .limited: return "limited"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  private func mapLocationStatus(_ s: CLAuthorizationStatus) -> String {
    switch s {
    case .authorizedAlways, .authorizedWhenInUse: return "authorized"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  private func mapAudioStatus(_ s: AVAudioSession.RecordPermission) -> String {
    switch s {
    case .granted: return "authorized"
    case .denied: return "denied"
    case .undetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  // MARK: - 申请

  private func requestPermission(_ permission: String, completion: @escaping (Bool) -> Void) {
    switch permission {
    case "camera":
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async { completion(granted) }
      }
    case "photo":
      PHPhotoLibrary.requestAuthorization { _ in
        DispatchQueue.main.async { completion(true) }
      }
    case "location", "locationWhenInUse":
      let mgr = CLLocationManager()
      mgr.requestWhenInUseAuthorization()
      completion(true)
    case "microphone":
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        DispatchQueue.main.async { completion(granted) }
      }
    case "notification":
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) {
        granted, _ in
        DispatchQueue.main.async { completion(granted) }
      }
    default:
      completion(false)
    }
  }
}
