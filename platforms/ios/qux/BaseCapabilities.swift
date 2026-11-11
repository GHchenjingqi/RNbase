/**
 * iOS 能力原生模块（对齐上游基座 2026-11-11 的最新 iOS 实现）。
 *
 * 对应 RN 侧 src/middleware/native/capability-native-adapters.ts 里
 * NativeModules.BaseCapabilities 的完整契约：
 *   扫码 / 拍照 / 选图 / 保存图片 / 文件选择 / 文件下载 / 文件打开 /
 *   读文件为 Base64 / 定位 / 剪贴板 / 打开外部 App / 跳系统设置 /
 *   NFC 读写 / 应用角标 / 提示音 / 本地通知 / 通知深链。
 *
 * 返回字段与错误码全部与 Android BaseCapabilitiesModule 保持一致，H5 侧无需按平台分支。
 * 通知点击通过 RCTEventEmitter 发 "baseNotificationTap"，与 WebViewBridge.tsx 常量
 * 及 Android BaseCapabilitiesModule.NOTIFICATION_TAP_EVENT 一致。
 *
 * 桥接：本类的 RCT_EXTERN_MODULE 声明在 BaseBridge.m（与上游基座口径一致），
 * Swift 侧只继承 RCTEventEmitter，不自行实现 moduleName（避免双重注册）。
 */
import AVFoundation
import AudioToolbox
import CoreLocation
import CoreNFC
import Foundation
import Photos
import PhotosUI
import React
import UIKit
import UniformTypeIdentifiers
import UserNotifications

private let baseImageMaxEdge: CGFloat = 1024
private let baseJpegQuality: CGFloat = 0.8

/**
 * Android 包名 → iOS URL Scheme。
 *
 * H5 设备测试页传的是安卓包名（com.tencent.mm 等），iOS 没有包名概念，
 * 这里只做常用 App 的显式映射；未命中的入参仍按「入参本身当 scheme」兜底。
 * 目标 scheme 必须同时写进 Info.plist 的 LSApplicationQueriesSchemes。
 */
private let baseOpenAppSchemeByPackage: [String: String] = [
  "com.tencent.mm": "weixin://",
  "com.tencent.mobileqq": "mqq://",
  "com.eg.android.AlipayGphone": "alipay://",
]

// MARK: - 通用工具

private func baseTopViewController(_ base: UIViewController? = nil) -> UIViewController? {
  var top = base ?? UIApplication.shared.connectedScenes
    .compactMap { $0 as? UIWindowScene }
    .flatMap { $0.windows }
    .first(where: { $0.isKeyWindow })?
    .rootViewController
  while let presented = top?.presentedViewController {
    if let nav = presented as? UINavigationController {
      top = nav.visibleViewController
    } else if let tab = presented as? UITabBarController {
      top = tab.selectedViewController
    } else {
      top = presented
    }
  }
  return top
}

private func baseURL(from uri: String) -> URL? {
  let trimmed = uri.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else { return nil }
  if trimmed.hasPrefix("file://") || trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
    return URL(string: trimmed)
  }
  return URL(fileURLWithPath: trimmed)
}

private func baseCacheDirectory() -> URL {
  let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  return dir
}

private func baseUniqueFile(in dir: URL, name: String) -> URL {
  let rawName = name.isEmpty ? "base_file" : name
  let base = (rawName as NSString).deletingPathExtension
  let ext = (rawName as NSString).pathExtension
  var target = dir.appendingPathComponent(rawName)
  var index = 1
  while FileManager.default.fileExists(atPath: target.path) {
    let nextName = ext.isEmpty ? "\(base)_\(index)" : "\(base)_\(index).\(ext)"
    target = dir.appendingPathComponent(nextName)
    index += 1
  }
  return target
}

private func baseMimeType(for url: URL) -> String {
  if let type = UTType(filenameExtension: url.pathExtension), let mime = type.preferredMIMEType {
    return mime
  }
  return "application/octet-stream"
}

private func baseFileInfo(for url: URL) -> [String: Any] {
  let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
  let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
  return [
    "name": url.lastPathComponent,
    "size": size,
    "mimeType": baseMimeType(for: url),
    "uri": url.absoluteString,
  ]
}

private func baseCompressedImageData(
  _ image: UIImage,
  maxEdge: CGFloat = baseImageMaxEdge,
  quality: CGFloat = baseJpegQuality
) -> Data? {
  let size = image.size
  let maxSide = max(size.width, size.height)
  guard maxSide > 0 else { return nil }
  if maxSide <= maxEdge {
    return image.jpegData(compressionQuality: quality)
  }
  let scale = maxEdge / maxSide
  let newSize = CGSize(width: floor(size.width * scale), height: floor(size.height * scale))
  let format = UIGraphicsImageRendererFormat.default()
  format.scale = 1
  let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
  let resized = renderer.image { _ in
    image.draw(in: CGRect(origin: .zero, size: newSize))
  }
  return resized.jpegData(compressionQuality: quality)
}

