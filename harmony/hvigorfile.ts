import { appTasks } from '@ohos/hvigor-ohos-plugin';
import { createRNOHProjectPlugin } from '@rnoh/hvigor-plugin';

export default {
  system: appTasks,
  plugins: [
    createRNOHProjectPlugin({
      bundler: {
        // 产出 HBC（rawfile/hermes_bundle.hbc），与 Index.ets 里 ResourceJSBundleProvider 的文件名一致；
        // 不设这项则默认产出 rawfile/bundle.harmony.js，release 包会找不到 bundle。
        jsEngine: 'hermes',
      },
    }),
  ],
};
