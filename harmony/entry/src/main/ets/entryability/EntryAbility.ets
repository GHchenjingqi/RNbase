/**
 * Copyright (c) 2025 Huawei Technologies Co., Ltd.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {RNAbility} from '@rnoh/react-native-openharmony';

export default class EntryAbility extends RNAbility {
  override getPagePath() {
    return 'pages/Index';
  }

  override getRNOHWorkerScriptUrl() {
    return "entry/ets/workers/RNOHWorker.ets"
  }

  // 别在这里覆写 onWindowSetup 去关全屏布局（RNAbility 默认 setWindowLayoutFullScreen(true)）。
  // 2026-09-30 实测过一版关掉：WebView 从 [0,137][1320,2856] 收成 [0,137][1320,2758]，
  // 底栏内的 env(safe-area-inset-bottom) 确实归零了，但 98px 手势条改由系统画、仍是白的，
  // 「标签下方到屏幕底」的白条从 107px 涨到 143px（更矮不了）；同时
  // RN.SYSTEM.GETSTATUSBARHEIGHT 照旧回 42.2857vp（RNOH 读的是窗口避让区，不看组件实际位置），
  // H5 又叠一层 42px 顶部留白 → 首页 hero 和吸顶导航全部多出一段死高。两头都亏，已回退。

  // 硬件/手势返回**不在这里接**：UIAbility.onBackPressed 返回 true 的语义是
  // 「把 Ability 切到后台、不销毁」（实测按一次返回键就把 App 甩到后台，露出下层窗口），
  // 返回 false 又直接销毁 Ability，两种都拿不到「App 自己消化这次返回」的行为。
  // 页面级回调才有这个语义，见 pages/Index.ets 的 onBackPress。
}
