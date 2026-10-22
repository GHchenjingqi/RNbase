/**
 * 离线语音识别引擎（sherpa-onnx 流式 transducer）。
 *
 * 设计要点（可行性探针阶段，规则 11：安全优先、模型失败可重试）：
 *  - 模型从 APK assets 直接加载，**不复制**到 filesDir，避免手机上占双份 24MB 存储。
 *  - 录音用 AudioRecord，固定 16 kHz / 单声道 / PCM 16-bit（模型要求）。
 *  - 本探针采用「点开始 → 点完成 → 一次性出结果」的产品交互：录音先缓存整段 PCM，
 *    停止后整段喂入识别器并 inputFinished 取最终文本（流式模型可当非流式用）。
 *  - 识别与初始化都跑在单线程 executor 上，不阻塞 RN JS 线程 / UI 线程。
 *
 * ⚠️ 版本敏感：sherpa-onnx 的 Kotlin API 在各版本间有差异（流式方法挂在 OnlineStream 上、
 *    FeatureConfig.sampleRate 为 Int 等）。本文件已按 Maven 构件
 *    com.bihe0832.android:lib-sherpa-onnx:6.25.21 的实际签名校对（javap 核对）。
 *    升级该依赖后请重新 javap 核对，只需改本文件的 createRecognizer() 与识别流程，
 *    其余桥层代码不受影响。
 */
package com.qux.base

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableNativeMap
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/**
 * 统一构造 resolve 用的 map。
 *
 * 注意：必须用 WritableNativeMap，**不能**直接 resolve Kotlin 的 Map<String, Any>——
 * 那样运行时是 java.util.LinkedHashMap，RN 的 Java→JS 转换会失败，
 * H5 侧表现为 NATIVE_ERROR「Cannot convert argument of argument of type class java.util.LinkedHashMap」。
 */
private fun voiceMap(vararg pairs: Pair<String, Any?>): WritableNativeMap =
    WritableNativeMap().apply {
        pairs.forEach { (k, v) ->
            when (v) {
                null -> putNull(k)
                is String -> putString(k, v)
                is Boolean -> putBoolean(k, v)
                is Int -> putInt(k, v)
                is Long -> putDouble(k, v.toDouble())
                is Double -> putDouble(k, v)
                is Float -> putDouble(k, v.toDouble())
                else -> putString(k, v.toString())
            }
        }
    }

class SherpaAsrEngine(private val context: Context) {
    companion object {
        /** assets 内模型目录（相对 assets 根）。 */
        private const val MODEL_DIR = "models/zh-small/1.0.0"
        /** 真实模型文件名（HuggingFace csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23）。 */
        private const val ENCORDER = "$MODEL_DIR/encoder-epoch-99-avg-1.int8.onnx"
        private const val DECODER = "$MODEL_DIR/decoder-epoch-99-avg-1.int8.onnx"
        private const val JOINER = "$MODEL_DIR/joiner-epoch-99-avg-1.int8.onnx"
        private const val TOKENS = "$MODEL_DIR/tokens.txt"
        private const val SAMPLE_RATE = 16000
    }

    val modelId: String = "zh-small"
    val modelVersion: String = "1.0.0"

    private val executor = Executors.newSingleThreadExecutor()
    private val recognizerRef = AtomicReference<OnlineRecognizer?>(null)
    private val stateRef = AtomicReference("uninitialized") // uninitialized | loading | ready | error

    // ── 录音状态 ──
    private val recordingRef = AtomicReference<AudioRecord?>(null)
    private val isRecording = AtomicBoolean(false)
    private var recordThread: Thread? = null
    private val pcmRef = AtomicReference<ByteArrayOutputStream?>(null)
    private val recordStartMs = AtomicReference(0L)

    fun getStatus(): Map<String, Any> = mapOf(
        "state" to stateRef.get(),
        "modelId" to modelId,
        "version" to modelVersion,
        "ready" to (stateRef.get() == "ready"),
    )

    /** 校验 assets 模型完整性并初始化识别器（首次调用加载，之后复用）。 */
    fun prepare(promise: Promise) {
        if (stateRef.get() == "ready" && recognizerRef.get() != null) {
            promise.resolve(voiceMap("state" to "ready"))
            return
        }
        stateRef.set("loading")
        executor.submit {
            try {
                val recognizer = createRecognizer()
                recognizerRef.set(recognizer)
                stateRef.set("ready")
                promise.resolve(voiceMap("state" to "ready"))
            } catch (e: Exception) {
                stateRef.set("error")
                promise.reject("E_MODEL_LOAD_FAILED", e.localizedMessage ?: "语音模型初始化失败")
            }
        }
    }