// MARK: - 通知深链负载（AppDelegate 写入，模块一次性取走）

final class BasePendingNotificationStore {
  static let shared = BasePendingNotificationStore()
  static let tapNotification = Notification.Name("BaseCapabilitiesNotificationTap")

  private let lock = NSLock()
  private var storedPayload: String?

  private init() {}

  func setPayload(_ payload: String) {
    lock.lock()
    storedPayload = payload
    lock.unlock()
  }

  /// 取一次即清，与 Android 语义一致（避免 app.resume 与 tap 事件重复跳转）。
  func consume() -> String {
    lock.lock()
    defer { lock.unlock() }
    let value = storedPayload ?? ""
    storedPayload = nil
    return value
  }
}

// MARK: - 模块

@objc(BaseCapabilities)
final class BaseCapabilities: RCTEventEmitter {
  private static let notificationTapEvent = "baseNotificationTap"

  private var hasListeners = false
  private var autoNotificationId = 1

  private var photoResolve: RCTPromiseResolveBlock?
  private var photoReject: RCTPromiseRejectBlock?

  private var galleryResolve: RCTPromiseResolveBlock?
  private var galleryReject: RCTPromiseRejectBlock?

  private var documentResolve: RCTPromiseResolveBlock?
  private var documentReject: RCTPromiseRejectBlock?
  private var documentDelegate: BaseDocumentPickerDelegate?

  private var shareReject: RCTPromiseRejectBlock?
  private var shareResolve: RCTPromiseResolveBlock?

  private var scannerController: BaseScannerViewController?

  private var locationManager: CLLocationManager?
  private var locationResolve: RCTPromiseResolveBlock?
  private var locationReject: RCTPromiseRejectBlock?
  private var locationTimeout: DispatchWorkItem?

  private var nfcService: BaseNFCService?
  private var previewController: UIDocumentInteractionController?

  // MARK: 常量导出（JS 同步读取，避免异步等待）

  /**
   * H5 本地入口基座路径：iOS 没有 android_asset，WebView 需加载 App bundle 内的 h5/ 资源
   * （工程侧 "Copy H5 Assets" 构建阶段已把根目录 h5/ 拷进 .app，见 project.pbxproj）。
   * 与 src/app/resolve-h5-entry.ts 的 getIosLocalH5EntryUri() 配套；
   * BaseH5.getBundledEntry 是同一入口的异步版本（基座口径，留作兜底）。
   */
  @objc func constantsToExport() -> [AnyHashable: Any] {
    ["H5BundleBasePath": Bundle.main.bundlePath]
  }

  override func supportedEvents() -> [String]! {
    [Self.notificationTapEvent]
  }

