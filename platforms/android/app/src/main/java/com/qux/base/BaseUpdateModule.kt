/**
 * Android 远程全量升级原生模块（整包替换，与 BaseH5Module 的子包增量更新互不相干）。
 *
 * 对应 RN 侧 src/middleware/native/update-native-adapter.ts 调用的
 * NativeModules.BaseUpdate，注册方式：MainApplication.kt 的
 * packageList.add(BaseUpdatePackage())。iOS 无自装通道，不做实现。
 *
 * 为什么下载与查询拆成 startDownload + getProgress 两个方法：
 * H5 侧 Bridge 请求超时是 30s（scripts/api.js TIMEOUT_MS），几十 MB 的 APK
 * 用单个 Promise 等待必然超时；改成「触发 + 轮询」后每次调用都在毫秒级返回，
 * 且用户把 App 切到后台时原生线程仍在下载。
 *
 * 落盘位置 getExternalFilesDir(null)/update：已被 file_paths.xml 的
 * external_files（path="."）覆盖，FileProvider 可直接授权给安装器。
 */
package com.qux.base

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeMap
import java.io.File
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

class BaseUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BaseUpdate"

    private val executor = Executors.newSingleThreadExecutor()
    private val stateLock = Any()

    /** idle | downloading | completed | failed | cancelled */
    private var state: String = "idle"
    private var received: Long = 0
    private var total: Long = 0
    private var errorCode: String = ""
    private var errorMessage: String = ""
    private var apkFile: File? = null
    private var apkSha256: String = ""
    /**
     * 下载任务代号：每次 startDownload 自增。旧线程被取消后仍可能跑完最后几块，
     * 代号不一致就丢弃它的状态写入，否则会把新一轮下载判成 cancelled/failed。
     */
    private var taskGeneration: Long = 0
    @Volatile
    private var cancelRequested = false

    // ------------------------------------------------------------------
    // 信息
    // ------------------------------------------------------------------

    /**
     * H5 判定是否需要升级所需的本地信息。
     * 后端只给版本串（如 1.0.2），所以 H5 拿 versionName 比对；
     * versionCode 读不到时回 -1，H5 据此判定「没拿到真实包信息」直接不提示。
     */
    @ReactMethod
    fun getInfo(promise: Promise) {
        val map = WritableNativeMap()
        map.putString("platform", "android")
        map.putBoolean("apkInstall", true)
        var installedVersion = ""
        try {
            val info = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
            installedVersion = info.versionName ?: ""
            map.putString("versionName", installedVersion)
            map.putDouble("versionCode", versionCodeOf(info).toDouble())
        } catch (e: Exception) {
            map.putString("versionName", "")
            map.putDouble("versionCode", -1.0)
        }
        map.putBoolean("canRequestInstall", canRequestInstall())
        map.putString("updateDir", updateDir().absolutePath)
        deleteInstalledPackage(installedVersion)
        synchronized(stateLock) { appendTaskState(map) }
        promise.resolve(map)
    }

    /**
     * 升级装上之后进程是重启的，内存里没有任何任务态，磁盘上只剩那个几十 MB 的包；
     * 而 H5 侧的清理挂在版本比对之后，会被 24h 节流挡在门外。所以包名里的版本段
     * 等于当前版本名就直接删掉 —— 不这样，旧包最坏要在机上留一整天以上。
     */
    private fun deleteInstalledPackage(installedVersion: String) {
        if (installedVersion.isEmpty()) return
        val name = "qux-${safeVersionTag(installedVersion)}.apk"
        val downloading = synchronized(stateLock) { state == "downloading" }
        if (downloading) return
        val files = updateDir().listFiles() ?: return
        files.forEach { f -> if (f.isFile && f.name == name) f.delete() }
    }

    private fun versionCodeOf(info: android.content.pm.PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }

    private fun appendTaskState(map: WritableNativeMap) {
        map.putString("taskState", state)
        map.putDouble("received", received.toDouble())
        map.putDouble("total", total.toDouble())
        map.putString("errorCode", errorCode)
        map.putString("errorMessage", errorMessage)
        map.putString("sha256", apkSha256)
        val file = apkFile
        if (file != null && file.exists()) {
            map.putString("apkPath", file.absolutePath)
            map.putDouble("apkSize", file.length().toDouble())
        } else {
            map.putString("apkPath", "")
            map.putDouble("apkSize", 0.0)
        }
    }

    // ------------------------------------------------------------------
    // 下载
    // ------------------------------------------------------------------

    /**
     * 触发下载（立即返回，不阻塞桥）。
     * 参数：{ url, version, sha256?, size? } —— version 是后端给的版本串（如 1.0.2），只用于文件名。
     * 目标文件已存在且校验通过时直接进 completed，避免重复下载几十 MB。
     */
    @ReactMethod
    fun startDownload(opts: ReadableMap?, promise: Promise) {
        val url = (opts?.getString("url") ?: "").trim()
        val version = (opts?.getString("version") ?: "").trim()
        val expectedSha = (opts?.getString("sha256") ?: "").lowercase().trim()
        val expectedSize = if (opts != null && opts.hasKey("size")) opts.getDouble("size").toLong() else 0L

        if (!(url.startsWith("http://") || url.startsWith("https://"))) {
            promise.reject("INVALID_PARAMS", "下载地址必须是 http(s) 链接"); return
        }
        if (version.isEmpty()) {
            promise.reject("INVALID_PARAMS", "version 不能为空"); return
        }

        val generation: Long
        synchronized(stateLock) {
            // 同一目标版本正在下载时不重复起任务
            if (state == "downloading") {
                promise.resolve(snapshotStarted()); return
            }
            state = "downloading"
            received = 0
            total = expectedSize
            errorCode = ""
            errorMessage = ""
            apkSha256 = ""
            cancelRequested = false
            generation = taskGeneration + 1L
            taskGeneration = generation
            apkFile = File(updateDir(), "qux-${safeVersionTag(version)}.apk")
        }

        promise.resolve(snapshotStarted())
        executor.execute { runDownload(url, expectedSha, expectedSize, generation) }
    }

    /** 版本串只当作文件名片段：把非「字母数字._-」的字符换成下划线，杜绝路径穿越。 */
    private fun safeVersionTag(version: String): String =
        version.map { if (it.isLetterOrDigit() || it == '.' || it == '_' || it == '-') it else '_' }.joinToString("")

    private fun snapshotStarted(): WritableNativeMap {
        val map = WritableNativeMap()
        map.putBoolean("started", true)
        synchronized(stateLock) { map.putString("taskState", state) }
        return map
    }

    /** 轮询下载状态（毫秒级返回，H5 侧建议 500ms 一次）。 */
    @ReactMethod
    fun getProgress(promise: Promise) {
        val map = WritableNativeMap()
        synchronized(stateLock) { appendTaskState(map) }
        promise.resolve(map)
    }

    @ReactMethod
    fun cancelDownload(promise: Promise) {
        cancelRequested = true
        val map = WritableNativeMap()
        map.putBoolean("ok", true)
        promise.resolve(map)
    }

    private fun runDownload(url: String, expectedSha: String, expectedSize: Long, generation: Long) {
        val target = synchronized(stateLock) { apkFile } ?: return
        try {
            ensureDir(target.parentFile)
            val diskOk = hasRoom(target.parentFile, if (expectedSize > 0) expectedSize else ESTIMATED_APK_SIZE)
            if (!diskOk) {
                fail("NO_SPACE", "存储空间不足，请清理后重试", generation)
                return
            }

            // 复用旧包的前提是后端给了指纹且校验通过；没有指纹时宁可重下几十 MB，
            // 也不把上个进程残留、无法证明完整的包当成可安装的升级包。
            if (target.exists() && target.length() > 0 && expectedSha.isNotEmpty()) {
                val existing = sha256Of(target)
                if (existing.equals(expectedSha, ignoreCase = true)) {
                    synchronized(stateLock) {
                        if (taskGeneration == generation) {
                            apkSha256 = existing
                            received = target.length()
                            total = target.length()
                            state = "completed"
                        }
                    }
                    return
                }
                target.delete()
            }

            // 代号进文件名：取消后旧线程删的只会是它自己那一轮的 .part
            val part = File(target.parentFile, "${target.name}.$generation.part")
            part.delete()

            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", "rn-base-update/1.0")
            try {
                val code = conn.responseCode
                if (code != HttpURLConnection.HTTP_OK) {
                    val reason = if (code == HttpURLConnection.HTTP_NOT_FOUND) {
                        "升级包不存在（404），请联系管理员核对下载地址"
                    } else {
                        "服务器返回 HTTP $code"
                    }
                    fail("HTTP_$code", reason, generation)
                    return
                }
                val length = conn.contentLength.toLong()
                if (length > 0) {
                    synchronized(stateLock) {
                        if (taskGeneration == generation) total = length
                    }
                }

                val digest = MessageDigest.getInstance("SHA-256")
                var sum = 0L
                conn.inputStream.use { input ->
                    part.outputStream().use { out ->
                        val buffer = ByteArray(16 * 1024)
                        while (true) {
                            if (cancelRequested) {
                                part.delete()
                                synchronized(stateLock) {
                                    if (taskGeneration == generation) state = "cancelled"
                                }
                                return
                            }
                            val n = input.read(buffer)
                            if (n <= 0) break
                            digest.update(buffer, 0, n)
                            out.write(buffer, 0, n)
                            sum += n
                            synchronized(stateLock) {
                                if (taskGeneration == generation) received = sum
                            }
                        }
                        out.flush()
                    }
                }
                conn.disconnect()

                if (expectedSize > 0 && sum != expectedSize) {
                    part.delete()
                    fail("SIZE_MISMATCH", "下载不完整（期望 $expectedSize 字节，实际 $sum 字节），请重试", generation)
                    return
                }
                // 后端只给 {version,url}，没有指纹，所以这里用 zip 魔数把「200 回来的其实是
                // nginx 错误页/登录页」这类事故挡在安装器之前 —— 否则用户只会看到系统报解析失败。
                if (!looksLikeApk(part)) {
                    part.delete()
                    fail("NOT_APK", "下载到的不是安装包，请联系管理员核对下载地址", generation)
                    return
                }
                val sha = toHex(digest.digest())
                if (expectedSha.isNotEmpty() && !sha.equals(expectedSha, ignoreCase = true)) {
                    part.delete()
                    fail("SHA256_MISMATCH", "升级包校验不通过，文件已删除，请重试或联系管理员", generation)
                    return
                }
                if (!part.renameTo(target)) {
                    part.delete()
                    fail("RENAME_FAILED", "升级包保存失败，请重试", generation)
                    return
                }
                synchronized(stateLock) {
                    if (taskGeneration == generation) {
                        received = target.length()
                        total = target.length()
                        apkSha256 = sha
                        state = "completed"
                    }
                }
            } catch (e: Exception) {
                part.delete()
                failNetwork(e, generation)
            }
        } catch (e: OutOfMemoryError) {
            fail("DOWNLOAD_FAILED", "下载失败：内存不足", generation)
        } catch (e: Exception) {
            failNetwork(e, generation)
        }
    }

    private fun failNetwork(e: Exception, generation: Long) {
        val code = when (e) {
            is SocketTimeoutException -> "TIMEOUT"
            is java.net.UnknownHostException -> "NETWORK_UNREACHABLE"
            is java.net.ConnectException -> "CONNECT_FAILED"
            is javax.net.ssl.SSLException -> "SSL_ERROR"
            else -> "DOWNLOAD_FAILED"
        }
        fail(code, e.localizedMessage ?: "下载失败", generation)
    }

    /** 只允许当前代号的下载写状态：被取消的旧线程晚到时直接忽略。 */
    private fun fail(code: String, message: String, generation: Long) {
        synchronized(stateLock) {
            if (taskGeneration != generation) return
            state = "failed"
            errorCode = code
            errorMessage = message
        }
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n <= 0) break
                digest.update(buffer, 0, n)
            }
        }
        return toHex(digest.digest())
    }

    /** 负 byte 直接 %02x 会符号扩展成 8 位（0xFF → "ffffffff"），必须先按位与。 */
    private fun toHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }

    /** APK 就是 zip：头 4 字节必须是 PK\x03\x04。读不够 4 字节直接判否。 */
    private fun looksLikeApk(file: File): Boolean =
        try {
            file.inputStream().use { input ->
                val head = ByteArray(4)
                if (input.read(head) != head.size) {
                    false
                } else {
                    head[0] == 'P'.code.toByte() && head[1] == 'K'.code.toByte() &&
                        head[2] == 0x03.toByte() && head[3] == 0x04.toByte()
                }
            }
        } catch (e: Exception) {
            false
        }

    // ------------------------------------------------------------------
    // 安装
    // ------------------------------------------------------------------

    /** 是否已授予「安装未知应用」权限（Android 8.0 起才有；更低版本返回 true）。 */
    @ReactMethod
    fun canRequestInstallCheck(promise: Promise) {
        val map = WritableNativeMap()
        map.putBoolean("granted", canRequestInstall())
        promise.resolve(map)
    }

    private fun canRequestInstall(): Boolean {
        // 8.0 以下没有「安装未知应用」按应用授权的概念，装了就能装
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return try {
            reactContext.packageManager.canRequestPackageInstalls()
        } catch (e: Exception) {
            false
        }
    }

    /** 跳转系统「安装未知应用」授权页（授权后需回到 App 再点一次安装）。 */
    @ReactMethod
    fun openInstallSettings(promise: Promise) {
        val activity = reactContext.currentActivity
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            val map = WritableNativeMap()
            map.putBoolean("opened", false)
            promise.resolve(map)
            return
        }
        try {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:${reactContext.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            (activity ?: reactContext).startActivity(intent)
            val map = WritableNativeMap()
            map.putBoolean("opened", true)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("SETTINGS_UNAVAILABLE", e.localizedMessage ?: "打不开系统授权页")
        }
    }

    /**
     * 拉起系统安装器。
     * 必须用 FileProvider 的 content:// —— Android 7.0+ 传 file:// 会抛 FileUriExposedException；
     * 且必须带 FLAG_GRANT_READ_URI_PERMISSION，否则安装器读不到 app 私有目录里的包。
     */
    @ReactMethod
    fun install(promise: Promise) {
        val file: File? = synchronized(stateLock) { apkFile }
        if (file == null || !file.exists() || file.length() <= 0) {
            promise.reject("APK_MISSING", "升级包不存在，请先完成下载"); return
        }
        if (!canRequestInstall()) {
            promise.reject("INSTALL_PERMISSION_DENIED", "未授予「安装未知应用」权限"); return
        }
        val activity = reactContext.currentActivity ?: reactContext.applicationContext
        try {
            val uri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileprovider",
                file,
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            // 不预先 resolveActivity：Android 11+ 的包可见性限制会让它误判成「无安装器」。
            activity.startActivity(intent)
            val map = WritableNativeMap()
            map.putBoolean("launched", true)
            map.putString("apkPath", file.absolutePath)
            promise.resolve(map)
        } catch (e: android.content.ActivityNotFoundException) {
            promise.reject("NO_INSTALLER", "系统里没有能打开安装包的应用")
        } catch (e: Exception) {
            // 装机被系统安全策略拦下（如华为纯净模式）时不会走到安装器界面，
            // 这里把原始异常文案带出去，H5 据此提示「手动安装」兜底路径。
            promise.reject("INSTALL_FAILED", e.localizedMessage ?: "无法拉起安装界面")
        }
    }

    /**
     * 把升级包复制到系统「下载」目录，供用户在文件管理器 / 下载 App 里手动点开。
     * 用于拉起安装器失败的兜底（厂商 ROM 的纯净模式会静默拦掉安装）。
     * 依赖 MediaStore.Downloads，仅 Android 10 起支持。
     */
    @ReactMethod
    fun copyToDownloads(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            promise.reject("UNSUPPORTED", "当前系统版本不支持导出到下载目录"); return
        }
        val file: File? = synchronized(stateLock) { apkFile }
        if (file == null || !file.exists()) {
            promise.reject("APK_MISSING", "升级包不存在，请先完成下载"); return
        }
        val resolver = reactContext.contentResolver
        try {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, file.name)
                put(MediaStore.Downloads.MIME_TYPE, "application/vnd.android.package-archive")
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/update")
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: run {
                    promise.reject("COPY_FAILED", "无法写入下载目录"); return
                }
            resolver.openOutputStream(uri)?.use { out ->
                file.inputStream().use { input -> input.copyTo(out) }
            }
            val map = WritableNativeMap()
            map.putBoolean("ok", true)
            map.putString("displayName", file.name)
            map.putString("path", "内部存储/Download/update/${file.name}")
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("COPY_FAILED", e.localizedMessage ?: "导出失败")
        }
    }

    /** 删除已下载的升级包（升级完成或用户不再需要时调用，几十 MB 不能长期占着）。 */
    @ReactMethod
    fun cleanup(promise: Promise) {
        var deleted = 0L
        val dir = updateDir()
        val files = dir.listFiles() ?: emptyArray()
        files.forEach { f ->
            if (f.isFile && (f.name.endsWith(".apk") || f.name.endsWith(".part"))) {
                deleted += f.length()
                f.delete()
            }
        }
        synchronized(stateLock) {
            state = "idle"
            apkFile = null
            received = 0
            total = 0
            errorCode = ""
            errorMessage = ""
            apkSha256 = ""
        }
        val map = WritableNativeMap()
        map.putBoolean("ok", true)
        map.putDouble("freedBytes", deleted.toDouble())
        promise.resolve(map)
    }

    // ------------------------------------------------------------------
    // 工具
    // ------------------------------------------------------------------

    /**
     * 升级包目录。兜底用 cacheDir —— file_paths.xml 里 cache-path 与 external-files-path
     * 都有声明，换成 filesDir 会让 FileProvider 报「Couldn't find public external storage」类错。
     */
    private fun updateDir(): File =
        File(reactContext.getExternalFilesDir(null) ?: reactContext.cacheDir, "update")

    private fun ensureDir(dir: File?) {
        if (dir == null) return
        if (!dir.exists()) dir.mkdirs()
    }

    private fun hasRoom(dir: File?, needBytes: Long): Boolean {
        if (dir == null) return false
        return try {
            val stat = StatFs(dir.absolutePath)
            stat.availableBytes > needBytes + RESERVED_FREE_BYTES
        } catch (e: Exception) {
            true
        }
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS = 15000
        private const val READ_TIMEOUT_MS = 30000
        private const val ESTIMATED_APK_SIZE = 60L * 1024 * 1024
        private const val RESERVED_FREE_BYTES = 10L * 1024 * 1024
    }
}
