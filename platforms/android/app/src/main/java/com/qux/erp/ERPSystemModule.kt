/**
 * Android 系统信息原生模块（RN 侧拿不到的常用系统状态）。
 *
 * 提供品牌/型号/系统版本/SDK 版本、电量与充电状态、总/可用存储、时区。
 * 全部读取无需额外权限：
 *  - Build.* ：设备信息
 *  - BatteryManager：电量/充电状态
 *  - StatFs：存储空间
 */
package com.qux.erp

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.util.TimeZone

class ERPSystemModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ERPSystem"

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
}
