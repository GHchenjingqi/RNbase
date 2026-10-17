package com.qux

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.qux.base.BaseCapabilitiesModule

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // 启动窗口使用 AppTheme.Splash（品牌底色 + logo 的 windowBackground）；
    // Activity 真正创建后切回 AppTheme，避免闪屏背景残留在整个页面生命周期。
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
    // 通知深链：冷启动时点通知带进来的 extra 只有这里能看到（此刻 H5 还没起来，
    // 收进模块的 pending 等它起桥后自己来取）。savedInstanceState 非空 = 进程活着重建
    // （旋转/回收），那份负载上一次已经收过了，不再重放，否则每次重建都跳一次旧消息。
    if (savedInstanceState == null) {
      BaseCapabilitiesModule.handleNotificationIntent(intent)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // 清单里 launchMode=singleTask：App 存活时点通知不会新建 Activity，只走这里。
    // 不 setIntent 的话后续再读 intent 还是老的那条。
    setIntent(intent)
    BaseCapabilitiesModule.handleNotificationIntent(intent)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "qux"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
