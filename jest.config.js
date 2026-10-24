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
  // 显式点名统计范围：默认只统计"被测试 import 到的文件"，于是 0% 的文件
  // 根本不进报告，看起来一片绿——真实盲区（capability 模块当时 14.6%）就是这么藏住的。
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    // metro 在 platform=harmony 才解析到的替身，jest（RN preset）这条链路根本 import 不到，
    // 计入只会留一个永远 0% 的噪声行；鸿蒙侧的行为由 harmony/ 的 ArkTS 自测覆盖。
    '!src/platform/harmony/**',
  ],
  // 下限是"不回退棘轮"，不是理想值：按当前实测（global 74.6/64.84/75.88/67.76）留约 2 个点余量，
  // 抬到这一步靠两张表驱动清单测试：__tests__/bridge/capability-table.test.ts（能力模块三态）
  // 与 __tests__/bridge/rn-modules-table.test.ts（纯 RN 模块缺参/依赖缺失/走通）。
  //
  // 这里只用 global 一档，是有意的：jest 的 glob 阈值是**逐文件**判定（'./src/bridge/**' 会拿
  // navigation.ts 这种低覆盖单文件去卡整条 glob，目录聚合只有 global），而且被 glob 命中的
  // 文件会从 global 聚合里**剔除**——实测加一条 capabilities glob 会让 global 的 functions
  // 从 63.5% 掉到 60.29%，同一条下限的含义就变了。"每个 module.action 都得有测试"由上面两张表
  // 的 listMethods() 等值断言守，比覆盖率数字准。
  coverageThreshold: {
    global: { statements: 73, branches: 63, lines: 74, functions: 66 },
  },
};
