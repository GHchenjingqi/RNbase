/**
 * Android 网络状态原生模块（Skill 规则 46/51）。
 *
 * 对应 RN 侧 src/network/nativeNetworkAdapter.ts 调用的
 * NativeModules.ERPNetwork。
 *
 * 注册方式：在 android/app/src/main/java/com/qux/MainApplication.kt 的
 * packageList.apply { add(ERPNetworkPackage()) } 中添加本 Package。
 */
package com.qux.erp

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

class ERPNetworkModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ERPNetwork"

    private val connectivityManager: ConnectivityManager by lazy {
        reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }

    private var currentStatus: WritableNativeMap = WritableNativeMap().apply {
        putBoolean("connected", false)
        putString("type", "unknown")
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            updateStatus()
        }

        override fun onLost(network: Network) {
            currentStatus = WritableNativeMap().apply {
                putBoolean("connected", false)
                putString("type", "none")
            }
        }

        override fun onCapabilitiesChanged(
            network: Network,
            capabilities: NetworkCapabilities,
        ) {
            updateStatus()
        }

        private fun updateStatus() {
            val activeNetwork = connectivityManager.activeNetwork
            val caps = activeNetwork?.let { connectivityManager.getNetworkCapabilities(it) }
            val connected = caps != null
            val type = when {
                !connected -> "none"
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "wifi"
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "cellular"
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "wired"
                else -> "unknown"
            }
            currentStatus = WritableNativeMap().apply {
                putBoolean("connected", connected)
                putString("type", type)
            }
        }
    }

    init {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        connectivityManager.registerNetworkCallback(request, networkCallback)
        updateInitialStatus()
    }

    private fun updateInitialStatus() {
        val activeNetwork = connectivityManager.activeNetwork
        val caps = activeNetwork?.let { connectivityManager.getNetworkCapabilities(it) }
        val connected = caps != null
        val type = when {
            !connected -> "none"
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "wifi"
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "cellular"
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "wired"
            else -> "unknown"
        }
        currentStatus = WritableNativeMap().apply {
            putBoolean("connected", connected)
            putString("type", type)
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        updateInitialStatus()
        promise.resolve(currentStatus)
    }

    companion object {
        private const val REQUEST_NETWORK = 9101
    }
}
