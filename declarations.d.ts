/**
 * 声明 html 资源模块：Metro 会把 .html 当作 asset（数字 id）返回。
 */
declare module '*.html' {
  const assetId: number;
  export default assetId;
}

/**
 * 位图资源模块：Metro 把图片当 asset（数字 id）返回，RN 自带类型只覆盖部分扩展名，
 * 这里补齐项目实际用到的（启动闪屏 jpg）。
 */
declare module '*.jpg' {
  const assetId: number;
  export default assetId;
}

declare module '*.png' {
  const assetId: number;
  export default assetId;
}

/**
 * RN 0.87 中 resolveAssetSource 位于内部路径并以 default 导出，
 * 未在 react-native 顶层导出，补充类型声明。
 */
declare module 'react-native/Libraries/Image/resolveAssetSource' {
  import type { ImageResolvedAssetSource } from 'react-native';
  const resolveAssetSource: (source: number) => ImageResolvedAssetSource | null;
  export default resolveAssetSource;
}
