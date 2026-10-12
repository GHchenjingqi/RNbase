import {
  AnyJSBundleProvider,
  MetroJSBundleProvider,
  RNApp,
  RNOHErrorDialog,
  RNOHCoreContext
} from '@rnoh/react-native-openharmony';
import { RawFileBufferJSBundleProvider } from '../RawFileBufferJSBundleProvider';
import { getRNOHPackages } from '../PackageProvider';

@Entry
@Component
struct Index {
  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined

  /**
   * 硬件/手势返回：RNOH 给了 `RNOHCoreContext.dispatchBackPress()`（往 JS 发
   * hardwareBackPress），但没有任何地方调用它，必须自己接。
   *
   * 只能挂在页面级：UIAbility.onBackPressed 返回 true 是「切后台不销毁」、false 是「直接销毁」，
   * 都表达不了「App 自己消化这次返回」（实测挂 Ability 上按一次返回键就把 App 甩到后台）。
   * 页面级 onBackPress 返回 true 才是「本页接管，不执行默认返回逻辑」，
   * 之后由 JS 侧 WebViewBridge 走「关弹层 → 退路由 → 双击退出」。
   */
  onBackPress(): boolean {
    const ctx = this.rnohCoreContext;
    if (!ctx) {
      return false;
    }
    ctx.dispatchBackPress();
    return true;
  }

  build() {
    Column() {
      if (this.rnohCoreContext) {
        if (this.rnohCoreContext?.isDebugModeEnabled) {
          RNOHErrorDialog({ ctx: this.rnohCoreContext })
        }
        RNApp({
          rnInstanceConfig: {
            // 必须与 RNbase index.js 的 AppRegistry.registerComponent('qux', ...) 同名，
            // 否则 RNOH 找到的是空组件名，页面永远白屏。
            name: "qux",
            createRNPackages: getRNOHPackages,
            fontResourceByFontFamily: {},
            enableDebugger: this.rnohCoreContext?.isDebugModeEnabled,
          },
          appKey: "qux",
          jsBundleProvider: this.rnohCoreContext?.isDebugModeEnabled ?
            new AnyJSBundleProvider([
              new MetroJSBundleProvider(),
              new RawFileBufferJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'hermes_bundle.hbc'),
            ]) :
            new RawFileBufferJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'hermes_bundle.hbc'),
        })
      }
    }
    .height('100%')
    .width('100%')
  }
}
