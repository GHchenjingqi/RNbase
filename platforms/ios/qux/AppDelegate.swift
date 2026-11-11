import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // 通知点击深链：必须在启动早期挂上 delegate，冷启动点通知时才收得到回调
    UNUserNotificationCenter.current().delegate = self

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "qux",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

// MARK: - 通知展示与点击（对齐上游基座 / Android BaseCapabilitiesModule）

extension AppDelegate: UNUserNotificationCenterDelegate {
  /// App 在前台时也展示横幅/声音/角标，与 Android 高优先级渠道行为对齐。
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound, .badge])
  }

  /// 用户点击通知：把 H5 写入的 payload 存进一次性队列，并通知 RN 侧来取。
  /// 与 Android 一致：原生不解析 payload，只负责存取；H5 起桥后 pull
  /// （RN 侧 WebViewBridge 监听 baseNotificationTap 后转 bridge 事件）。
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let userInfo = response.notification.request.content.userInfo
    if let payload = userInfo["payload"] as? String, !payload.isEmpty {
      BasePendingNotificationStore.shared.setPayload(payload)
      DispatchQueue.main.async {
        NotificationCenter.default.post(
          name: BasePendingNotificationStore.tapNotification,
          object: nil
        )
      }
    }
    completionHandler()
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
