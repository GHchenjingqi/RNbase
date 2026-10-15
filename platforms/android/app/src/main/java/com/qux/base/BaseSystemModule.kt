/**
 * Android 系统信息原生模块（RN 侧拿不到的常用系统状态）。
 *
 * 提供品牌/型号/系统版本/SDK 版本、电量与充电状态、总/可用存储、时区。
 * 全部读取无需额外权限：
 *  - Build.* ：设备信息
 *  - BatteryManager：电量/充电状态
 *  - StatFs：存储空间
 *
 * 另提供容器内 WebView 的硬件返回键真值查询（webViewGoBack，见方法注释）。
 */
package com.qux.base

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableNativeMap
import java.util.TimeZone

class BaseSystemModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BaseSystem"

    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            val m = WritableNativeMap()
            m.putString("brand", Build.BRAND)
            m.putString("model", Build.MODEL)
            m.putString("systemVersion", Build.VERSION.RELEASE)
            m.putInt("sdkInt", Build.VERSION.SDK_INT)

            val bm = reactContext.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            if (bm != null) {
                val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                m.putDouble("batteryLevel", if (level in 0..100) level.toDouble() else -1.0)
                m.putBoolean("isCharging", if (Build.VERSION.SDK_INT >= 23) bm.isCharging else false)
            } else {
                m.putDouble("batteryLevel", -1.0)
                m.putBoolean("isCharging", false)
            }

            val stat = StatFs(Environment.getDataDirectory().absolutePath)
            m.putDouble("totalStorage", stat.totalBytes.toDouble())
            m.putDouble("freeStorage", stat.availableBytes.toDouble())

            m.putString("timezone", TimeZone.getDefault().id)

            promise.resolve(m)
        } catch (e: Exception) {
            promise.reject("DEVICE_INFO_FAILED", e.localizedMessage)
        }
    }

    /**
     * 硬件返回键：让容器内的 WebView 回退一步（原生真值判断，判断与动作在同一原子回调里完成）。
     *
     * 为什么必须放在原生：react-native-webview v14 的 ref 上没有 canGoBack 命令
     * （命令表只有 goBack/goBackForward/reload/…，见 RNCWebViewManagerImpl.getCommandsMap），
     * JS 侧只能读导航事件里的快照，而快照在这些场景会过期或缺失 ——
     * SPA 同文档路由（pushState）、hash 路由、错误页重载、回退后再前进等。
     * 一旦快照说「退不了」，容器兜底就会去 finish Activity，
     * 表现即「子页面按一次返回键直接退出 App」。这里在按键那一刻读 WebView.canGoBack()，
     * 为真才 goBack()，从根上消掉这个误判。
     *
     * 查 WebView 用视图树遍历，不依赖 JS 侧 ref 是否已挂上（WebView 已挂载但 ref 尚未
     * 回填时，旧的 JS 判断会直接退出 App）。本包内只有一个业务 WebView，取第一个即可。
     *
     * @return true = 已回退一步；false = 当前没有可回退的历史，
     *         由 JS 侧决定后续（走「再按一次退出应用」二次确认，不再一步退出）
     */
    @ReactMethod
    fun webViewGoBack(promise: Promise) {
        // WebView 的所有方法都必须在 UI 线程调用，而 @ReactMethod 默认跑在 NativeModules 线程。
        UiThreadUtil.runOnUiThread {
            try {
                val webView = findWebView(reactContext.currentActivity?.window?.decorView)
                if (webView != null && webView.canGoBack()) {
                    webView.goBack()
                    promise.resolve(true)
                } else {
                    promise.resolve(false)
                }
            } catch (e: Exception) {
                promise.reject("WEBVIEW_BACK_FAILED", e.localizedMessage)
            }
        }
    }

    /** 视图树里找第一个 WebView（容器内唯一的业务 WebView）。 */
    private fun findWebView(view: View?): WebView? {
        if (view == null) return null
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val found = findWebView(view.getChildAt(i))
                if (found != null) return found
            }
        }
        return null
    }
}
