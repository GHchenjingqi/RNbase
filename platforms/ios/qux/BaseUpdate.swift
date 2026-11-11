/**
 * iOS 只读升级信息模块（对齐上游基座 2026-11-11 的最新 iOS 实现，
 * 模块名用本基座的 Base 前缀；对齐 Android BaseUpdateModule 的 getInfo 契约）。
 *
 * iOS 不允许应用自行下载安装 IPA，所以这里只提供当前包版本信息，
 * 下载 / 安装 / 授权页 / 导出等动作统一回 UNSUPPORTED；
 * H5 侧按 platform !== 'android' 判定不弹应用内升级，不会误触发。
 *
 * 桥接：RCT_EXTERN_MODULE 声明在 BaseBridge.m。
 */
import Foundation
import React

@objc(BaseUpdate)
class BaseUpdate: NSObject {
  @objc(getInfo:rejecter:)
  func getInfo(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let info = Bundle.main.infoDictionary ?? [:]
    let versionName = info["CFBundleShortVersionString"] as? String ?? ""
    let versionCode = Int(info["CFBundleVersion"] as? String ?? "") ?? -1
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    let updateDir = documents?.appendingPathComponent("updates").path ?? ""

    resolve([
      "platform": "ios",
      "versionName": versionName,
      "versionCode": versionCode,
      "apkInstall": false,
      "canRequestInstall": false,
      "updateDir": updateDir,
      "taskState": "idle",
      "received": 0,
      "total": 0,
      "errorCode": "",
      "errorMessage": "",
      "sha256": "",
      "apkPath": "",
      "apkSize": 0,
    ])
  }

  @objc(startDownload:resolver:rejecter:)
  func startDownload(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    rejectUnsupported(reject)
  }

  @objc(getProgress:rejecter:)
  func getProgress(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    rejectUnsupported(reject)
  }

  @objc(cancelDownload:rejecter:)
  func cancelDownload(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    rejectUnsupported(reject)
  }

  @objc(install:rejecter:)
  func install(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    rejectUnsupported(reject)
  }

  @objc(canRequestInstallCheck:rejecter:)
  func canRequestInstallCheck(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    rejectUnsupported(reject)
  }

  @objc(openInstallSettings:rejecter:)
  func openInstallSettings(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    rejectUnsupported(reject)
  }

  @objc(copyToDownloads:rejecter:)
  func copyToDownloads(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    rejectUnsupported(reject)
  }

  @objc(cleanup:rejecter:)
  func cleanup(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    rejectUnsupported(reject)
  }

  /** 所有安装类动作在 iOS 上都不存在，统一错误码供 RN 适配器映射成 DEVICE_UNSUPPORTED。 */
  private func rejectUnsupported(_ reject: RCTPromiseRejectBlock) {
    reject("UNSUPPORTED", "iOS 不支持应用内安装，请通过 App Store 或 TestFlight 更新", nil)
  }
}
