/**
 * iOS 能力原生模块（Skill 规则 11/13/51）。
 *
 * 对应 RN 侧 src/native/capabilityNativeAdapters.ts 调用的
 * NativeModules.ERPCapabilities。
 *
 * 注册方式：将本文件加入 Xcode 的 App Target。导出 JS 名为 "ERPCapabilities"。
 *
 * 说明：scan 依赖扫码三方库（如 Vision / 自定义扫码页），此处保留标准占位实现，
 * 可按项目实际扫码方案替换；其余能力使用系统 API。
 */
import AVFoundation
import CoreLocation
import Foundation
import Photos
import React
import UIKit

@objc(ERPCapabilities)
class ERPCapabilities: NSObject, RCTBridgeModule, CLLocationManagerDelegate {
  static func moduleName() -> String! { "ERPCapabilities" }
  static func requiresMainQueueSetup() -> Bool { false }

  // MARK: - 常量导出（JS 同步读取，避免异步等待）

  @objc(constantsToExport)
  override func constantsToExport() -> [AnyHashable: Any] {
    // H5 本地入口基座路径：iOS 没有 android_asset，WebView 需加载 App bundle 内的 h5/ 资源
    // （开发者需把 h5/ 作为 folder reference 加进 App target，见 scripts/ios.js 的 sync-h5）。
    ["H5BundleBasePath": Bundle.main.bundlePath]
  }

  private let locationManager = CLLocationManager()
  private var locationResolver: RCTPromiseResolveBlock?

  // MARK: - 设备完整性（jailbreak 探针，对应 src/security/device-integrity.ts）

  /// 返回 'secure' | 'compromised'。JS 侧 normalizeIntegrity 接受这三种字符串或 boolean。
  /// 探测手段（公开 API，App Store 安全）：
  ///  1. 越狱特征文件存在性（Cydia / MobileSubstrate / sshd / apt 等）；
  ///  2. 沙盒逃逸探测：向 /private 写入临时文件，非越狱设备必被拒绝。
  /// 待办：真机验证（见 platforms/ios/TODO.md #3）。
  @objc(getDeviceIntegrity:rejecter:)
  func getDeviceIntegrity(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(Self.detectJailbreak() ? "compromised" : "secure")
  }

  static func detectJailbreak() -> Bool {
    let suspiciousPaths = [
      "/Applications/Cydia.app",
      "/Applications/Sileo.app",
      "/Library/MobileSubstrate/MobileSubstrate.dylib",
      "/bin/bash",
      "/usr/sbin/sshd",
      "/usr/bin/ssh",
      "/etc/apt",
      "/private/var/lib/apt/",
      "/private/var/lib/cydia",
      "/var/log/syslog",
    ]
    for path in suspiciousPaths where FileManager.default.fileExists(atPath: path) {
      return true
    }
    // 沙盒逃逸探测：非越狱设备写入 /private 根必失败（iOS 沙盒只允许写容器目录）。
    let probePath = "/private/\(UUID().uuidString)"
    if (try? "rnbase-jailbreak-probe".write(toFile: probePath, atomically: true, encoding: .utf8)) != nil {
      try? FileManager.default.removeItem(atPath: probePath)
      return true
    }
    return false
  }

  // MARK: - 扫码（占位，需接入实际扫码方案）

  @objc(scan:rejecter:)
  func scan(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    reject("NOT_IMPLEMENTED", "iOS 扫码需接入实际扫码模块", nil)
  }

  // MARK: - 拍照