  override func startObserving() {
    hasListeners = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleNotificationTap),
      name: BasePendingNotificationStore.tapNotification,
      object: nil
    )
  }

  override func stopObserving() {
    hasListeners = false
    NotificationCenter.default.removeObserver(
      self,
      name: BasePendingNotificationStore.tapNotification,
      object: nil
    )
  }

  @objc private func handleNotificationTap() {
    guard hasListeners else { return }
    sendEvent(
      withName: Self.notificationTapEvent,
      body: ["ts": Int(Date().timeIntervalSince1970 * 1000)]
    )
  }

  // MARK: 扫码（AVFoundation 自建扫码页，替代旧版 NOT_IMPLEMENTED 占位）

  @objc(scan:resolver:rejecter:)
  func scan(
    _ formats: NSArray?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let requested = (formats as? [String]) ?? []
    self.ensureCameraAccess { granted in
      guard granted else {
        reject("PERMISSION_DENIED", "相机权限被拒绝，请在系统设置中开启相机权限", nil)
        return
      }
      DispatchQueue.main.async {
        guard let host = baseTopViewController() else {
          reject("NO_ACTIVITY", "当前无可用界面", nil)
          return
        }
        let scanner = BaseScannerViewController(formats: requested)
        scanner.onFinish = { [weak self] code, format in
          self?.scannerController = nil
          resolve(["code": code, "format": format])
        }
        scanner.onCancel = { [weak self] in
          self?.scannerController = nil
          reject("USER_CANCELLED", "用户取消扫码", nil)
        }
        self.scannerController = scanner
        scanner.modalPresentationStyle = .fullScreen
        host.present(scanner, animated: true)
      }
    }
  }

  // MARK: 拍照

  @objc(takePhoto:rejecter:)
  func takePhoto(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
      reject("NO_CAMERA_APP", "未找到可用相机", nil)
      return
    }
    DispatchQueue.main.async {
      self.ensureCameraAccess { granted in
        guard granted else {
          reject("PERMISSION_DENIED", "相机权限被拒绝，请在系统设置中开启相机权限", nil)
          return
        }
        guard let host = baseTopViewController() else {
          reject("NO_ACTIVITY", "当前无可用界面", nil)
          return
        }
        self.photoResolve = resolve
        self.photoReject = reject
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier]
        picker.delegate = self
        picker.modalPresentationStyle = .fullScreen
        host.present(picker, animated: true)
      }
    }
  }

  // MARK: 相册选图

  @objc(pickImage:resolver:rejecter:)
  func pickImage(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let multiple = (options["multiple"] as? Bool) ?? false
    DispatchQueue.main.async {
      guard let host = baseTopViewController() else {
        reject("NO_ACTIVITY", "当前无可用界面", nil)
        return
      }
      self.galleryResolve = resolve
      self.galleryReject = reject
      var configuration = PHPickerConfiguration(photoLibrary: .shared())
      configuration.filter = .images
      configuration.selectionLimit = multiple ? 0 : 1
      let picker = PHPickerViewController(configuration: configuration)
      picker.delegate = self
      host.present(picker, animated: true)
    }
  }

  // MARK: 保存图片到相册

  @objc(saveImage:resolver:rejecter:)
  func saveImage(
    _ uri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = baseURL(from: uri), let image = UIImage(contentsOfFile: url.path) else {
      reject("SAVE_FAILED", "图片不存在或无法解码", nil)
      return
    }
    PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
      guard status == .authorized || status == .limited else {
        reject("PERMISSION_DENIED", "相册写入权限被拒绝，请在系统设置中开启照片权限", nil)
        return
      }
      PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.creationRequestForAsset(from: image)
      }, completionHandler: { success, error in
        if success {
          resolve(["saved": true])
        } else {
          reject("SAVE_FAILED", error?.localizedDescription ?? "保存图片失败", error)
        }
      })
    }
  }

  // MARK: 文件选择

  @objc(filePick:resolver:rejecter:)
  func filePick(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let host = baseTopViewController() else {
        reject("NO_ACTIVITY", "当前无可用界面", nil)
        return
      }
      var types: [UTType] = []
      if let accept = options["accept"] as? [String] {
        for item in accept {
          if item.contains("/"), let type = UTType(mimeType: item) {
            types.append(type)
          } else if let type = UTType(filenameExtension: item) {
            types.append(type)
          }
        }
      }
      if types.isEmpty {
        types = [UTType.item]
      }
      self.documentResolve = resolve
      self.documentReject = reject
      let delegate = BaseDocumentPickerDelegate(
        onPick: { [weak self] urls in
          self?.documentDelegate = nil
          let files = urls.map { baseFileInfo(for: $0) }
          resolve(["files": files])
        },
        onCancel: { [weak self] in
          self?.documentDelegate = nil
          resolve(["files": [String]()])
        }
      )
      self.documentDelegate = delegate
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
      picker.delegate = delegate
      picker.allowsMultipleSelection = (options["multiple"] as? Bool) ?? false
      host.present(picker, animated: true)
    }
  }

  // MARK: 读文件为 Base64

  @objc(readFileAsBase64:resolver:rejecter:)
  func readFileAsBase64(
    _ uri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = baseURL(from: uri) else {
      reject("READ_FAILED", "无效的文件地址: \(uri)", nil)
      return
    }
    do {
      var data = try Data(contentsOf: url)
      let mimeType = baseMimeType(for: url)
      // 图片先压缩：原图几 MB 走 Bridge 会超时，与 Android MAX_IMAGE_EDGE/JPEG_QUALITY 保持一致
      if mimeType.hasPrefix("image/"), let image = UIImage(data: data),
        let compressed = baseCompressedImageData(image)
      {
        data = compressed
      }
      resolve([
        "base64": data.base64EncodedString(),
        "mimeType": mimeType,
        "name": url.lastPathComponent,
        "size": data.count,
      ])
    } catch {
      reject("READ_FAILED", error.localizedDescription, error)
    }
  }

  // MARK: 文件下载

  @objc(fileDownload:resolver:rejecter:)
  func fileDownload(
    _ urlString: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: urlString) else {
      reject("DOWNLOAD_FAILED", "无效的下载地址", nil)
      return
    }
    let task = URLSession.shared.downloadTask(with: url) { tempURL, response, error in
      if let error = error {
        reject("DOWNLOAD_FAILED", error.localizedDescription, error)
        return
      }
      guard let tempURL = tempURL else {
        reject("DOWNLOAD_FAILED", "下载结果为空", nil)
        return
      }
      let suggested = response?.suggestedFilename ?? url.lastPathComponent
      let name = suggested.isEmpty ? "base_\(Int(Date().timeIntervalSince1970)).dat" : suggested
      let destination = baseUniqueFile(in: baseCacheDirectory(), name: name)
      do {
        try FileManager.default.moveItem(at: tempURL, to: destination)
        resolve(["uri": destination.absoluteString])
      } catch {
        reject("DOWNLOAD_FAILED", error.localizedDescription, error)
      }
    }
    task.resume()
  }

  // MARK: 文件打开（QuickLook 预览）

  @objc(fileOpen:resolver:rejecter:)
  func fileOpen(
    _ uri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = baseURL(from: uri), FileManager.default.fileExists(atPath: url.path) else {
      resolve(["opened": false])
      return
    }
    DispatchQueue.main.async {
      guard baseTopViewController() != nil else {
        resolve(["opened": false])
        return
      }
      let controller = UIDocumentInteractionController(url: url)
      controller.delegate = self
      self.previewController = controller
      let opened = controller.presentPreview(animated: true)
      if !opened {
        self.previewController = nil
      }
      resolve(["opened": opened])
    }
  }

  // MARK: 定位

  @objc(getCurrentPosition:rejecter:)
  func getCurrentPosition(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard CLLocationManager.locationServicesEnabled() else {
      reject("LOCATION_UNAVAILABLE", "定位服务未开启，请在系统设置中开启定位", nil)
      return
    }
    DispatchQueue.main.async {
      let manager = self.locationManager ?? CLLocationManager()
      self.locationManager = manager
      manager.delegate = self
      manager.desiredAccuracy = kCLLocationAccuracyHundredMeters

      switch manager.authorizationStatus {
      case .denied, .restricted:
        reject("PERMISSION_DENIED", "定位权限被拒绝，请在设置中开启定位权限", nil)
        return
      case .notDetermined:
        self.startLocationRequest(manager, resolve: resolve, reject: reject)
        manager.requestWhenInUseAuthorization()
        return
      default:
        self.startLocationRequest(manager, resolve: resolve, reject: reject)
        manager.requestLocation()
      }
    }
  }

  private func startLocationRequest(
    _ manager: CLLocationManager,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    finishLocation()
    locationResolve = resolve
    locationReject = reject
    let timeout = DispatchWorkItem { [weak self] in
      self?.locationManager?.stopUpdatingLocation()
      self?.failLocation("LOCATION_TIMEOUT", "定位超时，请检查定位服务或移动到开阔地带")
    }
    locationTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
  }

  private func finishLocation() {
    locationTimeout?.cancel()
    locationTimeout = nil
    locationResolve = nil
    locationReject = nil
  }

  private func failLocation(_ code: String, _ message: String) {
    let reject = locationReject
    finishLocation()
    reject?(code, message, nil)
  }

  // MARK: 剪贴板（方法名与 Android BaseCapabilitiesModule / JS 适配器一致）

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

  // MARK: 打开外部 App / 系统设置（JS 契约：appOpen / appOpenSettings / appOpenSystemSettings）

  @objc(appOpen:opts:resolver:rejecter:)
  func appOpen(
    _ packageName: String,
    opts: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let raw = packageName.trimmingCharacters(in: .whitespacesAndNewlines)
    // 安卓设置页的包名在 iOS 上对应「本 App 设置页」，其余走包名→scheme 映射。
    let candidate: String
    if raw == "com.android.settings" {
      candidate = UIApplication.openSettingsURLString
    } else if raw.contains("://") {
      candidate = raw
    } else {
      candidate = baseOpenAppSchemeByPackage[raw] ?? "\(raw)://"
    }
    guard !raw.isEmpty, let url = URL(string: candidate) else {
      resolve(["opened": false, "packageName": packageName])
      return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(url, options: [:]) { opened in
        resolve(["opened": opened, "packageName": packageName])
      }
    }
  }

  /// 跳转本应用的系统设置页。iOS 只能回到这一个入口，因此不实现分区跳转
  /// （appOpenSystemSettings 的 action 缺省，JS 侧适配器会给出 DEVICE_UNSUPPORTED）。
  @objc(appOpenSettings:rejecter:)
  func appOpenSettings(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: UIApplication.openSettingsURLString) else {
      reject("SETTINGS_UNAVAILABLE", "无法打开系统设置页", nil)
      return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(url, options: [:]) { opened in
        resolve(["opened": opened])
      }
    }
  }

  @objc(appOpenSystemSettings:resolver:rejecter:)
  func appOpenSystemSettings(
    _ action: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      // iOS 不能直达某个开关页，统一打开「本 App」的设置页（通知/相机/定位都在里面）
      guard let url = URL(string: UIApplication.openSettingsURLString) else {
        resolve(["opened": false])
        return
      }
      UIApplication.shared.open(url, options: [:]) { opened in
        resolve(["opened": opened])
      }
      _ = action
    }
  }

  // MARK: NFC（JS 契约：nfcAvailable / nfcReadTag / nfcWriteNdef）

  @objc(nfcAvailable:rejecter:)
  func nfcAvailable(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(["available": NFCNDEFReaderSession.readingAvailable])
  }

  @objc(nfcReadTag:resolver:rejecter:)
  func nfcReadTag(
    _ timeout: NSNumber?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // timeout 仅为参数兼容（iOS 会话由系统扫码窗管理）；返回结构与 Android
    // nfcReadTag 对齐：iOS 拿不到标签 UID，tagId 留空，内容放 data.content。
    _ = timeout
    startNFC(mode: .read, resolve: resolve, reject: reject)
  }

  @objc(nfcWriteNdef:resolver:rejecter:)
  func nfcWriteNdef(
    _ records: NSArray,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // Android 侧 records 为 [{type, data}]，iOS NDEF 文本写入取首条记录的 data 文本。
    let text: String
    if let first = records.firstObject as? [String: Any],
      let data = first["data"] as? String
    {
      text = data
    } else if let first = records.firstObject as? String {
      text = first
    } else {
      text = ""
    }
    guard !text.isEmpty else {
      reject("NFC_FAILED", "写入内容不能为空", nil)
      return
    }
    startNFC(mode: .write(text), resolve: resolve, reject: reject)
  }

  private func startNFC(
    mode: BaseNFCService.Mode,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard NFCNDEFReaderSession.readingAvailable else {
      reject("NFC_UNAVAILABLE", "当前设备不支持 NFC 或系统未开启", nil)
      return
    }
    DispatchQueue.main.async {
      let service = BaseNFCService(mode: mode, resolve: resolve, reject: reject)
      self.nfcService = service
      if !service.start() {
        self.nfcService = nil
        reject("NFC_UNAVAILABLE", "NFC 会话启动失败", nil)
      }
    }
  }

  // MARK: 角标

  @objc(setBadge:resolver:rejecter:)
  func setBadge(
    _ count: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let value = max(0, count.intValue)
    DispatchQueue.main.async {
      if #available(iOS 16.0, *) {
        UNUserNotificationCenter.current().setBadgeCount(value) { error in
          if let error = error {
            reject("BADGE_FAILED", error.localizedDescription, error)
          } else {
            resolve(["ok": true])
          }
        }
      } else {
        UIApplication.shared.applicationIconBadgeNumber = value
        resolve(["ok": true])
      }
    }
  }

  // MARK: 提示音

  @objc(playSound:resolver:rejecter:)
  func playSound(
    _ duration: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // 系统提示音（1007 = 三全音），duration 仅保留参数兼容，系统音效会自然结束
    AudioServicesPlaySystemSound(1007)
    resolve(["ok": true])
  }

  // MARK: 本地通知（JS 契约：sendNotification(title, content, payload) + promise）

  @objc(sendNotification:content:payload:resolver:rejecter:)
  func sendNotification(
    _ title: String,
    content: String,
    payload: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let id = autoNotificationId
    autoNotificationId += 1
    let center = UNUserNotificationCenter.current()
    let deliver: () -> Void = {
      let notificationContent = UNMutableNotificationContent()
      notificationContent.title = title.isEmpty ? "新消息" : title
      notificationContent.body = content
      notificationContent.sound = .default
      if !payload.isEmpty {
        notificationContent.userInfo = ["payload": payload]
      }
      let request = UNNotificationRequest(
        identifier: "base-notify-\(id)",
        content: notificationContent,
        trigger: nil
      )
      center.add(request) { error in
        if let error = error {
          reject("NOTIFY_FAILED", error.localizedDescription, error)
        } else {
          resolve(["ok": true, "notificationId": id])
        }
      }
    }

    center.getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral:
        deliver()
      case .notDetermined:
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
          if granted {
            deliver()
          } else {
            reject(
              "PERMISSION_DENIED",
              error?.localizedDescription ?? "通知权限被拒绝，请在系统设置中开启通知权限",
              error
            )
          }
        }
      default:
        reject("PERMISSION_DENIED", "通知权限被拒绝，请在系统设置中开启通知权限", nil)
      }
    }
  }

  @objc(getPendingNotification:rejecter:)
  func getPendingNotification(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(["payload": BasePendingNotificationStore.shared.consume()])
  }

  // MARK: 权限辅助

  private func ensureCameraAccess(_ completion: @escaping (Bool) -> Void) {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      completion(true)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async { completion(granted) }
      }
    default:
      completion(false)
    }
  }
}

