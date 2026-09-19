/**
 * 集中配置（与 Skill 第 2 节推荐目录 config/ 对齐）。
 *
 * 将 App/Bridge 版本、域名白名单、各类超时、H5 manifest 地址、日志、
 * 更新器、媒体、性能等配置统一管理，避免散落各处。
 *
 * 引用方式：模块内默认值从全局 config 读取（options.xxx ?? CONFIG_XXX），
 * 同时保留参数覆盖能力。
 */
import type { ImageCompressOptions } from '../media/types';
import type { PerformanceBaseline } from '../performance/types';
import versionInfo from '../../version.json';

/** App 版本号，统一从项目根 version.json 读取（与 Android versionName / iOS MARKETING_VERSION 保持一致）。 */
export const APP_VERSION = versionInfo.versionName;

export const BRIDGE_VERSION = '1.0.1';

/**
 * Bridge 协议版本（消息格式版本，独立于 Bridge 实现版本）。
 * 语义：H5 声明的 minBridge 与 App 侧 BRIDGE_VERSION 做 major/minor 兼容判断；
 * protocolVersion 标识协议消息格式（request/response/event 结构），
 * 与 bridgeVersion（实现能力版本）、SDK 版本（H5 侧 sdkVersion）三者区分。
 */
export const BRIDGE_PROTOCOL_VERSION = '1.1';

/**
 * ===================== 登录客户端标识 =====================
 */

/**
 * 登录 clientId（安卓 / iOS 各一个）。
 * 打包时基座按 Platform.OS 取用，通过 Bridge app.getClientId 暴露给 H5，
 * H5 登录接口携带该参数，后端据此区分交易来源端。
 */
export const CLIENT_ID = {
  /** 安卓包 clientId */
  android: '428a8310cd442757ae699df5d894f051',
  /** iOS 包 clientId（打包 iOS 前替换为 iOS 端分配值） */
  ios: 'PLEASE_SET_IOS_CLIENT_ID',
};

/**
 * ===================== 日志配置 =====================
 */

/** 设备能力调用日志级别（debug/info/warn/error）。默认 info：记录 info/success/warn/error；设为 error 仅记录 error。 */
export const LOG_LEVEL = 'info';

/** H5 事件日志保留天数（有效期）：超过该天数的按天日志文件自动清理，默认 7；传 0 表示永久保留不清理。 */
export const LOG_RETENTION_DAYS = 7;

/** H5 事件日志文件目录（相对 RNFS.DocumentDirectoryPath）。 */
export const LOG_FILE_DIR = 'logs';

/**
 * ===================== 更新器配置（updater） =====================
 */

/** 连续回滚上限：超过该次数不再自动回滚，默认 3。 */
export const UPDATE_MAX_ROLLBACKS = 3;

/** 回滚兜底版本标识，默认 builtin-fallback。 */
export const UPDATE_FALLBACK_VERSION = 'builtin-fallback';

/** 更新包下载最大重试次数，默认 3。 */
export const UPDATE_DOWNLOAD_MAX_RETRIES = 3;

/** 更新包下载重试基础延迟（毫秒），指数退避，默认 1000。 */
export const UPDATE_DOWNLOAD_RETRY_BASE_DELAY_MS = 1000;

/** 更新检查节流间隔（毫秒），默认 24 小时。 */
export const UPDATE_CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** H5 READY 确认超时（毫秒），默认 15000。 */
export const UPDATE_READY_TIMEOUT_MS = 15000;

/**
 * ===================== 媒体配置（media） =====================
 */

/** 文件上传最大并发数，默认 3。 */
export const MEDIA_UPLOAD_MAX_CONCURRENT = 3;

/** 文件上传最大重试次数，默认 3。 */
export const MEDIA_UPLOAD_MAX_RETRIES = 3;

/** 文件上传大小上限（字节），默认 50MB。 */
export const MEDIA_UPLOAD_MAX_SIZE = 50 * 1024 * 1024;

/** 弱网判定阈值，默认 50。 */
export const MEDIA_UPLOAD_WEAK_NETWORK_THRESHOLD = 50;

/** 文件上传超时（毫秒），默认 120000。 */
export const MEDIA_UPLOAD_TIMEOUT_MS = 120000;

/** 选择文件大小上限（字节），默认 50MB。 */
export const MEDIA_FILE_MAX_SIZE = 50 * 1024 * 1024;

/** 允许的文件类型（MIME），默认全部允许。 */
export const MEDIA_FILE_ALLOWED_TYPES: string[] = ['*/*'];

