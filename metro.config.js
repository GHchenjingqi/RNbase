const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
// metro-config 只被 RN 间接依赖，未提升时此处无法从项目根解析，故在 devDependencies 显式声明
const exclusionList = require('metro-config/private/defaults/exclusionList').default;
const fs = require('fs');
const path = require('path');
const url = require('url');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */

/**
 * RNOH（鸿蒙）Metro 配置：只在 platform=harmony 时改写模块解析。
 *
 * 本基座已整仓降到 RN 0.84.1（与 RNOH 0.84.4 的 peer 精确锁对齐）并安装了 RNOH，
 * 因此加载时若找不到 RNOH 就是真的装错了/没装，直接报错提示而非静默跳过。
 */
let createHarmonyMetroConfig = null;
try {
  createHarmonyMetroConfig =
    require('@react-native-oh/react-native-harmony/metro.config').createHarmonyMetroConfig;
} catch (err) {
  if (process.argv.some(arg => /harmony/i.test(arg))) {
    throw new Error(
      `鸿蒙打包需要 @react-native-oh/react-native-harmony，但它无法加载：${err.message}\n` +
        '  基座已是 react-native 0.84.1 + RNOH 0.84.4；请检查 @react-native-oh/react-native-harmony\n' +
        '  等包是否装入了 node_modules（见 README「鸿蒙（RNOH）」一节）。',
    );
  }
}

const config = {
  // h5 目录下的 .js 静态库（three.min.js / GLTFLoader.js / OrbitControls.js 等）
  // 通过 WebView <script src> 从 Metro asset 服务加载。
  // 注意：.js 不能加入 resolver.assetExts——它与 sourceExts 重叠会导致 Metro
  // 把 RN 源码的 .js 模块误判为 asset，App 启动时报 "undefined is not a function"。
  // 因此用自定义中间件直接返回 h5 下的 .js 文件，绕过 assetExts 检查。
  server: {
    enhanceMiddleware: middleware => (req, res, next) => {
      const pathname = url.parse(req.url || '').pathname || '';
      if (pathname.startsWith('/assets/h5/') && pathname.endsWith('.js')) {
        const filePath = path.join(__dirname, pathname.replace(/^\/assets\//, ''));
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }
      return middleware(req, res, next);
    },
  },
  resolver: {
    // html 作为资源（asset）由 Metro 提供服务，App 通过 URL 加载 H5 页面；
    // 注意：html 不能同时出现在 sourceExts，否则会被当作 JS 源码转译而报错。
    assetExts: [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'svg',
      'ttf',
      'otf',
      'woff',
      'woff2',
      'html',
      'css',
      'glb',
      'gltf',
      'obj',
      'mtl',
    ],
    sourceExts: ['js', 'jsx', 'ts', 'tsx', 'json'],
    // android/ios 已移至 platforms/ 下，排除原生工程构建产物目录，
    // 避免 watcher 因 gradle/xcode 频繁读写、删除文件而崩溃（Metro 默认只排除 android/ios 根目录）。
    // 注意：exclusionList 会把正则中的 '/' 转义为系统路径分隔符，这里统一用 '/' 书写。
    blockList: exclusionList([
      /\/platforms\/android\/\.gradle\/.*/,
      /\/platforms\/android\/\.kotlin\/.*/,
      /\/platforms\/android\/.*\/build\/.*/,
      /\/platforms\/ios\/.*\/build\/.*/,
      // node_modules 下第三方原生库（react-native-webview 等）的 android/ios 构建目录，
      // gradle codegen 会频繁生成/清理这些目录，watcher 监听被删目录会 ENOENT 崩溃
      /\/node_modules\/.*\/android\/build\/.*/,
      /\/node_modules\/.*\/ios\/build\/.*/,
      /\/node_modules\/.*\/\.gradle\/.*/,
      // 鸿蒙工程（harmony/ 必须在仓库根一级：hvigor 插件按 process.cwd()/../node_modules 找依赖）
      // 的原生构建产物：hvigor/ohpm 读写频繁，且里面不含 RN JS 源码。
      // mergeConfig 的数组是「后者覆盖」，所以 harmony 侧的 /\.cxx/ 也必须写在这里。
      /\/harmony\/.*\/build\/.*/,
      /\/harmony\/\.hvigor\/.*/,
      /\/harmony\/oh_modules\/.*/,
      /\.cxx/,
    ]),
  },
};

const metroConfig = mergeConfig(
  getDefaultConfig(__dirname),
  createHarmonyMetroConfig
    ? createHarmonyMetroConfig({
        reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
      })
    : {},
  config,
);

/**
 * 鸿蒙侧 JS 覆盖表：包名 -> 仓内替身文件。
 * RNOH 自带的 `harmony.alias` 只能把包指向另一个「包」，且移植包本身可能只适配了
 * 旧版 RNOH ABI（safe-area-context 即如此：TurboModule 可用，原生组件不可用），
 * 因此这里在 harmony 平台上把包名直接换成纯 JS 替身。
 */
const HARMONY_JS_OVERRIDES = {
  'react-native-safe-area-context': 'src/platform/harmony/safe-area-context.harmony.tsx',
};

const upstreamResolveRequest = metroConfig.resolver.resolveRequest;
metroConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'harmony' &&
    Object.prototype.hasOwnProperty.call(HARMONY_JS_OVERRIDES, moduleName)
  ) {
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, HARMONY_JS_OVERRIDES[moduleName]),
    };
  }
  return upstreamResolveRequest
    ? upstreamResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = metroConfig;