    fun startRecording(promise: Promise) {
        if (recognizerRef.get() == null) {
            promise.reject("E_MODEL_NOT_READY", "语音模型未就绪，请先调用 prepareModel")
            return
        }
        if (isRecording.get()) {
            promise.resolve(voiceMap("started" to true))
            return
        }
        try {
            val minBuf = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBuf <= 0) {
                promise.reject("E_AUDIO_INIT_FAILED", "无法初始化音频缓冲区（设备不支持该采样配置）")
                return
            }
            val record = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                minBuf * 2,
            )
            record.startRecording()
            val bos = ByteArrayOutputStream()
            pcmRef.set(bos)
            recordingRef.set(record)
            isRecording.set(true)
            recordStartMs.set(System.currentTimeMillis())
            val t = thread(start = true, name = "asr-capture") {
                val chunk = ByteArray(minBuf)
                while (isRecording.get()) {
                    val read = record.read(chunk, 0, chunk.size)
                    if (read > 0) bos.write(chunk, 0, read)
                }
            }
            recordThread = t
            promise.resolve(voiceMap("started" to true))
        } catch (e: SecurityException) {
            isRecording.set(false)
            promise.reject("E_PERMISSION_DENIED", "麦克风权限被拒绝")
        } catch (e: Exception) {
            isRecording.set(false)
            promise.reject("E_AUDIO_INIT_FAILED", e.localizedMessage ?: "录音初始化失败")
        }
    }

    fun stopAndRecognize(promise: Promise) {
        if (!isRecording.get()) {
            promise.reject("E_AUDIO_EMPTY", "当前没有正在进行的录音")
            return
        }
        isRecording.set(false)
        val record = recordingRef.get()
        val t = recordThread
        try {
            record?.stop()
            record?.release()
            recordingRef.set(null)
            t?.join(2000)
            val pcm = pcmRef.get()?.toByteArray() ?: ByteArray(0)
            pcmRef.set(null)
            val durationMs = System.currentTimeMillis() - recordStartMs.get()
            if (pcm.size < 2) {
                promise.reject("E_AUDIO_EMPTY", "录音内容为空或过短")
                return
            }
            executor.submit {
                try {
                    val recognizer = recognizerRef.get() ?: run {
                        promise.reject("E_MODEL_NOT_READY", "语音模型未就绪")
                        return@submit
                    }
                    val samples = pcmToFloat(pcm)
                    // 该版本 sherpa-onnx 的流式 API 挂在 OnlineStream 上：
                    // acceptWaveform/inputFinished 是 stream 的方法，getResult 需要传入 stream。
                    val stream = recognizer.createStream()
                    var offset = 0
                    val chunkSize = SAMPLE_RATE // 每次喂 1 秒，贴合流式处理节奏
                    while (offset < samples.size) {
                        val end = minOf(offset + chunkSize, samples.size)
                        val chunk = samples.copyOfRange(offset, end)
                        stream.acceptWaveform(chunk, chunk.size)
                        offset = end
                    }
                    stream.inputFinished()
                    val text = try {
                        recognizer.getResult(stream).text ?: ""
                    } finally {
                        stream.release()
                    }
                    promise.resolve(
                        voiceMap(
                            "text" to text,
                            "durationMs" to durationMs,
                            "modelVersion" to modelVersion,
                        ),
                    )
                } catch (e: Exception) {
                    promise.reject("E_RECOGNITION_FAILED", e.localizedMessage ?: "语音识别失败")
                }
            }
        } catch (e: Exception) {
            promise.reject("E_RECOGNITION_FAILED", e.localizedMessage ?: "停止录音失败")
        }
    }

    fun cancelRecording(promise: Promise) {
        isRecording.set(false)
        val record = recordingRef.get()
        try {
            record?.stop()
            record?.release()
        } catch (_: Exception) {
            // ignore
        }
        recordingRef.set(null)
        pcmRef.set(null)
        recordThread = null
        promise.resolve(voiceMap("cancelled" to true))
    }

    /** 释放识别器与录音资源（模块 invalidate 时调用）。 */
    fun release() {
        isRecording.set(false)
        try { recordingRef.get()?.release() } catch (_: Exception) { }
        recordingRef.set(null)
        try { recognizerRef.get()?.release() } catch (_: Exception) { }
        recognizerRef.set(null)
        stateRef.set("uninitialized")
    }

    // ── 内部 ──

    /** 按当前依赖构件的 API 构造流式 transducer 识别器；签名随版本变化，集中在此处理。 */
    private fun createRecognizer(): OnlineRecognizer {
        val modelConfig = OnlineModelConfig(
            transducer = OnlineTransducerModelConfig(
                encoder = ENCORDER,
                decoder = DECODER,
                joiner = JOINER,
            ),
            tokens = TOKENS,
            numThreads = 1,
            modelType = "zipformer",
        )
        val config = OnlineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
            modelConfig = modelConfig,
            decodingMethod = "greedy_search",
        )
        return OnlineRecognizer(context.assets, config)
    }

    /** 16-bit PCM（小端）转 float [-1,1]，供模型消费。 */
    private fun pcmToFloat(pcm: ByteArray): FloatArray {
        val n = pcm.size / 2
        val out = FloatArray(n)
        for (i in 0 until n) {
            val lo = pcm[2 * i].toInt() and 0xff
            val hi = pcm[2 * i + 1].toInt()
            val s = (lo or (hi shl 8)).toShort()
            out[i] = s / 32768.0f
        }
        return out
    }

    /** asMap 已由文件顶部的 voiceMap 取代（RN 无法转换 java.util.LinkedHashMap）。 */
}
