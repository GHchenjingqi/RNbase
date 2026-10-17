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
import type { SignaturePolicy } from '../updater/verifier';
import { isIos } from '../platform/os';
import versionInfo from '../../version.json';

/** App 版本号，统一从项目根 version.json 读取（与 Android versionName / iOS MARKETING_VERSION 保持一致）。 */
export const APP_VERSION = versionInfo.versionName;
/** 应用中文名：打包时由子应用 app.config.json 经 apply-app-meta.js 下发到 version.json，
 *  闪屏居中展示、状态栏/分享等需要「显示名」处复用同一真源。 */
export const APP_NAME = String(versionInfo.appName ?? '');

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
 * 登录 clientId（安卓 / iOS / 鸿蒙各一个）。
 * 打包时基座按 Platform.OS 取用，通过 Bridge app.getClientId 暴露给 H5，
 * H5 登录接口携带该参数，后端据此区分交易来源端。
 */
export const CLIENT_ID = {
  /** 安卓包 clientId */
  android: '428a8310cd442757ae699df5d894f051',
  /** iOS 包 clientId（打包 iOS 前替换为 iOS 端分配值） */
  ios: 'PLEASE_SET_IOS_CLIENT_ID',
  /**
   * 鸿蒙包 clientId。后端尚未为鸿蒙端分配独立值前，暂时复用安卓 id：
   * 鸿蒙包走的是同一套基座账号体系，凭空造一个 id 会让登录直接被拒。
   * 后端注册后把这里换成独立值即可，无需改任何调用方。
   */
  harmony: '428a8310cd442757ae699df5d894f051',
};

/**
 * 打包前客户端标识校验（尤其是 iOS）。
 *
 * `CLIENT_ID.ios` 默认是占位值 `PLEASE_SET_IOS_CLIENT_ID`，未替换会导致 iOS 端登录被后端拒绝。
 * App 启动时调用 validateClientIds()，命中占位值会在控制台与设备日志中明确告警，
 * 避免「装机后才发现白屏/登录失败」再回源码排查。
 *
 * @returns 仍为占位值的端列表（['ios'] / ['android','ios'] 等），全配置则返回空数组。
 */
const PLACEHOLDER_CLIENT_ID = 'PLEASE_SET_IOS_CLIENT_ID';

export function validateClientIds(): string[] {
  const missing: string[] = [];
  (Object.keys(CLIENT_ID) as Array<keyof typeof CLIENT_ID>).forEach((platform) => {
    const id = CLIENT_ID[platform];
    if (!id || id === PLACEHOLDER_CLIENT_ID) {
      missing.push(platform);
    }
  });
  return missing;
}

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
 * ===================== 崩溃上报（P2 可观测闭环） =====================
 */

/**
 * 崩溃上报网关地址（可选）。
 *
 *  - 为空（默认）：崩溃仅写入设备日志（device-logger），不上报远端；
 *  - 配置后：App 启动注册 HTTP 上报器（createHttpCrashUploader），
 *    崩溃经 recordCrash 入离线缓冲后异步冲刷，形成「捕获 → 落盘 → 上报」闭环。
 *
 * 通过 version.json 的 `crashReportEndpoint` 注入（避免硬编码入库）。
 */
export const CRASH_REPORT_ENDPOINT: string | null = (() => {
  const raw = (versionInfo as { crashReportEndpoint?: unknown }).crashReportEndpoint;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
})();

/**
 * 状态栏样式容器级覆盖（可选）。
 *
 * 通过子应用 app.config.json 的 `statusBarStyle`（default / light-content / dark-content）
 * 经 apply-app-meta.js 下发到 version.json。适用场景：远程站点模式拿不到 Bridge，
 * H5 无法调 RN.STATUSBAR.SETBARSTYLE，只能靠配置声明站点配色的状态栏深浅。
 * 优先级：H5 Bridge 接管 > 本配置 > 系统深浅色；未配置（'' / 非法值）为 null。
 */
export type StatusBarStyleValue = 'default' | 'light-content' | 'dark-content';

