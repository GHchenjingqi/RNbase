package com.qux

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.qux.erp.ERPNetworkPackage
import com.qux.erp.ERPLogPackage
import com.qux.erp.ERPH5Package
import com.qux.erp.ERPSystemPackage
import com.qux.erp.ERPCapabilitiesPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(ERPNetworkPackage())
          add(ERPLogPackage())
          add(ERPH5Package())
          add(ERPSystemPackage())
          add(ERPCapabilitiesPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
