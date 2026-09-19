/**
 * Jest 配置：基于 @react-native/jest-preset，额外把 .html 当作资源
 * （asset）处理，使 App 中 require('assets/index.html') 在单测下可解析。
 */
const preset = require('@react-native/jest-preset');

module.exports = {
  ...preset,
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  transform: {
    ...preset.transform,
    '^.+\\.html$': require.resolve('@react-native/jest-preset/jest/assetFileTransformer.js'),
  },
};
