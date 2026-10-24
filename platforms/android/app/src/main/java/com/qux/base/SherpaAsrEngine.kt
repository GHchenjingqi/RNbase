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
import android.util.Log
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
        /** 采样峰值低于该值视为静音（约 -46dBFS），说明麦克风压根没采到声音。 */
        private const val SILENCE_PEAK = 0.005f
        /** 语音最短时长（秒）：片段太短，识别器出不了字。 */
        private const val MIN_SPEECH_SECONDS = 0.3
        /** 日志 tag，方便 adb logcat -s SherpaAsrEngine 抓取排查。 */
        private const val TAG = "SherpaAsrEngine"
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
            // 用 VOICE_RECOGNITION 而非 MIC：该 source 专为语音识别设计，框架更可靠地把
            // 麦克风音频送进来，并默认开启 AGC（自动增益）。这既能规避部分机型用 MIC 时
            // 被静音/输入路由异常导致「采到全 0 静音」的问题，也能把轻声说话的电平抬到
            // 静音阈值之上，避免误判成 E_AUDIO_EMPTY。
            val record = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                minBuf * 2,
            )
            // AudioRecord 构造不一定会抛异常，必须显式校验初始化状态。
            if (record.state != AudioRecord.STATE_INITIALIZED) {
                record.release()
                promise.reject("E_AUDIO_INIT_FAILED", "AudioRecord 初始化失败（设备不支持该音频配置）")
                return
            }
            record.startRecording()
            // startRecording() 同样不保证真正进入录音态，未进入则说明拿不到麦克风，
            // 这类情况用 MIC 时容易表现为「采到全 0」却无任何报错，这里提前暴露。
            if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                record.release()
                promise.reject("E_AUDIO_INIT_FAILED", "AudioRecord 启动录音失败（无法获取麦克风）")
                return
            }
            val bos = ByteArrayOutputStream()
            pcmRef.set(bos)
            recordingRef.set(record)
            isRecording.set(true)
            recordStartMs.set(System.currentTimeMillis())
            val t = thread(start = true, name = "asr-capture") {
                val chunk = ByteArray(minBuf)
                var errCount = 0
                while (isRecording.get()) {
                    val read = record.read(chunk, 0, chunk.size)
                    when {
                        read > 0 -> { bos.write(chunk, 0, read); errCount = 0 }
                        read == AudioRecord.ERROR_INVALID_OPERATION ||
                            read == AudioRecord.ERROR_BAD_VALUE -> {
                            // 偶发内部错误可重试；持续失败说明录音器异常，及时退出避免空转卡死。
                            Log.w(TAG, "AudioRecord.read 返回错误码 $read")
                            if (++errCount > 50) break
                            try { Thread.sleep(10) } catch (_: InterruptedException) { }
                        }
                        // read == 0：暂无数据，继续轮询
                    }
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
                promise.reject("E_AUDIO_EMPTY", "未采集到音频：录音内容为空，请确认已授权麦克风后重试")
                return
            }
            val samples = pcmToFloat(pcm)
            val peak = peakAmplitude(samples)
            Log.i(TAG, "ASR 停止录音 pcmBytes=${pcm.size} samples=${samples.size} peak=${formatPeak(peak)} durationMs=$durationMs")
            // 静音判定：峰值过低说明麦克风根本没采到声音（权限未授予、被其他应用占用、
            // 选错输入源），与「识别不出文字」是两类完全不同的故障，必须分开报，
            // 否则用户只会看到一句「没识别到文字」，无从下手。
            if (peak < SILENCE_PEAK) {
                promise.reject(
                    "E_AUDIO_EMPTY",
                    "未采集到声音（音量峰值 ${formatPeak(peak)}，低于 ${formatPeak(SILENCE_PEAK)}）。" +
                        "请检查麦克风权限、是否被其他应用占用，并贴近麦克风后重试",
                )
                return
            }
            if (samples.size < SAMPLE_RATE * MIN_SPEECH_SECONDS) {
                promise.reject(
                    "E_AUDIO_TOO_SHORT",
                    "录音仅 ${samples.size * 1000 / SAMPLE_RATE}ms，短于 ${MIN_SPEECH_SECONDS * 1000}ms，请至少说满一句话",
                )
                return
            }
            executor.submit {
                try {
                    val recognizer = recognizerRef.get() ?: run {
                        promise.reject("E_MODEL_NOT_READY", "语音模型未就绪")
                        return@submit
                    }
                    // 该版本 sherpa-onnx 的流式 API 挂在 OnlineStream 上：
                    // acceptWaveform/inputFinished 是 stream 的方法，getResult 需要传入 stream。
                    val stream = recognizer.createStream()
                    val text = try {
                        var offset = 0
                        val chunkSize = SAMPLE_RATE // 每次喂 1 秒，贴合流式处理节奏
                        while (offset < samples.size) {
                            val end = minOf(offset + chunkSize, samples.size)
                            val chunk = samples.copyOfRange(offset, end)
                            stream.acceptWaveform(chunk, chunk.size)
                            // 必须显式驱动解码：acceptWaveform 只把音频塞进流的缓冲区，
                            // 真正的 encoder/decoder/joiner 推理发生在 decode() 里。
                            // 漏掉这步，getResult 永远返回空文本。
                            while (recognizer.isReady(stream)) {
                                recognizer.decode(stream)
                            }
                            offset = end
                        }
                        stream.inputFinished()
                        // 收尾：把最后几帧解完（上游示例在 inputFinished 后还会再 decode 一次）
                        recognizer.decode(stream)
                        while (recognizer.isReady(stream)) {
                            recognizer.decode(stream)
                        }
                        recognizer.getResult(stream).text ?: ""
                    } finally {
                        stream.release()
                    }
                    Log.i(TAG, "ASR 识别完成 text=\"$text\" peak=${formatPeak(peak)}")
                    promise.resolve(
                        voiceMap(
                            "text" to text,
                            "durationMs" to durationMs,
                            "modelVersion" to modelVersion,
                            "peak" to peak,
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

    /** 采样峰值（0~1）：用于判断麦克风是否真的采到了声音。 */
    private fun peakAmplitude(samples: FloatArray): Float {
        var peak = 0f
        for (s in samples) {
            val a = if (s < 0) -s else s
            if (a > peak) peak = a
        }
        return peak
    }

    /** 峰值格式化：保留 4 位小数，用户能从报错里直接判断录音电平高低。 */
    private fun formatPeak(peak: Float): String =
        String.format(java.util.Locale.US, "%.4f", peak)

    /** asMap 已由文件顶部的 voiceMap 取代（RN 无法转换 java.util.LinkedHashMap）。 */
}
