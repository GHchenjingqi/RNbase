/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';

// 通用基座的 RN 根组件名固定为 "qux"，必须与 android MainActivity.getMainComponentName()
// 返回值完全一致。这里不要使用 app.json 的 name（那是 npm/RN 项目名，与运行时无关），
// 否则真机离线加载 assets/index.android.bundle 时会报：
// Invariant Violation: "qux" has not been registered。
AppRegistry.registerComponent('qux', () => App);
