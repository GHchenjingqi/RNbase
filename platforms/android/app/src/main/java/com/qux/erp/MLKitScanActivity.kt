package com.qux.erp

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.util.Size
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/**
 * ML Kit 条码扫描 Activity。
 *
 * 基于 Google ML Kit Barcode Scanning（机器学习模型）+ CameraX，
 * 对纸质码的弯曲/反光/低对比度容忍度远高于 ZXing 纯软件解码。
 *
 * 调用方通过 Intent 传入：
 *   - EXTRA_FORMATS: 期望识别的条码格式字符串数组（如 ["CODE_128", "EAN_13"]），
 *     null/空表示识别所有格式。
 *
 * 识别成功后 setResult(RESULT_OK, Intent)，Intent 携带：
 *   - EXTRA_RESULT_CODE: 条码内容
 *   - EXTRA_RESULT_FORMAT: 条码格式名
 *
 * 用户取消时 setResult(RESULT_CANCELED)。
 */
class MLKitScanActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_FORMATS = "formats"
        const val EXTRA_RESULT_CODE = "code"
        const val EXTRA_RESULT_FORMAT = "format"

        /** H5 传入的格式字符串 → ML Kit Barcode.FORMAT_* 常量映射。 */
        private val FORMAT_MAP = mapOf(
            "CODE_128" to Barcode.FORMAT_CODE_128,
            "CODE_39" to Barcode.FORMAT_CODE_39,
            "CODE_93" to Barcode.FORMAT_CODE_93,
            "EAN_13" to Barcode.FORMAT_EAN_13,
            "EAN_8" to Barcode.FORMAT_EAN_8,
            "UPC_A" to Barcode.FORMAT_UPC_A,
            "UPC_E" to Barcode.FORMAT_UPC_E,
            "QR_CODE" to Barcode.FORMAT_QR_CODE,
            "DATA_MATRIX" to Barcode.FORMAT_DATA_MATRIX,
            "PDF_417" to Barcode.FORMAT_PDF417,
            "AZTEC" to Barcode.FORMAT_AZTEC,
            "ITF" to Barcode.FORMAT_ITF,
            "CODABAR" to Barcode.FORMAT_CODABAR,
        )

        /** ML Kit 格式常量 → 可读格式名（返回给 H5）。 */
        private val FORMAT_NAME_MAP = mapOf(
            Barcode.FORMAT_CODE_128 to "CODE_128",
            Barcode.FORMAT_CODE_39 to "CODE_39",
            Barcode.FORMAT_CODE_93 to "CODE_93",
            Barcode.FORMAT_EAN_13 to "EAN_13",
            Barcode.FORMAT_EAN_8 to "EAN_8",
            Barcode.FORMAT_UPC_A to "UPC_A",
            Barcode.FORMAT_UPC_E to "UPC_E",
            Barcode.FORMAT_QR_CODE to "QR_CODE",
            Barcode.FORMAT_DATA_MATRIX to "DATA_MATRIX",
            Barcode.FORMAT_PDF417 to "PDF_417",
            Barcode.FORMAT_AZTEC to "AZTEC",
            Barcode.FORMAT_ITF to "ITF",
            Barcode.FORMAT_CODABAR to "CODABAR",
        )
    }

    private lateinit var previewView: PreviewView
    private lateinit var torchButton: ImageButton
    private var camera: androidx.camera.core.Camera? = null
    private var scanner: BarcodeScanner? = null
    private var isTorchOn = false
    private var isProcessing = false
    private var isFinished = false

    private val analysisExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 全屏 + 保持屏幕常亮（扫码时避免息屏）
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN
        supportActionBar?.hide()

        setContentView(buildLayout())

        val formats = intent.getStringArrayListExtra(EXTRA_FORMATS)
        scanner = createBarcodeScanner(formats)

        startCamera()
    }

    /** 动态构建布局：预览 + 顶部提示栏 + 扫描框 + 底部操作栏。 */
    private fun buildLayout(): View {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

        // 相机预览
        previewView = PreviewView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        root.addView(previewView)

        // 半透明遮罩 + 扫描框（用 View 叠加实现）
        val overlay = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }

        // 顶部提示栏
        val topBar = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                (120 * resources.displayMetrics.density).toInt(),
                Gravity.TOP,
            ).apply {
                setBackgroundColor(Color.parseColor("#80000000"))
            }
        }
        val titleText = TextView(this).apply {
            text = "将条码放入框内，自动扫描"
            setTextColor(Color.WHITE)
            textSize = 16f
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            )
        }
        topBar.addView(titleText)

        // 关闭按钮
        val closeBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                (48 * resources.displayMetrics.density).toInt(),
                (48 * resources.displayMetrics.density).toInt(),
                Gravity.TOP or Gravity.START,
            ).apply {
                setMargins((12 * resources.displayMetrics.density).toInt(), (24 * resources.displayMetrics.density).toInt(), 0, 0)
            }
            setOnClickListener { finishCancel() }
        }
        topBar.addView(closeBtn)
        overlay.addView(topBar)

        // 底部操作栏
        val bottomBar = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                (100 * resources.displayMetrics.density).toInt(),
                Gravity.BOTTOM,
            ).apply {
                setBackgroundColor(Color.parseColor("#80000000"))
            }
        }

        // 手电筒按钮
        torchButton = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_view)
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                (56 * resources.displayMetrics.density).toInt(),
                (56 * resources.displayMetrics.density).toInt(),
                Gravity.CENTER,
            )
            setOnClickListener { toggleTorch() }
        }
        bottomBar.addView(torchButton)

        val torchHint = TextView(this).apply {
            text = "手电筒"
            setTextColor(Color.WHITE)
            textSize = 12f
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
            ).apply {
                setMargins(0, 0, 0, (8 * resources.displayMetrics.density).toInt())
            }
        }
        bottomBar.addView(torchHint)
        overlay.addView(bottomBar)

        root.addView(overlay)
        return root
    }

    /** 根据 H5 传入的格式列表创建 BarcodeScanner。 */
    private fun createBarcodeScanner(formats: ArrayList<String>?): BarcodeScanner {
        if (formats.isNullOrEmpty()) {
            return BarcodeScanning.getClient(
                BarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS)
                    .build(),
            )
        }
        val mlFormats = formats.mapNotNull { FORMAT_MAP[it] }.toIntArray()
        if (mlFormats.isEmpty()) {
            return BarcodeScanning.getClient(
                BarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS)
                    .build(),
            )
        }
        return BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(mlFormats[0], *mlFormats.copyOfRange(1, mlFormats.size))
                .build(),
        )
    }

    /** 启动 CameraX 预览 + 帧分析。 */
    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val imageAnalysis = ImageAnalysis.Builder()
                // 不强制 720p，让相机选择最高可用分辨率（模拟器虚拟相机分辨率低时取其上限，真机取高分辨率）
                // 条形码识别对像素宽度敏感，分辨率越高细条越清晰
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                .build()
                .also { analysis ->
                    analysis.setAnalyzer(analysisExecutor) { imageProxy ->
                        if (isProcessing || isFinished) {
                            imageProxy.close()
                            return@setAnalyzer
                        }
                        isProcessing = true
                        val mediaImage = imageProxy.image
                        if (mediaImage != null) {
                            val inputImage = InputImage.fromMediaImage(
                                mediaImage,
                                imageProxy.imageInfo.rotationDegrees,
                            )
                            scanner?.process(inputImage)
                                ?.addOnSuccessListener { barcodes ->
                                    if (barcodes.isNotEmpty() && !isFinished) {
                                        val barcode = barcodes[0]
                                        val code = barcode.rawValue
                                        if (!code.isNullOrEmpty()) {
                                            deliverResult(code, barcode.format)
                                        }
                                    }
                                }
                                ?.addOnCompleteListener {
                                    isProcessing = false
                                    imageProxy.close()
                                }
                        } else {
                            isProcessing = false
                            imageProxy.close()
                        }
                    }
                }

            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

            try {
                cameraProvider.unbindAll()
                camera = cameraProvider.bindToLifecycle(
                    this,
                    cameraSelector,
                    preview,
                    imageAnalysis,
                )
            } catch (e: Exception) {
                finishCancel()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    /** 切换手电筒。 */
    private fun toggleTorch() {
        val cam = camera ?: return
        if (!cam.cameraInfo.hasFlashUnit()) return
        isTorchOn = !isTorchOn
        cam.cameraControl.enableTorch(isTorchOn)
        torchButton.setColorFilter(if (isTorchOn) Color.YELLOW else Color.WHITE)
    }

    /** 识别成功，返回结果。 */
    private fun deliverResult(code: String, format: Int) {
        if (isFinished) return
        isFinished = true
        val data = Intent().apply {
            putExtra(EXTRA_RESULT_CODE, code)
            putExtra(EXTRA_RESULT_FORMAT, FORMAT_NAME_MAP[format] ?: "UNKNOWN")
        }
        setResult(Activity.RESULT_OK, data)
        finish()
    }

    /** 用户取消。 */
    private fun finishCancel() {
        if (isFinished) return
        isFinished = true
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        analysisExecutor.shutdown()
        scanner?.close()
    }
}