export const STATUS_BAR_STYLE: StatusBarStyleValue | null = (() => {
  const raw = (versionInfo as { statusBarStyle?: unknown }).statusBarStyle;
  return raw === 'default' || raw === 'light-content' || raw === 'dark-content' ? raw : null;
})();

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
 * ===================== H5 包签名校验（P2 安全闭环） =====================
 */

/**
 * H5 更新包签名公钥（SPKI PEM，RSASSA-PKCS1-v1_5 / SHA-256）。
 *
 *  - 为空（默认）：签名校验为 `optional`（灰度观察期，manifest 带签名才校验）；
 *  - 配置后：校验策略升级为 `required`，manifest 未携带签名或校验失败直接拒绝该更新包
 *    （防篡改 / 防中间人替换整包）。
 *
 * 通过 version.json 的 `h5PublicKey` 注入（避免硬编码入库），CI/打包脚本亦可覆盖。
 * 注意：RN/Hermes 无 Web Crypto，需同时注入原生签名校验器（见 UpdateOrchestrator）。
 */
export const H5_UPDATE_PUBLIC_KEY: string | null = (() => {
  const raw = (versionInfo as { h5PublicKey?: unknown }).h5PublicKey;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
})();

/** 由是否配置公钥推导签名校验策略。 */
export const SIGNATURE_POLICY: SignaturePolicy = H5_UPDATE_PUBLIC_KEY ? 'required' : 'optional';

/**
 * ===================== TLS 证书锁定（P2 安全闭环） =====================
 */

/**
 * 可信证书 pin 列表（证书 SPKI 的 SHA-256，base64）。
 *
 *  - 为空（默认）：观察模式，不强制锁定（见 ssl-pinning.ts validatePinning）；
 *  - 配置后：原生信任管理器在握手指纹校验时只放行命中 pin 的证书，防中间人。
 *
 * 通过 version.json 的 `trustedCertPins` 注入（避免硬编码入库）。
 */
export const TRUSTED_CERT_PINS: string[] = (() => {
  const raw = (versionInfo as { trustedCertPins?: unknown }).trustedCertPins;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
})();

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
export const H5_MANIFEST_URL = 'https://mobile-base.example.com/manifest.json';

/**
 * Feature Flag 开关地址（P3 通用基座能力，运行时开关不发版止血）。
 * 约定与 manifest 同源：{base}/flags.json；version.json 的 `flagsUrl` 可覆盖。
 */
export const FEATURE_FLAGS_URL: string | null = (() => {
  const raw = (versionInfo as { flagsUrl?: unknown }).flagsUrl;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return H5_MANIFEST_URL ? H5_MANIFEST_URL.replace(/\/manifest\.json$/, '/flags.json') : null;
})();

/**
 * 「基座 + URL」容器模式开关（version.json 的 `remoteUrl` 字段）。
 *
 * 填了就是一个纯 WebView 壳：WebView 直接加载该地址，不再解析本地 H5、不做 H5 子包更新、
 * 不等 `app.ready` 握手（第三方页不会实现本基座的 Bridge 协议，等握手只会 10s 后进诊断页）。
 * 留空 = 本地 H5 模式（默认，行为与历史完全一致）。
 *
 * 为什么在这里做严格校验而不是直接透传：这个值会进 WebView 的 source.uri，
 * `javascript:` / `data:` / `file:` 之类的 scheme 等于把一段任意脚本塞进带原生能力的容器。
 * 只认 http(s) + 有 host，其余一律当「没开」处理。
 */
const REMOTE_URL_SCHEME = /^https?:\/\/[^\s/?#]+/i;

function normalizeRemoteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const url = raw.trim();
  // 不用 new URL()：Hermes 侧的 URL 是 RN 的 whatwg-url 补丁，在模块初始化期不一定可用，
  // 而这里是 config 加载时就要求的常量；正则足够（只要 scheme + host）。
  return url && REMOTE_URL_SCHEME.test(url) ? url : null;
}

/** 远程站点地址；null 表示本地 H5 模式。 */
export const REMOTE_H5_URL: string | null = normalizeRemoteUrl(
  (versionInfo as { remoteUrl?: unknown }).remoteUrl
);

