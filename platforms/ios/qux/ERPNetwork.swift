/**
 * iOS 网络状态原生模块（Skill 规则 46/51）。
 *
 * 对应 RN 侧 src/network/nativeNetworkAdapter.ts 调用的
 * NativeModules.ERPNetwork。
 *
 * 注册方式：将本文件加入 Xcode 的 App Target。
 * 桥接文件 ERPNetwork.m 会自动注册。
 */
import Foundation
import Network
import React

@objc(ERPNetwork)
class ERPNetwork: NSObject, RCTBridgeModule {
  static func moduleName() -> String! { "ERPNetwork" }
  static func requiresMainQueueSetup() -> Bool { false }

  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "ERPNetworkMonitor")

  private var currentStatus: [String: Any] = [
    "connected": false,
    "type": "unknown",
  ]

  override init() {
    super.init()
    monitor.pathUpdateHandler = { [weak self] path in
      let connected = path.status == .satisfied
      let type: String
      if path.usesInterfaceType(.wifi) {
        type = "wifi"
      } else if path.usesInterfaceType(.cellular) {
        type = "cellular"
      } else if path.usesInterfaceType(.wiredEthernet) {
        type = "wired"
      } else {
        type = "none"
      }
      self?.currentStatus = [
        "connected": connected,
        "type": type,
      ]
    }
    monitor.start(queue: queue)
  }

  deinit {
    monitor.cancel()
  }

  @objc(getStatus:rejecter:)
  func getStatus(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(currentStatus)
  }
}
