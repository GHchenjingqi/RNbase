package com.qux

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.qux.base.BaseNetworkPackage
import com.qux.base.BaseLogPackage
import com.qux.base.BaseH5Package
import com.qux.base.BaseSystemPackage
import com.qux.base.BaseCapabilitiesPackage
import com.qux.base.BaseUpdatePackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(BaseNetworkPackage())
          add(BaseLogPackage())
          add(BaseH5Package())
          add(BaseSystemPackage())
          add(BaseCapabilitiesPackage())
          add(BaseUpdatePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