/** 是否处于「基座 + URL」模式。 */
export const IS_REMOTE_H5 = REMOTE_H5_URL !== null;

/**
 * 启动闪屏展示时长（毫秒，version.json 的 `splashDurationMs` 字段）。
 *
 * 闪屏由 RN 侧 SplashOverlay 跨端实现（全屏闪图 + 倒计时 + 淡出），三端表现一致；
 * 原生侧只保留纯色 windowBackground（colors.xml 的 splash_bg）遮盖 RN 装载前的空白。
 * 未配置 = 3000（默认体验）；显式 0 = 关闭；负值/非数字按默认处理；
 * 上限 15000——配置手滑不至于把用户锁在启动页半分钟。
 */
export const SPLASH_DURATION_MS: number = (() => {
  const DEFAULT_MS = 3000;
  const MAX_MS = 15000;
  const raw = (versionInfo as { splashDurationMs?: unknown }).splashDurationMs;
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_MS;
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_MS;
  }
  return Math.min(Math.round(n), MAX_MS);
})();

/**
 * 闪屏底色（version.json 的 `splashBackgroundColor`，apply-app-meta.js 下发）。
 *
 * 两个消费方：① 原生 windowBackground（colors.xml 的 splash_bg，遮 RN 装载前空白）；
 * ② RN 倒计时闪屏 SplashOverlay——闪图用 contain 完整显示（cover 会按屏幕比例裁切，
 * 宽幅设计稿在大屏手机上两端被切变形），留白区域用它填充；闪图背景与底色同系时
 * 视觉无缝，任意屏幕比例都不裁不变形。非法/缺失回落 #EAEFF7（与默认闪图同系浅色）。
 */
export const SPLASH_BG_COLOR: string = (() => {
  const raw = (versionInfo as { splashBackgroundColor?: unknown }).splashBackgroundColor;
  const v = typeof raw === 'string' ? raw.trim() : '';
  return /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(v) ? v : '#EAEFF7';
})();

/**
 * ===================== 调试期直连本地 H5（仅 debug 生效） =====================
 */

/**
 * 子应用 dev server 在宿主机上的默认端口。
 *
 * 三端统一 5173（vite 默认）：鸿蒙一直这么跑（`hdc rport tcp:5173`），安卓/iOS 对齐
 * 同一个端口后，子应用只需起一次 dev server，改端口的地方只剩这一处常量。
 */
export const H5_DEV_SERVER_PORT = 5173;

/** version.json 的 `h5DevUrl` 显式关闭值：只改 RN 代码、不想起 dev server 时用。 */
const H5_DEV_ENTRY_OFF = 'off';

/**
 * debug 期 H5 入口：直接指向宿主机上跑着的子应用 dev server。
 *
 * 为什么需要：子应用改一行要走 `build → sync:base → 重装 APK/HAP`，反馈循环以分钟计；
 * debug 期让 WebView 直接吃宿主机源码，保存即生效，不必重新装机。
 * 由此也推出一条结论：**debug 期不需要 H5 子包热更新（src/updater 那条 OTA 链路）** ——
 * 入口就是宿主机源码本身，下载子包换入口反而会把页面拉回旧包（见 AppRoot 的分支）。
 *
 * 三端到宿主机的可达路径不同，默认值按平台给：
 *  - 安卓：设备侧 127.0.0.1 由 `adb reverse tcp:5173` 映射到宿主机（scripts/adb-forward.js）；
 *  - 鸿蒙：设备侧 127.0.0.1 由 `hdc rport tcp:5173` 映射（scripts/harmony-dev.js）；
 *  - iOS：模拟器与宿主机共享网络栈，`http://localhost:5173/` 直达；
 *    真机需把 version.json 的 `h5DevUrl` 填成宿主机局域网地址（ATS 已开
 *    NSAllowsLocalNetworking，明文 HTTP 到内网地址放行）。
 *
 * 取值规则（version.json 的 `h5DevUrl`，由 scripts/apply-app-meta.js 保留现值）：
 *  - 留空 / 缺失 / 非法：用平台默认（安卓、鸿蒙 127.0.0.1，iOS localhost）；
 *  - 合法 http(s)：用它，缺尾斜杠自动补（子应用 vite 是 base:'./'，没尾斜杠相对路径基准会错）；
 *  - `off`（不区分大小写）：显式关闭，退回内置 H5。
 *
 * release 恒为 null：正式包绝不能指向宿主机地址。
 */
