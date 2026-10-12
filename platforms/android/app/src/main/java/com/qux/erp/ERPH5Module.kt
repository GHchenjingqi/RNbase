/**
 * H5 动态子包原生模块（供 RN 侧 src/storage/NativeH5Storage.ts 调用）。
 *
 * 负责动态 H5 子包的本地版本管理，目录结构：
 *   <filesDir>/h5-versions/
 *     current.json                 # current 指针：{"current":"1.0.1","previous":"1.0"}
 *     <version>/                   # 每版本解压后的子包文件
 *       manifest.json              # 该版本的 H5Manifest（含 entry）
 *       index.html ...             # 子包实际文件
 *
 * 全部在 App 私有目录内，无需额外权限；WebView 通过 file:// 加载子包入口。
 * 入口 URI 形如 file:///data/user/0/com.qux/files/h5-versions/<version>/<entry>。
 */
package com.qux.erp

import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.zip.ZipInputStream

class ERPH5Module(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ERPH5"

    private val rootDir: File
        get() = File(reactContext.filesDir, "h5-versions")

    private val currentFile: File
        get() = File(rootDir, "current.json")

    private fun versionDir(version: String): File = File(rootDir, version)

    private fun isVersionDir(f: File): Boolean =
        f.isDirectory && f.name != "current.json"

    private fun readCurrentJson(): JSONObject? {
        if (!currentFile.exists()) return null
        return try {
            JSONObject(currentFile.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            Log.w("ERPH5", "current.json 解析失败", e)
            null
        }
    }

    private fun writeCurrentAtomically(json: JSONObject): Boolean {
        if (!rootDir.exists()) rootDir.mkdirs()
        val tmp = File(rootDir, "current.json.tmp")
        return try {
            tmp.writeText(json.toString(), Charsets.UTF_8)
            tmp.renameTo(currentFile)
        } catch (e: Exception) {
            Log.w("ERPH5", "写 current.json 失败", e)
            false
        }
    }

    private fun hex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xFF
            sb.append(Character.forDigit(v ushr 4, 16))
            sb.append(Character.forDigit(v and 0x0F, 16))
        }
        return sb.toString()
    }

    /** 返回 H5 版本根目录绝对路径。 */
    @ReactMethod
    fun getVersionsDir(promise: Promise) {
        promise.resolve(rootDir.absolutePath)
    }

    /** 列出所有已安装版本号。 */
    @ReactMethod
    fun listVersions(promise: Promise) {
        try {
            val arr = WritableNativeArray()
            rootDir.listFiles { f -> isVersionDir(f) }
                ?.sortedBy { it.name }
                ?.forEach { arr.pushString(it.name) }
            promise.resolve(arr)
        } catch (e: Exception) {
            promise.reject("LIST_FAILED", e.localizedMessage)
        }
    }

    /**
     * 安装子包：base64(zip) 解压到 <root>/<version>/，并写入 manifest.json。
     * 若该版本已存在则先删除（重新安装）。
     */
    @ReactMethod
    fun install(version: String, base64Zip: String, manifestJson: String, promise: Promise) {
        try {
            if (version.isBlank()) {
                promise.reject("INVALID_PARAMS", "version 为空")
                return
            }
            if (!rootDir.exists()) rootDir.mkdirs()
            val dir = versionDir(version)
            if (dir.exists()) {
                dir.deleteRecursively()
            }
            if (!dir.mkdirs()) {
                promise.reject("INSTALL_FAILED", "创建版本目录失败: $version")
                return
            }

            val bytes = Base64.decode(base64Zip, Base64.DEFAULT)
            val entry = try {
                unzip(bytes, dir)
            } catch (e: Exception) {
                dir.deleteRecursively()
                promise.reject("UNZIP_FAILED", "解压失败: ${e.localizedMessage}")
                return
            }

            // 写 manifest.json
            val manifestFile = File(dir, "manifest.json")
            manifestFile.writeText(manifestJson, Charsets.UTF_8)

            val m = WritableNativeMap()
            m.putString("version", version)
            m.putString("entry", entry)
            m.putInt("fileCount", entryFileCount(dir))
            promise.resolve(m)
        } catch (e: Exception) {
            promise.reject("INSTALL_FAILED", e.localizedMessage)
        }
    }

    /** 解压 zip 到目标目录，返回入口文件（index.html 优先）。 */
    private fun unzip(zipBytes: ByteArray, targetDir: File): String {
        var entryPath = "index.html"
        var count = 0
        val targetCanonical = targetDir.canonicalPath
        ZipInputStream(java.io.ByteArrayInputStream(zipBytes)).use { zis ->
            var ze = zis.nextEntry
            while (ze != null) {
                val name = ze.name
                if (name.isBlank() || name.contains("..") || name.startsWith("/") || name.contains("\\")) {
                    ze = zis.nextEntry
                    continue
                }
                val outFile = File(targetDir, name)
                val canonical = outFile.canonicalPath
                if (canonical != targetCanonical && !canonical.startsWith(targetCanonical + File.separator)) {
                    ze = zis.nextEntry
                    continue
                }
                if (ze.isDirectory) {
                    outFile.mkdirs()
                } else {
                    outFile.parentFile?.mkdirs()
                    FileOutputStream(outFile).use { out -> zis.copyTo(out, 64 * 1024) }
                    count++
                    if (name.equals("index.html", ignoreCase = true)) {
                        entryPath = name
                    }
                }
                zis.closeEntry()
                ze = zis.nextEntry
            }
        }
        return entryPath
    }

    /** 统计版本目录下文件数（排除 manifest.json）。 */
    private fun entryFileCount(dir: File): Int {
        var count = 0
        dir.walkTopDown().forEach { f ->
            if (f.isFile && f.name != "manifest.json") count++
        }
        return count
    }

    /** 读取指定版本 manifest，返回其 JSON 对象。 */
    @ReactMethod
    fun getManifest(version: String, promise: Promise) {
        try {
            val f = File(versionDir(version), "manifest.json")
            if (!f.exists()) {
                promise.reject("NOT_FOUND", "version manifest not found: $version")
                return
            }
            promise.resolve(f.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            promise.reject("READ_FAILED", e.localizedMessage)
        }
    }

    /** 获取当前激活版本号（无则 null）。 */
    @ReactMethod
    fun getCurrentVersion(promise: Promise) {
        val json = readCurrentJson()
        promise.resolve(json?.optString("current", null))
    }

    /** 获取上一个版本号（无则 null）。 */
    @ReactMethod
    fun getPreviousVersion(promise: Promise) {
        val json = readCurrentJson()
        promise.resolve(json?.optString("previous", null))
    }

    /** 原子激活指定版本（切换 current 指针，previous 记为旧 current）。 */
    @ReactMethod
    fun activate(version: String, promise: Promise) {
        try {
            if (!versionDir(version).exists()) {
                promise.reject("NOT_INSTALLED", "版本未安装: $version")
                return
            }
            val json = readCurrentJson() ?: JSONObject()
            val old = json.optString("current", null)
            val next = JSONObject()
            next.put("current", version)
            if (old != null && old != version) {
                next.put("previous", old)
            } else {
                next.put("previous", json.optString("previous", null))
            }
            if (!writeCurrentAtomically(next)) {
                promise.reject("ACTIVATE_FAILED", "切换 current 指针失败")
                return
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ACTIVATE_FAILED", e.localizedMessage)
        }
    }

    /** 回滚到指定历史版本（必须是已安装版本）。 */
    @ReactMethod
    fun rollback(version: String, promise: Promise) {
        activate(version, promise)
    }

    /** 删除指定版本目录。 */
    @ReactMethod
    fun remove(version: String, promise: Promise) {
        try {
            val dir = versionDir(version)
            val deleted = dir.exists() && dir.deleteRecursively()
            val json = readCurrentJson()
            if (json != null && json.optString("current", null) == version) {
                json.put("current", null)
                writeCurrentAtomically(json)
            }
            promise.resolve(deleted)
        } catch (e: Exception) {
            promise.reject("REMOVE_FAILED", e.localizedMessage)
        }
    }

    /** 返回当前激活版本的入口 file:// URI（无激活版本返回 null）。 */
    @ReactMethod
    fun getActiveEntry(promise: Promise) {
        try {
            val json = readCurrentJson()
            val current = json?.optString("current", null)
            if (current.isNullOrEmpty()) {
                promise.resolve(null)
                return
            }
            val manifestFile = File(versionDir(current), "manifest.json")
            if (!manifestFile.exists()) {
                promise.resolve(null)
                return
            }
            val m = JSONObject(manifestFile.readText(Charsets.UTF_8))
            val entry = m.optString("entry", "index.html")
            val entryFile = File(versionDir(current), entry)
            if (!entryFile.exists()) {
                promise.resolve(null)
                return
            }
            promise.resolve("file://" + entryFile.absolutePath)
        } catch (e: Exception) {
            promise.reject("READ_FAILED", e.localizedMessage)
        }
    }

    /** 计算 base64 数据的 SHA-256（hex 小写）。 */
    @ReactMethod
    fun sha256(base64Data: String, promise: Promise) {
        try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            promise.resolve(hex(digest))
        } catch (e: Exception) {
            promise.reject("HASH_FAILED", e.localizedMessage)
        }
    }

    /** 清空所有版本（含 current 指针）。 */
    @ReactMethod
    fun clearAll(promise: Promise) {
        try {
            rootDir.deleteRecursively()
            rootDir.mkdirs()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLEAR_FAILED", e.localizedMessage)
        }
    }
}
