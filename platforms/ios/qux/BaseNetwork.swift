/**
 * iOS 网络状态原生模块（Skill 规则 46/51）。
 *
 * 对应 RN 侧 src/middleware/network/native-network-adapter.ts 调用的
 * NativeModules.BaseNetwork。
 *
 * 桥接：RCT_EXTERN_MODULE 声明在 BaseBridge.m（Swift 类不会自动注册）。
 */
import Foundation
import Network
import React

@objc(BaseNetwork)
class BaseNetwork: NSObject {

  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "BaseNetworkMonitor")

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