// MARK: - 相册选图回调

extension BaseCapabilities: PHPickerViewControllerDelegate {
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    let resolve = galleryResolve
    let reject = galleryReject
    galleryResolve = nil
    galleryReject = nil
    guard let resolve = resolve else { return }
    if results.isEmpty {
      resolve(["files": [String]()])
      return
    }

    let group = DispatchGroup()
    let lock = NSLock()
    var files: [[String: Any]] = []
    var firstError: Error?

    for result in results {
      group.enter()
      let provider = result.itemProvider
      let typeIdentifier = provider.registeredTypeIdentifiers.first ?? UTType.image.identifier
      provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
        defer { group.leave() }
        if let error = error {
          lock.lock()
          if firstError == nil { firstError = error }
          lock.unlock()
          return
        }
        guard let url = url else { return }
        let target = baseUniqueFile(in: baseCacheDirectory(), name: url.lastPathComponent)
        do {
          try FileManager.default.copyItem(at: url, to: target)
          let info = baseFileInfo(for: target)
          lock.lock()
          files.append(info)
          lock.unlock()
        } catch {
          lock.lock()
          if firstError == nil { firstError = error }
          lock.unlock()
        }
      }
    }

    group.notify(queue: .main) {
      if files.isEmpty, let error = firstError {
        reject?("PICK_FAILED", error.localizedDescription, error)
      } else {
        resolve(["files": files])
      }
    }
  }
}

