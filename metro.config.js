const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
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
    ]),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
