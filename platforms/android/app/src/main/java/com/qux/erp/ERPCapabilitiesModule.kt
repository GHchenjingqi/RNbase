/**
 * Android 能力原生模块（Skill 规则 11/13/51）。
 *
 * 对应 RN 侧 src/middleware/native/capabilityNativeAdapters.ts 调用的
 * NativeModules.ERPCapabilities。
 *
 * 注册方式：在 MainApplication.kt 的 packageList 中 add(ERPCapabilitiesPackage())。
 */
package com.qux.erp

import android.app.Activity
import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.google.zxing.integration.android.IntentIntegrator
import com.google.zxing.integration.android.IntentResult
import me.leolin.shortcutbadger.ShortcutBadger
import java.io.File
import java.io.FileOutputStream
import java.net.URL

class ERPCapabilitiesModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ERPCapabilities"

    private var pendingPromise: Promise? = null
    private var pendingRequestCode = -1

    /** 拍照时通过 EXTRA_OUTPUT 指定的全尺寸图片 Uri（onActivityResult 时 data 为 null）。 */
    private var pendingCameraUri: Uri? = null

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?,
        ) {
            if (requestCode != pendingRequestCode || pendingPromise == null) return
            val promise = pendingPromise ?: return
            pendingPromise = null
            pendingRequestCode = -1

            // 用户取消：返回空结果（用 WritableNativeMap 避免 Kotlin 集合类型转换崩溃）
            if (resultCode != Activity.RESULT_OK) {
                when (requestCode) {
                    REQUEST_CAMERA -> {
                        val result = WritableNativeMap().apply { putString("uri", "") }
                        promise.resolve(result)
                    }
                    REQUEST_PICK -> {
                        val result = WritableNativeMap().apply { putArray("files", WritableNativeArray()) }
                        promise.resolve(result)
                    }
                    REQUEST_MLKIT_SCAN -> {
                        promise.reject("USER_CANCELLED", "用户取消扫码")
                    }
                    IntentIntegrator.REQUEST_CODE -> {
                        promise.reject("USER_CANCELLED", "用户取消扫码")
                    }
                }
                pendingCameraUri = null
                return
            }

            when (requestCode) {
                REQUEST_CAMERA -> {
                    // 用了 EXTRA_OUTPUT，全尺寸图片已写入 pendingCameraUri，data 通常为 null
                    val mediaUri = pendingCameraUri
                    pendingCameraUri = null
                    if (mediaUri != null) {
                        // 复制到 cacheDir 返回 file://，WebView 可直接加载
                        val fileUri = copyToCacheDir(mediaUri)
                        val result = WritableNativeMap().apply { putString("uri", fileUri) }
                        promise.resolve(result)
                    } else {
                        val result = WritableNativeMap().apply { putString("uri", "") }
                        promise.resolve(result)
                    }
                }
                REQUEST_PICK -> {
                    val uri = data?.data
                    if (uri != null) {
                        // 复制到 cacheDir 返回 file://，WebView 可直接加载
                        val fileUri = copyToCacheDir(uri)
                        val fileMap = buildFileMap(uri).apply {
                            putString("uri", fileUri)
                        }
                        val filesArray = WritableNativeArray().apply { pushMap(fileMap) }
                        val result = WritableNativeMap().apply { putArray("files", filesArray) }
                        promise.resolve(result)
                    } else {
                        val result = WritableNativeMap().apply { putArray("files", WritableNativeArray()) }
                        promise.resolve(result)
                    }
                }
                REQUEST_MLKIT_SCAN -> {
                    val code = data?.getStringExtra(MLKitScanActivity.EXTRA_RESULT_CODE)
                    val format = data?.getStringExtra(MLKitScanActivity.EXTRA_RESULT_FORMAT) ?: ""
                    if (!code.isNullOrEmpty()) {
                        val result = WritableNativeMap().apply {
                            putString("code", code)
                            putString("format", format)
                        }
                        promise.resolve(result)
                    } else {
                        promise.reject("SCAN_EMPTY", "扫码结果为空")
                    }
                }
                IntentIntegrator.REQUEST_CODE -> {
                    val scanResult = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
                    val code = scanResult?.contents
                    if (!code.isNullOrEmpty()) {
                        val formatName = scanResult.formatName ?: ""
                        val result = WritableNativeMap().apply {
                            putString("code", code)
                            putString("format", formatName)
                        }
                        promise.resolve(result)
                    } else {
                        promise.reject("SCAN_EMPTY", "扫码结果为空")
                    }
                }
                else -> promise.resolve(null)
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
    }

    /**
     * 扫码：基于 zxing-android-embedded 实现，支持条形码/二维码。
     *
     * @param formats 可选，期望识别的码格式字符串数组（如 ["CODE_128", "EAN_13"]）。
     *                传 null 或空数组表示自动识别所有格式（ALL_CODE_TYPES）。
     *                常用值：CODE_128 / CODE_39 / EAN_13 / EAN_8 / UPC_A / QR_CODE / DATA_MATRIX 等。
     * @param promise Promise，成功 resolve { code: 内容, format: 码格式 }，失败 reject。
     *
     * 流程：检查相机权限 → 已有则直接启动扫码；无则通过 PermissionAwareActivity 请求权限，
     * 授权后在 PermissionListener 回调中启动扫码。
     * onActivityResult 中用 IntentIntegrator.parseActivityResult 解析。
     */
    @ReactMethod
    fun scan(formats: com.facebook.react.bridge.ReadableArray?, promise: Promise) {
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "当前无 Activity"); return
        }
        // 解析格式列表：null / 空 → 自动识别所有格式
        val formatList = formats?.let { arr ->
            (0 until arr.size()).mapNotNull { i ->
                try { arr.getString(i) } catch (_: Exception) { null }
            }.filter { it.isNotBlank() }
        }?.takeIf { it.isNotEmpty() }

        val hasPermission = ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.CAMERA,
        ) == PackageManager.PERMISSION_GRANTED
        if (hasPermission) {
            pendingPromise = promise
            pendingRequestCode = IntentIntegrator.REQUEST_CODE
            startScan(activity, formatList)
            return
        }
        // 未授权：通过 RN 的 PermissionAwareActivity 请求权限，回调中处理结果
        val permissionAware = activity as? PermissionAwareActivity ?: run {
            promise.reject("NO_PERMISSION_SUPPORT", "当前 Activity 不支持权限请求"); return
        }
        pendingPromise = promise
        pendingRequestCode = REQUEST_SCAN_PERMISSION
        permissionAware.requestPermissions(
            arrayOf(Manifest.permission.CAMERA),
            REQUEST_SCAN_PERMISSION,
            object : PermissionListener {
                override fun onRequestPermissionsResult(
                    requestCode: Int,
                    permissions: Array<String>,
                    grantResults: IntArray,
                ): Boolean {
                    if (requestCode != REQUEST_SCAN_PERMISSION) return false
                    val granted = grantResults.isNotEmpty() &&
                        grantResults[0] == PackageManager.PERMISSION_GRANTED
                    if (granted) {
                        pendingRequestCode = IntentIntegrator.REQUEST_CODE
                        startScan(activity, formatList)
                    } else {
                        val p = pendingPromise
                        pendingPromise = null
                        pendingRequestCode = -1
                        p?.reject("PERMISSION_DENIED", "相机权限被拒绝，请在设置中开启相机权限")
                    }
                    return true // 返回 true 表示该 listener 可被移除
                }
            },
        )
    }

    /**
     * 启动 ZXing 扫码界面（调用前需确保已有相机权限）。
     * ZXing 行扫描算法速度极快（每帧几毫秒），对标准条形码/二维码识别准确。
     * 通过 IMAGE_RESOLUTION extra 要求高分辨率预览，提升纸质码细节识别率。
     *
     * @param activity 当前 Activity
     * @param formats  期望识别的码格式列表；null 表示自动识别所有格式
     */
    private fun startScan(activity: Activity, formats: List<String>?) {
        val integrator = IntentIntegrator(activity).apply {
            if (formats != null && formats.isNotEmpty()) {
                setDesiredBarcodeFormats(ArrayList(formats))
            } else {
                setDesiredBarcodeFormats(IntentIntegrator.ALL_CODE_TYPES)
            }
            setPrompt("将条码放入框内，自动扫描（保持平整、避免反光）")
            setCameraId(0)
            setBeepEnabled(true)
            setBarcodeImageEnabled(false)
            // 锁定竖屏（配合 AndroidManifest 中 CaptureActivity 的 screenOrientation=portrait）
            setOrientationLocked(true)
            // 要求高分辨率预览（纸质码细条需要足够像素）
            addExtra("IMAGE_RESOLUTION", intArrayOf(1920, 1080))
        }
        integrator.initiateScan()
    }

    /**
     * 设置桌面应用图标角标（未读消息数）。
     * 基于 ShortcutBadger，兼容小米/华为/OPPO/vivo/三星/索尼等主流厂商。
     * count > 0 显示数字，count == 0 清除角标。
     * Android 8.0+ 需先创建通知渠道（部分厂商通过通知间接显示角标）。
     */
    @ReactMethod
    fun setBadge(count: Int, promise: Promise) {
        try {
            ensureBadgeNotificationChannel()
            if (count > 0) {
                ShortcutBadger.applyCount(reactContext, count)
            } else {
                ShortcutBadger.removeCount(reactContext)
            }
            val badgeResult = WritableNativeMap()
            badgeResult.putBoolean("ok", true)
            promise.resolve(badgeResult)
        } catch (e: Exception) {
            promise.reject("BADGE_FAILED", e.localizedMessage ?: "角标设置失败")
        }
    }

    /** 创建角标通知渠道（Android 8.0+，低优先级不打扰用户）。 */
    private fun ensureBadgeNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelId = "erp_badge"
            val channelName = "消息角标"
            val importance = android.app.NotificationManager.IMPORTANCE_LOW
            val channel = android.app.NotificationChannel(channelId, channelName, importance).apply {
                description = "用于显示应用未读消息角标，不弹出通知"
                setShowBadge(true)
            }
            val notificationManager =
                reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    /**
     * 播放系统默认通知提示音。
     * 使用 RingtoneManager 获取系统默认通知铃声并播放，播放完毕自动释放。
     * duration 参数预留（当前固定播放系统默认提示音，3 秒后自动停止）。
     */
    @ReactMethod
    fun playSound(duration: Int, promise: Promise) {
        try {
            val uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION)
            val ringtone = android.media.RingtoneManager.getRingtone(reactContext, uri)
            if (ringtone != null) {
                ringtone.play()
                // 播放完毕后释放（Ringtone 没有播放完成回调，用计时器兜底释放）
                val stopDelay = if (duration > 0) duration.toLong() else 3000L
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    try { ringtone.stop() } catch (_: Exception) {}
                }, stopDelay)
                val result = WritableNativeMap()
                result.putBoolean("ok", true)
                promise.resolve(result)
            } else {
                promise.reject("SOUND_UNAVAILABLE", "无法获取系统提示音")
            }
        } catch (e: Exception) {
            promise.reject("SOUND_FAILED", e.localizedMessage ?: "提示音播放失败")
        }
    }

    /**
     * 发送通知栏消息（模拟推送）。
     * 在系统通知栏展示一条通知，点击后打开 App 主页面。
     * Android 8.0+ 使用 erp_notify 通知渠道（高优先级，会弹出横幅）。
     * Android 13+ 自动检查并请求 POST_NOTIFICATIONS 运行时权限，授权后发送。
     */
    @ReactMethod
    fun sendNotification(title: String, content: String, promise: Promise) {
        try {
            // Android 13+（API 33）需要 POST_NOTIFICATIONS 运行时权限，否则通知被系统静默丢弃
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val hasPermission = ContextCompat.checkSelfPermission(
                    reactContext,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED
                if (!hasPermission) {
                    val activity = reactContext.currentActivity ?: run {
                        promise.reject("NO_ACTIVITY", "当前无 Activity"); return
                    }
                    val permissionAware = activity as? PermissionAwareActivity ?: run {
                        promise.reject("NO_PERMISSION_SUPPORT", "当前 Activity 不支持权限请求"); return
                    }
                    permissionAware.requestPermissions(
                        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                        REQUEST_NOTIFICATION_PERMISSION,
                        object : PermissionListener {
                            override fun onRequestPermissionsResult(
                                requestCode: Int,
                                permissions: Array<String>,
                                grantResults: IntArray,
                            ): Boolean {
                                if (requestCode != REQUEST_NOTIFICATION_PERMISSION) return false
                                val granted = grantResults.isNotEmpty() &&
                                    grantResults[0] == PackageManager.PERMISSION_GRANTED
                                if (granted) {
                                    doSendNotification(title, content, promise)
                                } else {
                                    promise.reject(
                                        "PERMISSION_DENIED",
                                        "通知权限被拒绝，请在系统设置 → 应用 → 精易ERP → 通知中开启通知权限",
                                    )
                                }
                                return true
                            }
                        },
                    )
                    return
                }
            }
            doSendNotification(title, content, promise)
        } catch (e: Exception) {
            promise.reject("NOTIFY_FAILED", e.localizedMessage ?: "通知发送失败")
        }
    }

    /** 实际发送通知（权限已确认后调用）。 */
    private fun doSendNotification(title: String, content: String, promise: Promise) {
        try {
            ensureNotifyNotificationChannel()
            val channelId = "erp_notify"
            val notificationId = (System.currentTimeMillis() % 10000).toInt()

            val intent = reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)
            val pendingIntent = android.app.PendingIntent.getActivity(
                reactContext,
                notificationId,
                intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )

            val builder = androidx.core.app.NotificationCompat.Builder(reactContext, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title.ifEmpty { "新消息" })
                .setContentText(content)
                .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(content))
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)

            val notificationManager =
                reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            notificationManager.notify(notificationId, builder.build())
            val notifyResult = WritableNativeMap()
            notifyResult.putBoolean("ok", true)
            notifyResult.putInt("notificationId", notificationId)
            promise.resolve(notifyResult)
        } catch (e: Exception) {
            promise.reject("NOTIFY_FAILED", e.localizedMessage ?: "通知发送失败")
        }
    }

    /** 创建消息通知渠道（Android 8.0+，高优先级会弹出横幅）。 */
    private fun ensureNotifyNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelId = "erp_notify"
            val channelName = "消息通知"
            val importance = android.app.NotificationManager.IMPORTANCE_HIGH
            val channel = android.app.NotificationChannel(channelId, channelName, importance).apply {
                description = "应用内消息通知，会在通知栏展示"
                enableVibration(true)
                enableLights(true)
            }
            val notificationManager =
                reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    /**
     * 拍照：输出到 app 专属外部目录（getExternalFilesDir/PICTURES），
     * 用 FileProvider 包装 Uri 传给系统相机，无需 WRITE_EXTERNAL_STORAGE 权限。
     * onActivityResult 后复制到 cacheDir 返回 file://，WebView 可直接加载。
     */
    @ReactMethod
    fun takePhoto(promise: Promise) {
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "当前无 Activity"); return
        }
        try {
            val dir = reactContext.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
                ?: reactContext.cacheDir
            if (!dir.exists()) dir.mkdirs()
            val photoFile = File(dir, "erp_photo_${System.currentTimeMillis()}.jpg")
            val outputUri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileprovider",
                photoFile,
            )
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, outputUri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
            // 检查是否有相机应用；模拟器（如雷电）可能未预装相机，此时降级为从相册选图
            if (intent.resolveActivity(reactContext.packageManager) == null) {
                android.util.Log.w(
                    "ERPCapabilities",
                    "未找到相机应用，降级为从相册选图（模拟器环境常见）",
                )
                pendingPromise = promise
                pendingRequestCode = REQUEST_PICK
                val pickIntent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
                activity.startActivityForResult(pickIntent, REQUEST_PICK)
                return
            }
            pendingCameraUri = outputUri
            pendingPromise = promise
            pendingRequestCode = REQUEST_CAMERA
            activity.startActivityForResult(intent, REQUEST_CAMERA)
        } catch (e: Exception) {
            pendingCameraUri = null
            promise.reject("CAMERA_FAILED", e.localizedMessage ?: "拍照失败")
        }
    }

    /**
     * 从相册选图：ACTION_PICK 系统相册选择器。
     * Android 13+（API 33）需 READ_MEDIA_IMAGES 运行时权限，低版本需 READ_EXTERNAL_STORAGE。
     * onActivityResult 后复制到 cacheDir，返回 { files: [{ uri: file://, name, mimeType, size }] }。
     */
    @ReactMethod
    fun pickImage(opts: com.facebook.react.bridge.ReadableMap?, promise: Promise) {
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "当前无 Activity"); return
        }
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        val hasPermission = ContextCompat.checkSelfPermission(reactContext, permission) ==
            PackageManager.PERMISSION_GRANTED
        if (!hasPermission) {
            val permissionAware = activity as? PermissionAwareActivity ?: run {
                promise.reject("NO_PERMISSION_SUPPORT", "当前 Activity 不支持权限请求"); return
            }
            pendingPromise = promise
            pendingRequestCode = REQUEST_STORAGE_PERMISSION
            permissionAware.requestPermissions(
                arrayOf(permission),
                REQUEST_STORAGE_PERMISSION,
                object : PermissionListener {
                    override fun onRequestPermissionsResult(
                        requestCode: Int,
                        permissions: Array<String>,
                        grantResults: IntArray,
                    ): Boolean {
                        if (requestCode != REQUEST_STORAGE_PERMISSION) return false
                        val granted = grantResults.isNotEmpty() &&
                            grantResults[0] == PackageManager.PERMISSION_GRANTED
                        if (granted) {
                            doPickImage(activity)
                        } else {
                            val p = pendingPromise
                            pendingPromise = null
                            pendingRequestCode = -1
                            p?.reject("PERMISSION_DENIED", "存储权限被拒绝，请在系统设置中开启存储权限")
                        }
                        return true
                    }
                },
            )
            return
        }
        doPickImage(activity)
    }

    /** 实际启动相册选图（权限已确认后调用）。 */
    private fun doPickImage(activity: Activity) {
        pendingPromise = pendingPromise ?: return
        pendingRequestCode = REQUEST_PICK
        val intent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
        activity.startActivityForResult(intent, REQUEST_PICK)
    }

    @ReactMethod
    fun saveImage(uri: String, promise: Promise) {
        try {
            val src = Uri.parse(uri)
            val resolver = reactContext.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "erp_${System.currentTimeMillis()}.png")
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES)
                }
            }
            val dest = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            if (dest == null) {
                promise.reject("SAVE_FAILED", "插入媒体库失败"); return
            }
            resolver.openOutputStream(dest)?.use { out ->
                val input = resolver.openInputStream(src)
                input?.copyTo(out)
                input?.close()
            }
            val saveResult = WritableNativeMap()
            saveResult.putBoolean("saved", true)
            promise.resolve(saveResult)
        } catch (e: Exception) {
            promise.reject("SAVE_FAILED", e.localizedMessage)
        }
    }

    /**
     * 文件选择：ACTION_GET_CONTENT 系统文件选择器。
     * onActivityResult 后复制到 cacheDir，返回 { files: [{ uri: file://, name, mimeType, size }] }。
     */
    @ReactMethod
    fun filePick(opts: com.facebook.react.bridge.ReadableMap?, promise: Promise) {
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "当前无 Activity"); return
        }
        pendingPromise = promise
        pendingRequestCode = REQUEST_PICK
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "*/*"
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        activity.startActivityForResult(
            Intent.createChooser(intent, "选择文件"),
            REQUEST_PICK,
        )
    }

    @ReactMethod
    fun fileDownload(url: String, promise: Promise) {
        try {
            val conn = URL(url).openConnection() as java.net.HttpURLConnection
            conn.connect()
            val input = conn.inputStream
            val file = File(
                reactContext.cacheDir,
                "erp_${System.currentTimeMillis()}.dat",
            )
            FileOutputStream(file).use { out -> input.copyTo(out) }
            input.close()
            conn.disconnect()
            val downloadResult = WritableNativeMap()
            downloadResult.putString("uri", Uri.fromFile(file).toString())
            promise.resolve(downloadResult)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_FAILED", e.localizedMessage)
        }
    }

    @ReactMethod
    fun fileOpen(uri: String, promise: Promise) {
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "当前无 Activity"); return
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        try {
            activity.startActivity(intent)
            val openResult = WritableNativeMap()
            openResult.putBoolean("opened", true)
            promise.resolve(openResult)
        } catch (e: Exception) {
            val openResult = WritableNativeMap()
            openResult.putBoolean("opened", false)
            promise.resolve(openResult)
        }
    }

    @ReactMethod
    fun getCurrentPosition(promise: Promise) {
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "当前无 Activity"); return
        }
        try {
            val hasFine = ContextCompat.checkSelfPermission(
                reactContext, Manifest.permission.ACCESS_FINE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED
            val hasCoarse = ContextCompat.checkSelfPermission(
                reactContext, Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED
            if (!hasFine && !hasCoarse) {
                // 未授权：自动请求定位权限，授权后在回调中继续获取定位
                val permissionAware = activity as? PermissionAwareActivity ?: run {
                    promise.reject("NO_PERMISSION_SUPPORT", "当前 Activity 不支持权限请求"); return
                }
                pendingPromise = promise
                pendingRequestCode = REQUEST_LOCATION_PERMISSION
                permissionAware.requestPermissions(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                    ),
                    REQUEST_LOCATION_PERMISSION,
                    object : PermissionListener {
                        override fun onRequestPermissionsResult(
                            requestCode: Int,
                            permissions: Array<String>,
                            grantResults: IntArray,
                        ): Boolean {
                            if (requestCode != REQUEST_LOCATION_PERMISSION) return false
                            val granted = grantResults.isNotEmpty() &&
                                grantResults.any { it == PackageManager.PERMISSION_GRANTED }
                            if (granted) {
                                doGetCurrentPosition(promise)
                            } else {
                                val p = pendingPromise
                                pendingPromise = null
                                pendingRequestCode = -1
                                p?.reject("PERMISSION_DENIED", "定位权限被拒绝，请在系统设置中开启定位权限")
                            }
                            return true
                        }
                    },
                )
                return
            }
            doGetCurrentPosition(promise)
        } catch (e: Exception) {
            promise.reject("LOCATION_FAILED", e.localizedMessage ?: "获取定位失败")
        }
    }

    /** 实际获取定位（权限已确认后调用）。 */
    private fun doGetCurrentPosition(promise: Promise) {
        try {
            val lm = reactContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val provider = when {
                lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
                lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
                else -> null
            }
            if (provider == null) {
                promise.reject("LOCATION_UNAVAILABLE", "定位服务未开启，请在系统设置中开启定位")
                return
            }
            val loc = lm.getLastKnownLocation(provider)
            if (loc != null) {
                val result = WritableNativeMap().apply {
                    putDouble("latitude", loc.latitude)
                    putDouble("longitude", loc.longitude)
                    putDouble("accuracy", loc.accuracy.toDouble())
                    if (loc.altitude != 0.0) putDouble("altitude", loc.altitude)
                    if (loc.speed != 0f) putDouble("speed", loc.speed.toDouble())
                    if (loc.bearing != 0f) putDouble("heading", loc.bearing.toDouble())
                    putDouble("timestamp", loc.time.toDouble())
                }
                promise.resolve(result)
            } else {
                promise.reject("LOCATION_UNAVAILABLE", "无法获取定位（上次位置为空，请在室外或开启网络定位后重试）")
            }
        } catch (e: Exception) {
            promise.reject("LOCATION_FAILED", e.localizedMessage ?: "获取定位失败")
        }
    }

    // ── NFC 能力 ──────────────────────────────────────────────

    /** 检测设备 NFC 是否可用（硬件存在且已开启）。 */
    @ReactMethod
    fun nfcAvailable(promise: Promise) {
        try {
            val nfcAdapter = NfcAdapter.getDefaultAdapter(reactContext)
            val available = nfcAdapter != null && nfcAdapter.isEnabled
            val result = WritableNativeMap().apply { putBoolean("available", available) }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("NFC_CHECK_FAILED", e.localizedMessage ?: "NFC 检测失败")
        }
    }

    /**
     * 读取 NFC 标签（NDEF 格式）。
     * 使用 enableReaderMode 进入读取器模式，发现标签后自动读取 NDEF 消息。
     * @param timeout 超时毫秒数，默认 30000
     */
    @ReactMethod
    fun nfcReadTag(timeout: Int?, promise: Promise) {
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "当前无 Activity"); return
        }
        val nfcAdapter = NfcAdapter.getDefaultAdapter(reactContext)
        if (nfcAdapter == null || !nfcAdapter.isEnabled) {
            promise.reject("NFC_UNAVAILABLE", "NFC 不可用或未开启，请在系统设置中开启 NFC")
            return
        }

        pendingPromise = promise
        pendingRequestCode = REQUEST_NFC_READ
        val timeoutMs = (timeout ?: 30000).coerceIn(1000, 120000)

        // 支持常见 NFC 标签类型，保留平台提示音（检测到标签时响一声）
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_NFC_BARCODE

        android.util.Log.d("ERPCapabilities", "NFC readTag: enableReaderMode, timeout=${timeoutMs}ms")

        // enableReaderMode 必须在主线程调用
        activity.runOnUiThread {
            try {
                nfcAdapter.enableReaderMode(activity, { tag ->
                    android.util.Log.d("ERPCapabilities", "NFC tag discovered: ${bytesToHex(tag.id)}")
                    val result = readNdefFromTag(tag)
                    activity.runOnUiThread {
                        try { nfcAdapter.disableReaderMode(activity) } catch (_: Exception) {}
                        val p = pendingPromise
                        pendingPromise = null
                        pendingRequestCode = -1
                        if (result != null) {
                            p?.resolve(result)
                        } else {
                            p?.reject("NFC_NO_NDEF", "标签不包含 NDEF 数据或读取失败")
                        }
                    }
                }, flags, null)
            } catch (e: Exception) {
                val p = pendingPromise
                pendingPromise = null
                pendingRequestCode = -1
                p?.reject("NFC_READER_FAILED", "启动 NFC 读取器失败: ${e.localizedMessage}")
                return@runOnUiThread
            }

            // 超时兜底（在主线程 post）
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                if (pendingRequestCode == REQUEST_NFC_READ) {
                    android.util.Log.d("ERPCapabilities", "NFC readTag timeout")
                    try { nfcAdapter.disableReaderMode(activity) } catch (_: Exception) {}
                    val p = pendingPromise
                    pendingPromise = null
                    pendingRequestCode = -1
                    p?.reject("NFC_TIMEOUT", "读取 NFC 标签超时（${timeoutMs}ms），请将 NFC 标签贴近手机背面 NFC 天线区域")
                }
            }, timeoutMs.toLong())
        }
    }

    /**
     * 写入 NDEF 数据到 NFC 标签。
     * @param records NDEF 记录数组，每条 { type, data }，type 支持 "text" / "uri" / "mime"
     */
    @ReactMethod
    fun nfcWriteNdef(records: com.facebook.react.bridge.ReadableArray?, promise: Promise) {
        val activity = reactContext.currentActivity ?: run {
            promise.reject("NO_ACTIVITY", "当前无 Activity"); return
        }
        val nfcAdapter = NfcAdapter.getDefaultAdapter(reactContext)
        if (nfcAdapter == null || !nfcAdapter.isEnabled) {
            promise.reject("NFC_UNAVAILABLE", "NFC 不可用或未开启")
            return
        }
        if (records == null || records.size() == 0) {
            promise.reject("INVALID_PARAMS", "records 不能为空")
            return
        }

        val ndefRecords = parseRecordsInput(records)
        if (ndefRecords.isEmpty()) {
            promise.reject("INVALID_PARAMS", "records 解析失败，至少需要一条有效记录")
            return
        }
        val ndefMessage = NdefMessage(ndefRecords.toTypedArray())

        pendingPromise = promise
        pendingRequestCode = REQUEST_NFC_WRITE
        val timeoutMs = 30000

        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_NFC_BARCODE

        android.util.Log.d("ERPCapabilities", "NFC writeNdef: enableReaderMode, records=${ndefRecords.size}")

        activity.runOnUiThread {
            try {
                nfcAdapter.enableReaderMode(activity, { tag ->
                    android.util.Log.d("ERPCapabilities", "NFC write tag discovered: ${bytesToHex(tag.id)}")
                    val success = writeNdefToTag(tag, ndefMessage)
                    activity.runOnUiThread {
                        try { nfcAdapter.disableReaderMode(activity) } catch (_: Exception) {}
                        val p = pendingPromise
                        pendingPromise = null
                        pendingRequestCode = -1
                        if (success) {
                            val result = WritableNativeMap().apply { putBoolean("ok", true) }
                            p?.resolve(result)
                        } else {
                            p?.reject("NFC_WRITE_FAILED", "写入失败，标签可能只读或已损坏")
                        }
                    }
                }, flags, null)
            } catch (e: Exception) {
                val p = pendingPromise
                pendingPromise = null
                pendingRequestCode = -1
                p?.reject("NFC_READER_FAILED", "启动 NFC 写入器失败: ${e.localizedMessage}")
                return@runOnUiThread
            }

            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                if (pendingRequestCode == REQUEST_NFC_WRITE) {
                    try { nfcAdapter.disableReaderMode(activity) } catch (_: Exception) {}
                    val p = pendingPromise
                    pendingPromise = null
                    pendingRequestCode = -1
                    p?.reject("NFC_TIMEOUT", "写入 NFC 标签超时，请将标签贴近手机背面 NFC 天线区域")
                }
            }, timeoutMs.toLong())
        }
    }

    /** 从 Tag 读取 NDEF 消息，返回 WritableNativeMap（tagId + records）。 */
    private fun readNdefFromTag(tag: Tag): WritableNativeMap? {
        return try {
            val ndef = Ndef.get(tag) ?: return null
            ndef.connect()
            if (!ndef.isConnected) return null
            val ndefMessage = ndef.ndefMessage ?: return null
            ndef.close()

            val recordsArray = WritableNativeArray()
            val records: Array<NdefRecord> = ndefMessage.records
            for (record in records) {
                val recordMap = WritableNativeMap().apply {
                    putString("tnf", tnfToString(record.tnf))
                    putString("type", String(record.type))
                    putString("id", bytesToHex(record.id))
                    putString("payload", String(record.payload))
                }
                recordsArray.pushMap(recordMap)
            }

            WritableNativeMap().apply {
                putString("tagId", bytesToHex(tag.id))
                putArray("records", recordsArray)
            }
        } catch (e: Exception) {
            null
        }
    }

    /** 向 Tag 写入 NDEF 消息，返回是否成功。 */
    private fun writeNdefToTag(tag: Tag, message: NdefMessage): Boolean {
        return try {
            val ndef = Ndef.get(tag) ?: return false
            ndef.connect()
            if (!ndef.isConnected) return false
            if (ndef.maxSize < message.toByteArray().size) {
                ndef.close()
                return false
            }
            ndef.writeNdefMessage(message)
            ndef.close()
            true
        } catch (e: Exception) {
            false
        }
    }

    /** 解析 H5 传入的 records 数组为 NdefRecord 列表。 */
    private fun parseRecordsInput(records: com.facebook.react.bridge.ReadableArray): List<NdefRecord> {
        val result = mutableListOf<NdefRecord>()
        for (i in 0 until records.size()) {
            try {
                val map = records.getMap(i) ?: continue
                val type = map.getString("type") ?: "text"
                val data = map.getString("data") ?: ""
                val record = when (type) {
                    "uri" -> NdefRecord.createUri(data)
                    "mime" -> NdefRecord.createMime(map.getString("mimeType") ?: "text/plain", data.toByteArray())
                    "external" -> NdefRecord.createExternal(
                        map.getString("domain") ?: "qux",
                        map.getString("typeName") ?: "data",
                        data.toByteArray(),
                    )
                    else -> NdefRecord.createTextRecord("zh", data)
                }
                result.add(record)
            } catch (_: Exception) {
                // 跳过无效记录
            }
        }
        return result
    }

    /** TNF 常量转可读字符串（NdefRecord.TNF_* 为 Short 类型）。 */
    private fun tnfToString(tnf: Short): String = when (tnf.toInt()) {
        NdefRecord.TNF_EMPTY.toInt() -> "empty"
        NdefRecord.TNF_WELL_KNOWN.toInt() -> "well_known"
        NdefRecord.TNF_MIME_MEDIA.toInt() -> "mime"
        NdefRecord.TNF_ABSOLUTE_URI.toInt() -> "uri"
        NdefRecord.TNF_EXTERNAL_TYPE.toInt() -> "external"
        NdefRecord.TNF_UNKNOWN.toInt() -> "unknown"
        else -> "reserved"
    }

    /** 字节数组转十六进制字符串。 */
    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder()
        for (b in bytes) {
            sb.append(String.format("%02X", b))
        }
        return sb.toString()
    }

    /**
     * 读取文件内容并返回 Base64（供 H5 侧转 Blob 后上传到后端，如头像上传）。
     * 支持 content:// 和 file:// Uri。返回 { base64, mimeType, name, size }。
     */
    @ReactMethod
    fun readFileAsBase64(uri: String, promise: Promise) {
        try {
            val contentUri = Uri.parse(uri)
            val resolver = reactContext.contentResolver
            val mimeType = resolver.getType(contentUri) ?: "application/octet-stream"
            val name = contentUri.lastPathSegment ?: "file"

            // 图片文件先压缩再转 Base64（避免原图几 MB 通过 Bridge 传递导致超时）
            val bytes: ByteArray = if (mimeType.startsWith("image/")) {
                compressImage(contentUri, resolver) ?: readRawBytes(contentUri, resolver)
            } else {
                readRawBytes(contentUri, resolver)
            }

            val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            val result = WritableNativeMap().apply {
                putString("base64", base64)
                putString("mimeType", mimeType)
                putString("name", name)
                putDouble("size", bytes.size.toDouble())
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("READ_FAILED", e.localizedMessage ?: "读取文件失败")
        }
    }

    /** 读取原始文件字节（非图片或压缩失败时回退）。 */
    private fun readRawBytes(uri: Uri, resolver: android.content.ContentResolver): ByteArray {
        val input = resolver.openInputStream(uri) ?: throw Exception("无法读取文件")
        val bytes = input.readBytes()
        input.close()
        return bytes
    }

    /**
     * 图片压缩：解码 → 缩放（最大边长 MAX_IMAGE_EDGE）→ JPEG 压缩（质量 JPEG_QUALITY）。
     * 头像等场景不需要原图，压缩后通常 200-500KB，Base64 后可安全通过 Bridge 传递。
     * 解码失败返回 null（调用方回退到原始字节）。
     */
    private fun compressImage(uri: Uri, resolver: android.content.ContentResolver): ByteArray? {
        return try {
            val input = resolver.openInputStream(uri) ?: return null
            val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeStream(input, null, options)
            input.close()

            val maxEdge = maxOf(options.outWidth, options.outHeight)
            if (maxEdge <= 0) return null

            val sampleSize = if (maxEdge > MAX_IMAGE_EDGE) {
                var ratio = 1
                while (maxEdge / ratio > MAX_IMAGE_EDGE * 2) ratio *= 2
                ratio
            } else 1

            val decodeInput = resolver.openInputStream(uri) ?: return null
            val decodeOptions = android.graphics.BitmapFactory.Options().apply { inSampleSize = sampleSize }
            val bitmap = android.graphics.BitmapFactory.decodeStream(decodeInput, null, decodeOptions)
            decodeInput.close()
            bitmap ?: return null

            val scaled = if (maxOf(bitmap.width, bitmap.height) > MAX_IMAGE_EDGE) {
                val scale = MAX_IMAGE_EDGE.toFloat() / maxOf(bitmap.width, bitmap.height)
                android.graphics.Bitmap.createScaledBitmap(
                    bitmap,
                    (bitmap.width * scale).toInt(),
                    (bitmap.height * scale).toInt(),
                    true
                )
            } else bitmap

            val output = java.io.ByteArrayOutputStream()
            scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
            if (scaled !== bitmap) scaled.recycle()
            bitmap.recycle()
            output.toByteArray()
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 将 content:// Uri 复制到 app cacheDir，返回 file:// 路径。
     * WebView 对 content:// scheme 加载不稳定，file:// 可直接加载（已配置 allowFileAccess）。
     */
    private fun copyToCacheDir(uri: Uri): String {
        val resolver = reactContext.contentResolver
        val input = resolver.openInputStream(uri) ?: throw Exception("无法读取文件")
        val ext = getExtension(uri) ?: "dat"
        val file = File(reactContext.cacheDir, "erp_pick_${System.currentTimeMillis()}.$ext")
        FileOutputStream(file).use { out -> input.copyTo(out) }
        input.close()
        return Uri.fromFile(file).toString()
    }

    private fun getExtension(uri: Uri): String? {
        val mimeType = reactContext.contentResolver.getType(uri)
        if (mimeType != null) {
            val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
            if (ext != null) return ext
        }
        val lastSegment = uri.lastPathSegment ?: return null
        val dotIndex = lastSegment.lastIndexOf('.')
        return if (dotIndex >= 0 && dotIndex < lastSegment.length - 1) {
            lastSegment.substring(dotIndex + 1)
        } else null
    }

    /** 构建文件信息 map，通过 ContentResolver 查询真实大小。 */
    private fun buildFileMap(uri: Uri): WritableNativeMap {
        val resolver = reactContext.contentResolver
        val map = WritableNativeMap()
        map.putString("uri", uri.toString())

        var name = uri.lastPathSegment ?: "file"
        var size = 0L
        var mimeType = resolver.getType(uri) ?: "application/octet-stream"
        try {
            resolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                    if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
                        name = cursor.getString(nameIndex)
                    }
                    val sizeIndex = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE)
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                        size = cursor.getLong(sizeIndex)
                    }
                    val mimeIndex = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                    if (mimeIndex >= 0 && !cursor.isNull(mimeIndex)) {
                        mimeType = cursor.getString(mimeIndex)
                    }
                }
            }
        } catch (e: Exception) {
            // 查询失败时回退到默认值
        }

        map.putString("name", name)
        map.putString("mimeType", mimeType)
        map.putDouble("size", size.toDouble())
        return map
    }

    companion object {
        private const val REQUEST_CAMERA = 9001
        private const val REQUEST_PICK = 9002
        private const val REQUEST_SCAN_PERMISSION = 9003
        private const val REQUEST_NOTIFICATION_PERMISSION = 9004
        private const val REQUEST_MLKIT_SCAN = 9005
        private const val REQUEST_LOCATION_PERMISSION = 9006
        private const val REQUEST_STORAGE_PERMISSION = 9007
        private const val REQUEST_NFC_READ = 9008
        private const val REQUEST_NFC_WRITE = 9009
        /** 图片压缩最大边长（px）。 */
        private const val MAX_IMAGE_EDGE = 1024
        /** JPEG 压缩质量（0-100）。 */
        private const val JPEG_QUALITY = 80
    }
}
