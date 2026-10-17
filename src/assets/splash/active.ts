/**
 * 当前活动应用的品牌闪屏资源（构建期由 scripts/apply-app-meta.js 自动生成/复位，勿手改）。
 *
 * 子应用在 app-brand/splash.png 提供了闪屏主图时，本文件被改写为 require 该图
 * （splash-brand.png，打包期由脚本从主图拷贝，不入库）；null = 未配置品牌闪屏，
 * SplashOverlay 回落基座默认闪图 splash-default.jpg。
 */
export const SPLASH_ACTIVE: number | null = null;