export const H5_DEV_SERVER_URL: string | null = (() => {
  if (!(typeof __DEV__ !== 'undefined' && __DEV__)) {
    return null;
  }
  const raw = (versionInfo as { h5DevUrl?: unknown }).h5DevUrl;
  if (typeof raw === 'string') {
    const value = raw.trim();
    if (value.toLowerCase() === H5_DEV_ENTRY_OFF) {
      return null;
    }
    // 复用 remoteUrl 那套 scheme 校验：这个值会进 WebView 的 source.uri。
    const normalized = normalizeRemoteUrl(value);
    if (normalized) {
      return normalized.endsWith('/') ? normalized : `${normalized}/`;
    }
  }
  const host = isIos() ? 'localhost' : '127.0.0.1';
  return `http://${host}:${H5_DEV_SERVER_PORT}/`;
})();

/**
 * 远程站点模式「主资源加载超时」（毫秒，默认 30000）。
 *
 * 仅在 bridgeEnabled=false（远程站点）时启用：从 onLoadStart 起算，
 * 若 onLoadEnd（HTML 主资源到达）未在时限内触发，判定为离线 / DNS 挂起 / 站点过慢，
 * 切到错误页（可重新加载）。
 *
 * 为什么只卡「主资源」：第三方 SPA「返回 200 却卡在自身加载态」时 onLoadEnd 已触发，
 * 此超时不会误伤（README 远程模式硬性限制已说明这类无兜底）；
 * 它兜的是「连 HTML 都拿不到」的硬失败——这类失败 WebView 未必抛 onError（实测离线偶发白屏），
 * 故用软超时补齐（规范 §26 加载失败兜底）。
 */
export const REMOTE_H5_LOAD_TIMEOUT_MS = 30000;

/**
 * 远程站点的 origin（`scheme://host[:port]`），用于 Bridge 来源校验与导航白名单。
 * 取不到就退回整串 URL 的截断，保证不会把 path/query 当成 origin 放行。
 */
export const REMOTE_H5_ORIGIN: string | null = (() => {
  if (!REMOTE_H5_URL) {
    return null;
  }
  const m = REMOTE_H5_URL.match(/^(https?:\/\/[^\s/?#]+)/i);
  return m ? m[1] : null;
})();

/** WebView 信任源 / 域名白名单（规则 24/25）。 */
export const DOMAIN_WHITELIST: string[] = (() => {
  const list = ['https://mobile-base.example.com'];
  // 远程模式下站点自己就是第一信任源，否则 BridgeServer 的来源校验会拒掉它的消息。
  if (REMOTE_H5_ORIGIN) {
    list.push(REMOTE_H5_ORIGIN);
  }
  // dev 模式下自动添加 Metro dev server 地址，否则 H5 入口被导航拦截导致白屏
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    list.push(
      'http://localhost:8082',
      'http://127.0.0.1:8082',
      'http://10.0.2.2:8082', // Android 模拟器访问宿主机的特殊地址
      // 通过 adb reverse 将模拟器 8081 转发到宿主机 8082 时，WebView 实际加载的是 8081 端口
      'http://localhost:8081',
      'http://127.0.0.1:8081',
      'http://10.0.2.2:8081'
    );
    // debug 期 H5 直连宿主机 dev server：不进白名单会被 decideNavigation 判成
    // untrusted_origin 弹系统浏览器，首屏直接飞出容器。按 origin 匹配（去尾斜杠）。
    if (H5_DEV_SERVER_URL) {
      list.push(H5_DEV_SERVER_URL.replace(/\/+$/, ''));
    }
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