// MARK: - 拍照回调

extension BaseCapabilities: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
  func imagePickerController(
    _ picker: UIImagePickerController,
    didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
  ) {
    picker.dismiss(animated: true)
    let resolve = photoResolve
    let reject = photoReject
    photoResolve = nil
    photoReject = nil
    guard let resolve = resolve else { return }

    guard let image = (info[.originalImage] as? UIImage) ?? (info[.editedImage] as? UIImage) else {
      reject?("CAMERA_FAILED", "拍照结果为空", nil)
      return
    }
    let name = "base_photo_\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
    let target = baseUniqueFile(in: baseCacheDirectory(), name: name)
    guard let data = image.jpegData(compressionQuality: 0.9) else {
      reject?("CAMERA_FAILED", "拍照失败：无法编码图片", nil)
      return
    }
    do {
      try data.write(to: target, options: .atomic)
      resolve(["uri": target.absoluteString])
    } catch {
      reject?("CAMERA_FAILED", error.localizedDescription, error)
    }
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true)
    photoResolve?(["uri": ""])
    photoResolve = nil
    photoReject = nil
  }
}

// MARK: - 定位回调

extension BaseCapabilities: CLLocationManagerDelegate {
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard locationResolve != nil else { return }
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      manager.requestLocation()
    case .denied, .restricted:
      failLocation("PERMISSION_DENIED", "定位权限被拒绝，请在设置中开启定位权限")
    default:
      break
    }
  }

  func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
    locationManagerDidChangeAuthorization(manager)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last, locationResolve != nil else { return }
    let resolve = locationResolve
    finishLocation()
    resolve?([
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "accuracy": location.horizontalAccuracy,
      "provider": "ios",
    ])
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    guard locationResolve != nil else { return }
    failLocation("LOCATION_FAILED", error.localizedDescription)
  }
}

