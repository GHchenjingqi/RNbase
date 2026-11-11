/**
 * iOS 权限原生模块（对齐上游基座 2026-11-11 的最新 iOS 实现，
 * 对齐 Android 权限层语义）。
 *
 * 对应 RN 侧 src/permissions/adapters/ios-permission-adapter.ts 的
 * NativeModules.BasePermissions.check / request。
 *
 * 返回统一状态字符串：
 *   authorized | limited | notDetermined | restricted | denied | unavailable
 *
 * 修复点（随基座同步）：
 *  - 通知权限改为真实异步查询（旧版 check 硬编码 notDetermined）
 *  - 定位 manager 提升为成员变量并实现 delegate，避免请求完立即释放收不到回调
 *  - request 一律在授权回调后重新读取真实状态，而不是假定 granted
 *
 * 桥接：RCT_EXTERN_MODULE 声明在 BaseBridge.m（Swift 类不会自动注册）。
 */
import AVFoundation
import CoreLocation
import Foundation
import Photos
import React
import UIKit
import UserNotifications

@objc(BasePermissions)
class BasePermissions: NSObject, CLLocationManagerDelegate {

  private var locationManager: CLLocationManager?
  private var locationCompletion: ((Bool) -> Void)?

  // MARK: - 查询

  @objc(check:resolver:rejecter:)
  func check(
    _ permission: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if permission == "notification" {
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        resolve(BasePermissions.mapNotification(settings.authorizationStatus))
      }
      return
    }
    resolve(status(for: permission))
  }

  // MARK: - 申请

  @objc(request:resolver:rejecter:)
  func request(
    _ permission: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    switch permission {
    case "camera":
      AVCaptureDevice.requestAccess(for: .video) { _ in
        DispatchQueue.main.async {
          resolve(BasePermissions.mapAVStatus(AVCaptureDevice.authorizationStatus(for: .video)))
        }
      }
    case "photo":
      PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in
        DispatchQueue.main.async {
          resolve(BasePermissions.mapPHStatus(PHPhotoLibrary.authorizationStatus(for: .readWrite)))
        }
      }
    case "location", "locationWhenInUse":
      requestLocation(resolve: resolve)
    case "microphone":
      AVAudioSession.sharedInstance().requestRecordPermission { _ in
        DispatchQueue.main.async {
          resolve(
            BasePermissions.mapAudioStatus(AVAudioSession.sharedInstance().recordPermission))
        }
      }
    case "notification":
      UNUserNotificationCenter.current().requestAuthorization(
        options: [.alert, .sound, .badge]
      ) { _, _ in
        UNUserNotificationCenter.current().getNotificationSettings { settings in
          resolve(BasePermissions.mapNotification(settings.authorizationStatus))
        }
      }
    case "file":
      resolve("authorized")
    default:
      resolve("unavailable")
    }
  }

  private func requestLocation(resolve: @escaping RCTPromiseResolveBlock) {
    DispatchQueue.main.async {
      let manager = self.locationManager ?? CLLocationManager()
      self.locationManager = manager
      manager.delegate = self

      let status = manager.authorizationStatus
      if status != .notDetermined {
        resolve(BasePermissions.mapLocationStatus(status))
        return
      }

      var completed = false
      let finish: () -> Void = { [weak self] in
        guard !completed else { return }
        completed = true
        self?.locationCompletion = nil
        resolve(BasePermissions.mapLocationStatus(manager.authorizationStatus))
      }
      self.locationCompletion = { _ in finish() }

      manager.requestWhenInUseAuthorization()
      // 授权弹窗被忽略/系统未回调时兜底，避免 Promise 悬挂
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
        finish()
      }
    }
  }

  // MARK: - CLLocationManagerDelegate

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    locationCompletion?(
      manager.authorizationStatus == .authorizedWhenInUse
        || manager.authorizationStatus == .authorizedAlways)
  }

  func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
    locationManagerDidChangeAuthorization(manager)
  }

  // MARK: - 状态读取

  private func status(for permission: String) -> String {
    switch permission {
    case "camera":
      return BasePermissions.mapAVStatus(AVCaptureDevice.authorizationStatus(for: .video))
    case "photo":
      return BasePermissions.mapPHStatus(PHPhotoLibrary.authorizationStatus(for: .readWrite))
    case "location", "locationWhenInUse":
      let manager = locationManager ?? CLLocationManager()
      locationManager = manager
      return BasePermissions.mapLocationStatus(manager.authorizationStatus)
    case "microphone":
      return BasePermissions.mapAudioStatus(AVAudioSession.sharedInstance().recordPermission)
    case "file":
      return "authorized"
    default:
      return "unavailable"
    }
  }

  private static func mapAVStatus(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  private static func mapPHStatus(_ status: PHAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .limited: return "limited"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  private static func mapLocationStatus(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .authorizedAlways, .authorizedWhenInUse: return "authorized"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  private static func mapAudioStatus(_ status: AVAudioSession.RecordPermission) -> String {
    switch status {
    case .granted: return "authorized"
    case .denied: return "denied"
    case .undetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  private static func mapNotification(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized, .provisional, .ephemeral: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }
}
