/**
 * 性能监控统一类型定义（Phase 14 / 规范 §61、§31、§23、§57）。
 *
 * 重点指标：App 冷启动、H5 首屏、Bridge 调用耗时、H5 包下载、
 *           图片压缩、文件上传、WebView 内存、JS 长任务。
 *
 * 优化原则：数据驱动、稳定性优先、高频事件红线（禁止每 10ms 级别穿桥）。
 */

/** 性能指标类型。 */
export type PerformanceMetricType =
  | 'app_cold_start'
  | 'app_warm_start'
  | 'h5_first_screen'
  | 'bridge_call'
  | 'h5_download'
  | 'image_compress'
  | 'file_upload'
  | 'webview_memory'
  | 'js_long_task'
  | 'custom';

/** 性能指标记录。 */
export type PerformanceMetric = {
  /** 指标唯一 ID */
  id: string;
  /** 指标类型 */
  type: PerformanceMetricType;
  /** 指标名称 */
  name: string;
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳 */
  endTime?: number;
  /** 耗时（毫秒） */
  durationMs?: number;
  /** 附加数据 */
  data?: Record<string, unknown>;
  /** 标签（用于分类筛选） */
  tags?: string[];
};

/** 性能基线配置。 */
export type PerformanceBaseline = {
  /** 指标类型 */
  type: PerformanceMetricType;
  /** 指标名称 */
  name: string;
  /** 期望耗时（毫秒） */
  expectedDurationMs?: number;
  /** 最大允许耗时（毫秒），超过则告警 */
  maxDurationMs?: number;
  /** 最小样本数 */
  minSamples?: number;
  /** 描述 */
  description?: string;
};

/** 性能告警级别。 */
export type PerformanceAlertLevel = 'info' | 'warning' | 'critical';

/** 性能告警。 */
export type PerformanceAlert = {
  /** 告警 ID */
  id: string;
  /** 告警级别 */
  level: PerformanceAlertLevel;
  /** 告警类型 */
  type: PerformanceMetricType;
  /** 告警消息 */
  message: string;
  /** 相关指标 */
  metric?: PerformanceMetric;
  /** 时间戳 */
  timestamp: number;
};

/** 性能报告。 */
export type PerformanceReport = {
  /** 报告生成时间 */
  generatedAt: number;
  /** 时间范围（开始） */
  from: number;
  /** 时间范围（结束） */
  to: number;
  /** 各指标统计 */
  metrics: Array<{
    type: PerformanceMetricType;
    name: string;
    count: number;
    avgDurationMs?: number;
    minDurationMs?: number;
    maxDurationMs?: number;
    p50DurationMs?: number;
    p95DurationMs?: number;
    p99DurationMs?: number;
    alerts: number;
  }>;
  /** 告警列表 */
  alerts: PerformanceAlert[];
  /** 总结 */
  summary: {
    totalMetrics: number;
    totalAlerts: number;
    criticalAlerts: number;
    warningAlerts: number;
  };
};

/** 节流配置。 */
export type ThrottleOptions = {
  /** 最小间隔（毫秒），默认 100ms */
  minIntervalMs?: number;
  /** 最大等待时间（毫秒），默认 1000ms */
  maxWaitMs?: number;
  /** 是否在节流开始时立即执行一次，默认 false */
  leading?: boolean;
  /** 是否在节流结束时执行一次，默认 true */
  trailing?: boolean;
};

/** 批量请求配置。 */
export type BatchOptions = {
  /** 最大批量大小，默认 10 */
  maxBatchSize?: number;
  /** 最大等待时间（毫秒），默认 100ms */
  maxWaitMs?: number;
  /** 批量处理函数 */
  handler: (
    items: Array<{ id: string; data: unknown }>,
  ) => Promise<Array<{ id: string; result: unknown }>>;
};

/** 资源预加载配置。 */
export type PreloadOptions = {
  /** 预加载超时（毫秒），默认 5000ms */
  timeoutMs?: number;
  /** 最大并发数，默认 3 */
  maxConcurrent?: number;
  /** 缓存大小（MB），默认 50MB */
  maxCacheSizeMB?: number;
};

/** 内存快照。 */
export type MemorySnapshot = {
  /** 时间戳 */
  timestamp: number;
  /** 已用内存（MB） */
  usedMB: number;
  /** 总内存（MB） */
  totalMB?: number;
  /** 可用内存（MB） */
  availableMB?: number;
  /** JS 堆大小（MB） */
  jsHeapSizeMB?: number;
  /** JS 堆已用（MB） */
  jsHeapUsedMB?: number;
};

/** 内存告警阈值。 */
export type MemoryThresholds = {
  /** 警告阈值（MB），默认 200MB */
  warningMB?: number;
  /** 严重阈值（MB），默认 300MB */
  criticalMB?: number;
  /** 持续增长检测窗口（秒），默认 30s */
  growthWindowSec?: number;
  /** 持续增长率（%/分钟），默认 10% */
  growthRatePercentPerMin?: number;
};
