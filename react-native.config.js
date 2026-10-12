/**
 * React Native CLI 配置：android/ios 工程已移至 platforms/ 下，
 * 通过 sourceDir 告知 CLI 原生工程的实际位置。
 */
module.exports = {
  project: {
    android: {
      sourceDir: 'platforms/android',
    },
    ios: {
      sourceDir: 'platforms/ios',
    },
  },
};