// MARK: - 文件预览回调

extension BaseCapabilities: UIDocumentInteractionControllerDelegate {
  func documentInteractionControllerViewControllerForPreview(
    _ controller: UIDocumentInteractionController
  ) -> UIViewController {
    baseTopViewController() ?? UIViewController()
  }

  func documentInteractionControllerDidEndPreview(_ controller: UIDocumentInteractionController) {
    previewController = nil
  }
}

// MARK: - 文件选择器 delegate

private final class BaseDocumentPickerDelegate: NSObject, UIDocumentPickerDelegate {
  private let onPick: ([URL]) -> Void
  private let onCancel: () -> Void

  init(onPick: @escaping ([URL]) -> Void, onCancel: @escaping () -> Void) {
    self.onPick = onPick
    self.onCancel = onCancel
    super.init()
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    onPick(urls)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    onCancel()
  }
}

// MARK: - 设备完整性（jailbreak 探针，对应 src/security/device-integrity.ts）

extension BaseCapabilities {
  /// 返回 'secure' | 'compromised'。JS 侧 normalizeIntegrity 接受这三种字符串或 boolean。
  /// 探测手段（公开 API，App Store 安全）：
  ///  1. 越狱特征文件存在性（Cydia / MobileSubstrate / sshd / apt 等）；
  ///  2. 沙盒逃逸探测：向 /private 写入临时文件，非越狱设备必被拒绝。
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
    if (try? "rnbase-jailbreak-probe".write(toFile: probePath, atomically: true, encoding: .utf8))
      != nil
    {
      try? FileManager.default.removeItem(atPath: probePath)
      return true
    }
    return false
  }
}

// MARK: - 扫码页（AVFoundation 自建，避免引入三方库）