/** 图片压缩默认参数（quality/maxWidth/maxHeight/format/fixOrientation）。 */
export const MEDIA_IMAGE_DEFAULT_COMPRESS: Required<ImageCompressOptions> = {
  quality: 0.8,
  maxWidth: 1920,
  maxHeight: 1920,
  format: 'jpeg',
  fixOrientation: true,
};

/** 图片多选最大数量，默认 9。 */
export const MEDIA_IMAGE_MAX_COUNT = 9;

/** 单张图片最大尺寸（字节），默认 10MB。 */
export const MEDIA_IMAGE_MAX_SIZE = 10 * 1024 * 1024;

/**
 * ===================== 性能监控配置（performance） =====================
 */

/** 性能指标记录上限，默认 1000。 */
export const PERF_MAX_METRICS = 1000;

/** 性能告警记录上限，默认 200。 */
export const PERF_MAX_ALERTS = 200;

/** 默认性能基线（规范 §61 重点指标）。 */
export const PERF_DEFAULT_BASELINES: PerformanceBaseline[] = [
  {
    type: 'app_cold_start',
    name: 'App 冷启动',
    expectedDurationMs: 1500,
    maxDurationMs: 3000,
    minSamples: 5,
    description: '从进程创建到首屏可交互',
  },
  {
    type: 'app_warm_start',
    name: 'App 热启动',
    expectedDurationMs: 500,
    maxDurationMs: 1500,
    minSamples: 5,
    description: '从后台恢复到首屏可交互',
  },
  {
    type: 'h5_first_screen',
    name: 'H5 首屏',
    expectedDurationMs: 1000,
    maxDurationMs: 3000,
    minSamples: 5,
    description: '从 WebView 加载到 H5 首屏渲染完成',
  },
  {
    type: 'bridge_call',
    name: 'Bridge 调用',
    expectedDurationMs: 50,
    maxDurationMs: 500,
    minSamples: 20,
    description: 'Bridge 请求到响应的耗时',
  },
  {
    type: 'h5_download',
    name: 'H5 包下载',
    expectedDurationMs: 5000,
    maxDurationMs: 30000,
    minSamples: 3,
    description: 'H5 更新包下载耗时',
  },
  {
    type: 'image_compress',
    name: '图片压缩',
    expectedDurationMs: 500,
    maxDurationMs: 3000,
    minSamples: 5,
    description: '单张图片压缩耗时',
  },
  {
    type: 'file_upload',
    name: '文件上传',
    expectedDurationMs: 10000,
    maxDurationMs: 60000,
    minSamples: 3,
    description: '单文件上传耗时',
  },
  {
    type: 'js_long_task',
    name: 'JS 长任务',
    expectedDurationMs: 50,
    maxDurationMs: 200,
    minSamples: 10,
    description: 'JS 长任务耗时（超过 50ms 阻塞主线程）',
  },
];

/** H5 版本清单地址（规则 6/28）。 */
export const H5_MANIFEST_URL = 'https://mobile-erp.example.com/manifest.json';

/** WebView 信任源 / 域名白名单（规则 24/25）。 */
export const DOMAIN_WHITELIST: string[] = (() => {
  const list = ['https://mobile-erp.example.com'];
  // dev 模式下自动添加 Metro dev server 地址，否则 H5 入口被导航拦截导致白屏
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    list.push(
      'http://localhost:8082',
      'http://127.0.0.1:8082',
      'http://10.0.2.2:8082', // Android 模拟器访问宿主机的特殊地址
      // 通过 adb reverse 将模拟器 8081 转发到宿主机 8082 时，WebView 实际加载的是 8081 端口
      'http://localhost:8081',
      'http://127.0.0.1:8081',
      'http://10.0.2.2:8081',
    );
  }
  return list;
})();

/** H5 启动握手超时（规则 9/26）：超时进入诊断页。 */
export const HANDSHAKE_TIMEOUT_MS = 10000;

/**
 * 可信 H5 子应用 appId 白名单（升级方案 §23 安全：appId 校验）。
 * - 为空：放行所有 appId（仅对非默认 appId 打 warn 日志，灰度观察期）；
 * - 配置后：非白名单 appId 的握手被拒绝（SECURITY_BLOCKED）。
 */
export const TRUSTED_APP_IDS: string[] = [];

/** Bridge 单次调用超时（规则 14）。 */
export const BRIDGE_TIMEOUT_MS = 30000;
