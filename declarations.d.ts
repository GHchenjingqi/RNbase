/**
 * 声明 html 资源模块：Metro 会把 .html 当作 asset（数字 id）返回。
 */
declare module '*.html' {
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