private func baseAVMetadataType(for name: String) -> AVMetadataObject.ObjectType? {
  switch name.uppercased() {
  case "QR_CODE", "QRCODE", "QR":
    return .qr
  case "AZTEC":
    return .aztec
  case "CODE_128", "CODE128":
    return .code128
  case "CODE_39", "CODE39":
    return .code39
  case "CODE_93", "CODE93":
    return .code93
  case "EAN_13", "EAN13":
    return .ean13
  case "EAN_8", "EAN8":
    return .ean8
  case "UPC_E", "UPCE":
    return .upce
  case "UPC_A", "UPCA":
    // AVFoundation 没有 UPC-A 类型，UPC-A 条码会被识别成前置 0 的 EAN-13；
    // 映射到 .ean13 才能扫出来（结果里 format 会显示 EAN_13）。
    return .ean13
  case "PDF_417", "PDF417":
    return .pdf417
  case "DATA_MATRIX", "DATAMATRIX":
    return .dataMatrix
  case "ITF_14", "ITF14", "ITF":
    return .itf14
  case "INTERLEAVED_2_OF_5":
    return .interleaved2of5
  default:
    return nil
  }
}

private func baseFormatName(for type: AVMetadataObject.ObjectType) -> String {
  switch type {
  case .qr:
    return "QR_CODE"
  case .aztec:
    return "AZTEC"
  case .code128:
    return "CODE_128"
  case .code39:
    return "CODE_39"
  case .code93:
    return "CODE_93"
  case .ean13:
    return "EAN_13"
  case .ean8:
    return "EAN_8"
  case .upce:
    return "UPC_E"
  case .pdf417:
    return "PDF_417"
  case .dataMatrix:
    return "DATA_MATRIX"
  case .itf14:
    return "ITF_14"
  case .interleaved2of5:
    return "INTERLEAVED_2_OF_5"
  default:
    return type.rawValue
  }
}

private final class BaseScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "com.qux.base.scanner.session")
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var metadataOutput: AVCaptureMetadataOutput?
  private let requestedFormats: [String]
  private var finished = false
  private let promptLabel = UILabel()
  private let cancelButton = UIButton(type: .system)

  var onFinish: ((String, String) -> Void)?
  var onCancel: (() -> Void)?

  init(formats: [String]) {
    requestedFormats = formats
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    setupSession()
    setupOverlay()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    if session.inputs.isEmpty { return }
    sessionQueue.async { [weak self] in
      guard let self = self, !self.session.isRunning else { return }
      self.session.startRunning()
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    sessionQueue.async { [weak self] in
      guard let self = self, self.session.isRunning else { return }
      self.session.stopRunning()
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.bounds
  }

  private func setupSession() {
    guard let device = AVCaptureDevice.default(for: .video),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      showUnavailable("无法访问摄像头")
      return
    }
    session.addInput(input)

    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else {
      showUnavailable("无法初始化扫码输出")
      return
    }
    session.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: .main)

    var types: [AVMetadataObject.ObjectType] = []
    for name in requestedFormats {
      if let type = baseAVMetadataType(for: name) {
        types.append(type)
      }
    }
    if types.isEmpty {
      types = [
        .qr, .aztec, .code128, .code39, .code93, .ean13, .ean8, .upce,
        .pdf417, .dataMatrix, .itf14, .interleaved2of5,
      ]
    }
    let available = output.availableMetadataObjectTypes
    let supported = types.filter { available.contains($0) }
    output.metadataObjectTypes = supported.isEmpty ? available : supported
    metadataOutput = output

    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    preview.frame = view.bounds
    view.layer.addSublayer(preview)
    previewLayer = preview
  }

  private func setupOverlay() {
    promptLabel.text = "将条码放入框内，自动扫描"
    promptLabel.textColor = .white
    promptLabel.font = .systemFont(ofSize: 15, weight: .medium)
    promptLabel.textAlignment = .center
    promptLabel.numberOfLines = 0
    promptLabel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(promptLabel)

    cancelButton.setTitle("取消", for: .normal)
    cancelButton.setTitleColor(.white, for: .normal)
    cancelButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
    cancelButton.translatesAutoresizingMaskIntoConstraints = false
    cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
    view.addSubview(cancelButton)

    NSLayoutConstraint.activate([
      cancelButton.leadingAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
      cancelButton.topAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      promptLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      promptLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      promptLabel.bottomAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -48),
    ])
  }

  private func showUnavailable(_ message: String) {
    promptLabel.text = message
    promptLabel.textColor = .white
  }

  @objc private func cancelTapped() {
    guard !finished else { return }
    finished = true
    sessionQueue.async { [weak self] in
      self?.session.stopRunning()
    }
    dismiss(animated: true) { [weak self] in
      self?.onCancel?()
    }
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard !finished,
      let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
      let value = object.stringValue,
      !value.isEmpty
    else {
      return
    }
    finished = true
    sessionQueue.async { [weak self] in
      self?.session.stopRunning()
    }
    let format = baseFormatName(for: object.type)
    dismiss(animated: true) { [weak self] in
      self?.onFinish?(value, format)
    }
  }
}

