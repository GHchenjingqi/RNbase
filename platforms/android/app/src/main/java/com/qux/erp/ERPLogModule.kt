/**
 * Android 设备日志原生模块。
 *
 * 供 RN 侧 src/diagnostics/deviceLogger.ts 调用，将设备能力调用日志
 * 追加写入 App 私有目录 <filesDir>/logs/device-YYYY-MM-DD.log（按日期分包，
 * 同一天一个文件）。私有目录无需额外权限，debug 构建可用 adb run-as 导出。
 */
package com.qux.erp

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ERPLogModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ERPLog"

    private val logsDir: File
        get() = File(reactContext.filesDir, "logs")

    private fun dateStr(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    private fun timestamp(): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())

    private fun isLogFile(f: File): Boolean =
        f.isFile && f.name.startsWith("device-") && f.name.endsWith(".log")

    /**
     * 追加写入一条日志。按日期分包：文件名 device-<yyyy-MM-dd>.log。
     * 同步追加（日志量小，性能可接受）；失败仅 Log.w，不抛出（不影响业务）。
     */
    @ReactMethod
    fun write(level: String, message: String) {
        try {
            val dir = logsDir
            if (!dir.exists()) {
                dir.mkdirs()
            }
            val file = File(dir, "device-${dateStr()}.log")
            val line = "[${timestamp()}] [$level] $message\n"
            FileOutputStream(file, true).use { out ->
                out.write(line.toByteArray(Charsets.UTF_8))
            }
        } catch (e: Exception) {
            Log.w("ERPLog", "write log failed: $message", e)
        }
    }

    /** 返回日志目录绝对路径（用于 adb pull / 导出）。 */
    @ReactMethod
    fun getLogDir(promise: Promise) {
        promise.resolve(logsDir.absolutePath)
    }

    /** 列出所有日志文件（按修改时间倒序）。 */
    @ReactMethod
    fun listLogs(promise: Promise) {
        try {
            val arr = WritableNativeArray()
            val dir = logsDir
            if (dir.exists()) {
                dir.listFiles { f -> isLogFile(f) }
                    ?.sortedByDescending { it.lastModified() }
                    ?.forEach { f ->
                        val m = WritableNativeMap()
                        m.putString("name", f.name)
                        m.putString(
                            "date",
                            f.name.removePrefix("device-").removeSuffix(".log"),
                        )
                        m.putDouble("size", f.length().toDouble())
                        m.putString("path", f.absolutePath)
                        arr.pushMap(m)
                    }
            }
            promise.resolve(arr)
        } catch (e: Exception) {
            promise.reject("LIST_FAILED", e.localizedMessage)
        }
    }

    /** 读取指定日志文件内容（仅允许 device-*.log）。 */
    @ReactMethod
    fun readLog(name: String, promise: Promise) {
        try {
            val file = File(logsDir, name)
            if (!isLogFile(file)) {
                promise.reject("FILE_NOT_FOUND", "log file not found: $name")
                return
            }
            promise.resolve(file.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            promise.reject("READ_FAILED", e.localizedMessage)
        }
    }

    /** 清空所有日志文件，返回删除数量。 */
    @ReactMethod
    fun clearLogs(promise: Promise) {
        try {
            var cleared = 0
            val dir = logsDir
            if (dir.exists()) {
                dir.listFiles { f -> isLogFile(f) }?.forEach { f ->
                    if (f.delete()) {
                        cleared++
                    }
                }
            }
            val m = WritableNativeMap()
            m.putInt("cleared", cleared)
            promise.resolve(m)
        } catch (e: Exception) {
            promise.reject("CLEAR_FAILED", e.localizedMessage)
        }
    }
}
