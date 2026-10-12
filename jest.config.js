/**
 * Jest 配置：基于 @react-native/jest-preset，额外把 .html 当作资源
 * （asset）处理，使 App 中 require('assets/index.html') 在单测下可解析。
 */
const preset = require('@react-native/jest-preset');

module.exports = {
  ...preset,
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  // harmony/ 是 DevEco 工程：hvigorfile.ts 与 oh_modules 里的 JS 不是 RN 单测，
  // 且 ArkTS 写法 babel 预设解析不了；不排除会让 jest 直接报解析错。
  testPathIgnorePatterns: ['/node_modules/', '/harmony/'],
  transform: {
    ...preset.transform,
    '^.+\\.html$': require.resolve('@react-native/jest-preset/jest/assetFileTransformer.js'),
  },
};