  @objc(takePhoto:rejecter:)
  func takePhoto(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.mediaTypes = [UTType.image.identifier]
      self.present(picker, resolve: resolve, reject: reject)
    }
  }

  // MARK: - 相册选图

  @objc(pickImage:resolver:rejecter:)
  func pickImage(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let picker = UIImagePickerController()
      picker.sourceType = .photoLibrary
      picker.mediaTypes = [UTType.image.identifier]
      self.present(picker, resolve: resolve, reject: reject)
    }
  }

  // MARK: - 保存图片到相册

  @objc(saveImage:resolver:rejecter:)
  func saveImage(
    _ uri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: uri), let data = try? Data(contentsOf: url),
          let image = UIImage(data: data) else {
      reject("INVALID_URI", "无法读取图片", nil)
      return
    }
    PHPhotoLibrary.shared().performChanges({
      PHAssetChangeRequest.creationRequestForAsset(from: image)
    }) { success, error in
      DispatchQueue.main.async {
        if success { resolve(["saved": true]) }
        else { reject("SAVE_FAILED", error?.localizedDescription, error) }
      }
    }
  }

  // MARK: - 文件选择

  @objc(filePick:resolver:rejecter:)
  func filePick(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let types = [UTType.item.identifier, UTType.content.identifier]
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types)
      picker.allowsMultipleSelection = (options["multiple"] as? Bool) ?? false
      picker.completionHandler = { urls in
        let files = urls.map { url -> [String: Any] in
          let ns = url as NSURL
          return [
            "name": ns.lastPathComponent ?? "file",
            "size": (try? Data(contentsOf: url))?.count ?? 0,
            "mimeType": url.mimeType ?? "application/octet-stream",
            "uri": url.absoluteString,
          ]
        }
        resolve(["files": files])
      }
      self.topViewController()?.present(picker, animated: true)
    }
  }

  // MARK: - 文件下载 / 打开

  @objc(fileDownload:resolver:rejecter:)
  func fileDownload(
    _ url: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let u = URL(string: url) else {
      reject("INVALID_URL", "非法 URL", nil); return
    }
    URLSession.shared.downloadTask(with: u) { loc, _, error in
      guard let loc = loc else {
        reject("DOWNLOAD_FAILED", error?.localizedDescription, error); return
      }
      resolve(["uri": loc.absoluteString])
    }.resume()
  }

  @objc(fileOpen:resolver:rejecter:)
  func fileOpen(
    _ uri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: uri) else {
      reject("INVALID_URI", "非法 URI", nil); return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(url) { opened in
        resolve(["opened": opened])
      }
    }
  }

  // MARK: - 剪贴板

  @objc(clipboardSetString:resolver:rejecter:)
  func clipboardSetString(
    _ text: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    UIPasteboard.general.string = text
    resolve(["ok": true])
  }

  @objc(clipboardGetString:rejecter:)
  func clipboardGetString(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(["text": UIPasteboard.general.string ?? ""])
  }

  @objc(clipboardHasString:rejecter:)
  func clipboardHasString(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(["has": UIPasteboard.general.hasStrings])
  }

  // MARK: - 应用设置页

  /// 跳转本应用的系统设置页。iOS 只能回到这一个入口，因此不实现分区跳转
  /// （appOpenSystemSettings 缺省，JS 侧适配器会给出 DEVICE_UNSUPPORTED）。
  @objc(appOpenSettings:rejecter:)
  func appOpenSettings(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: UIApplication.openSettingsURLString) else {
      reject("SETTINGS_UNAVAILABLE", "无法打开系统设置页", nil); return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(url) { opened in
        resolve(["opened": opened])
      }
    }
  }

  // MARK: - 定位

  @objc(getCurrentPosition:rejecter:)
  func getCurrentPosition(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    locationResolver = resolve
    locationManager.delegate = self
    locationManager.requestWhenInUseAuthorization()
    locationManager.requestLocation()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let loc = locations.first, let resolver = locationResolver else { return }
    resolver([
      "latitude": loc.coordinate.latitude,
      "longitude": loc.coordinate.longitude,
      "accuracy": loc.horizontalAccuracy,
    ])
    locationResolver = nil
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    locationResolver = nil
  }

  // MARK: - 工具

  private func present(
    _ picker: UIImagePickerController,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    picker.delegate = self
    objc_setAssociatedObject(picker, "resolve", resolve, .OBJC_ASSOCIATION_RETAIN)
    objc_setAssociatedObject(picker, "reject", reject, .OBJC_ASSOCIATION_RETAIN)
    topViewController()?.present(picker, animated: true)
  }

  private func topViewController() -> UIViewController? {
    let key = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first?.windows.first { $0.isKeyWindow }
    var vc = key?.rootViewController
    while let presented = vc?.presentedViewController { vc = presented }
    return vc
  }
}

extension ERPCapabilities: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
  func imagePickerController(
    _ picker: UIImagePickerController,
    didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
  ) {
    picker.dismiss(animated: true)
    guard let resolve = objc_getAssociatedObject(picker, "resolve") as? RCTPromiseResolveBlock else {
      return
    }
    if let url = info[.imageURL] as? URL {
      resolve(["uri": url.absoluteString])
    } else if let image = info[.originalImage] as? UIImage,
              let data = image.pngData(),
              let tmp = try? writeTemp(data) {
      resolve(["uri": tmp])
    } else {
      resolve(["uri": ""])
    }
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true)
  }

  private func writeTemp(_ data: Data) throws -> String {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString).appendingPathExtension("png")
    try data.write(to: url)
    return url.absoluteString
  }
}