// MARK: - NFC 读写服务

final class BaseNFCService: NSObject, NFCNDEFReaderSessionDelegate {
  enum Mode {
    case read
    case write(String)
  }

  private let mode: Mode
  private let resolve: RCTPromiseResolveBlock
  private let reject: RCTPromiseRejectBlock
  private var session: NFCNDEFReaderSession?
  private var finished = false

  init(mode: Mode, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    self.mode = mode
    self.resolve = resolve
    self.reject = reject
    super.init()
  }

  func start() -> Bool {
    guard NFCNDEFReaderSession.readingAvailable else { return false }
    let isRead: Bool
    if case .read = mode { isRead = true } else { isRead = false }
    let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: isRead)
    session.alertMessage = isRead ? "请将 NFC 标签靠近手机顶部" : "请将 NFC 标签靠近手机顶部以写入"
    session.begin()
    self.session = session
    return true
  }

  private func finish(_ body: [String: Any]) {
    guard !finished else { return }
    finished = true
    session?.invalidate()
    session = nil
    resolve(body)
  }

  private func fail(_ code: String, _ message: String, _ error: Error? = nil) {
    guard !finished else { return }
    finished = true
    session?.invalidate()
    session = nil
    reject(code, message, error)
  }

  func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
    if finished { return }
    if let nfcError = error as? NFCReaderError {
      switch nfcError.code {
      case .readerSessionInvalidationErrorFirstNDEFTagRead, .readerSessionInvalidationErrorUserCanceled:
        fail("USER_CANCELLED", "用户取消 NFC 操作", error)
        return
      default:
        break
      }
    }
    fail("NFC_FAILED", error.localizedDescription, error)
  }

  func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
    guard let message = messages.first, let record = message.records.first else {
      fail("NFC_EMPTY", "NFC 结果为空")
      return
    }
    // 与 Android nfcReadTag 返回结构对齐：iOS 无标签 UID，techTypes 固定 NDEF。
    finish([
      "tagId": "",
      "techTypes": ["NDEF"],
      "data": ["content": BaseNFCService.text(from: record)],
    ])
  }

  func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
    guard case let .write(text) = mode else { return }
    guard let tag = tags.first else {
      fail("NFC_FAILED", "未检测到可用 NFC 标签")
      return
    }
    session.connect(to: tag) { [weak self] error in
      guard let self = self else { return }
      if let error = error {
        self.fail("NFC_FAILED", error.localizedDescription, error)
        return
      }
      tag.queryNDEFStatus { status, _, error in
        if let error = error {
          self.fail("NFC_FAILED", error.localizedDescription, error)
          return
        }
        switch status {
        case .notSupported:
          self.fail("NFC_FAILED", "该标签不支持 NDEF 写入")
        case .readOnly:
          self.fail("NFC_FAILED", "该标签为只读，无法写入")
        default:
          tag.writeNDEF(BaseNFCService.message(with: text)) { error in
            if let error = error {
              self.fail("NFC_FAILED", error.localizedDescription, error)
            } else {
              self.finish(["ok": true])
            }
          }
        }
      }
    }
  }

  private static let uriPrefixes: [String] = [
    "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
    "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://",
    "nfs://", "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:",
    "pop:", "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
    "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:",
    "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:",
  ]

  static func text(from record: NFCNDEFPayload) -> String {
    if record.typeNameFormat == .nfcWellKnown,
      let type = String(data: record.type, encoding: .utf8)
    {
      if type == "T" {
        guard let first = record.payload.first else { return "" }
        let languageLength = Int(first & 0x3F)
        let start = min(1 + languageLength, record.payload.count)
        let body = record.payload.subdata(in: start..<record.payload.count)
        let encoding: String.Encoding = (first & 0x80) != 0 ? .utf16 : .utf8
        return String(data: body, encoding: encoding) ?? ""
      }
      if type == "U" {
        guard let first = record.payload.first else { return "" }
        let index = Int(first)
        let body = record.payload.dropFirst()
        let prefix = index < uriPrefixes.count ? uriPrefixes[index] : ""
        return prefix + (String(data: Data(body), encoding: .utf8) ?? "")
      }
    }
    return String(data: record.payload, encoding: .utf8) ?? ""
  }

  static func message(with text: String) -> NFCNDEFMessage {
    var payload = Data()
    payload.append(0x02)  // UTF-8 编码 + 2 字节语言码
    payload.append(contentsOf: Array("en".utf8))
    payload.append(contentsOf: Array(text.utf8))
    let record = NFCNDEFPayload(
      format: .nfcWellKnown,
      type: Data("T".utf8),
      identifier: Data(),
      payload: payload
    )
    return NFCNDEFMessage(records: [record])
  }
}
