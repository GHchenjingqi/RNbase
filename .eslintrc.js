module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // scripts/ 以前整个写在 .eslintignore 里，等于构建/dev 脚本这一半代码没有门禁：
      // 端口拼错、退出码写反、process.exit 杀打包进程这类问题，只有真跑一次出包才暴露。
      // 现在纳入 lint，但只按 Node 侧的事实放宽，正确性的规则（no-undef / no-shadow 等）照常生效。
      files: ['scripts/**/*.js'],
      env: { node: true, es2017: true },
      rules: {
        // 校验和、sha256、位标志在构建脚本里是手写的（出包链路不引第三方依赖），位运算不可替代。
        'no-bitwise': 'off',
        // 事件回调里 `const self = this` 是这批脚本的既有写法，不是缺陷。
        'consistent-this': 'off',
      },
    },
  ],
};
