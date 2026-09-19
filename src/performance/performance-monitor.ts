/**
 * 性能监控器（Phase 14 / 规范 §61）。
 *
 * 职责：
 *  - 采集性能指标（冷启动、首屏、Bridge 耗时、下载、压缩、上传、内存、JS 长任务）
 *  - 管理性能基线
 *  - 性能告警（超过基线阈值）
 *  - 生成性能报告（统计、P50/P95/P99、告警）
 *
 * 优化原则：数据驱动，先测量再优化。
 */
import type {
  PerformanceAlert,
  PerformanceAlertLevel,
  PerformanceBaseline,
  PerformanceMetric,
  PerformanceMetricType,
  PerformanceReport,
} from './types';
import { PERF_DEFAULT_BASELINES, PERF_MAX_METRICS, PERF_MAX_ALERTS } from '../config';

let metricIdCounter = 0;
function nextMetricId(): string {
  metricIdCounter += 1;
  return `perf_${Date.now()}_${metricIdCounter}`;
}

let alertIdCounter = 0;
function nextAlertId(): string {
  alertIdCounter += 1;
  return `alert_${Date.now()}_${alertIdCounter}`;
}

export type PerformanceMonitorOptions = {
  /** 性能基线配置 */
  baselines?: PerformanceBaseline[];
  /** 最大指标记录数，默认 1000 */
  maxMetrics?: number;
  /** 最大告警记录数，默认 200 */
  maxAlerts?: number;
  /** 告警回调 */
  onAlert?: (alert: PerformanceAlert) => void;
  /** 指标完成回调 */
  onMetricComplete?: (metric: PerformanceMetric) => void;
};

/** 默认性能基线（兼容旧导出名，值来自全局配置 PERF_DEFAULT_BASELINES）。 */
export const DEFAULT_BASELINES = PERF_DEFAULT_BASELINES;

export class PerformanceMonitor {
  private readonly options: Required<
    Omit<PerformanceMonitorOptions, 'onAlert' | 'onMetricComplete'>
  > & {
    onAlert?: (alert: PerformanceAlert) => void;
    onMetricComplete?: (metric: PerformanceMetric) => void;
  };
  private metrics: PerformanceMetric[] = [];
  private alerts: PerformanceAlert[] = [];
  private activeMetrics: Map<string, PerformanceMetric> = new Map();
  private baselines: Map<string, PerformanceBaseline> = new Map();

  constructor(options?: PerformanceMonitorOptions) {
    this.options = {
      baselines: options?.baselines ?? DEFAULT_BASELINES,
      maxMetrics: options?.maxMetrics ?? PERF_MAX_METRICS,
      maxAlerts: options?.maxAlerts ?? PERF_MAX_ALERTS,
      onAlert: options?.onAlert,
      onMetricComplete: options?.onMetricComplete,
    };

    // 初始化基线
    for (const baseline of this.options.baselines) {
      this.baselines.set(`${baseline.type}:${baseline.name}`, baseline);
    }
  }

  /** 开始计时一个性能指标。 */
  start(type: PerformanceMetricType, name: string, data?: Record<string, unknown>): string {
    const metric: PerformanceMetric = {
      id: nextMetricId(),
      type,
      name,
      startTime: Date.now(),
      data,
    };
    this.activeMetrics.set(metric.id, metric);
    return metric.id;
  }

  /** 结束计时并记录指标。 */
  end(metricId: string, data?: Record<string, unknown>): PerformanceMetric | null {
    const metric = this.activeMetrics.get(metricId);
    if (!metric) return null;

    metric.endTime = Date.now();
    metric.durationMs = metric.endTime - metric.startTime;
    if (data) {
      metric.data = { ...metric.data, ...data };
    }

    this.activeMetrics.delete(metricId);
    this.recordMetric(metric);
    return metric;
  }

  /** 直接记录一个已完成的指标。 */
  record(
    type: PerformanceMetricType,
    name: string,
    durationMs: number,
    data?: Record<string, unknown>,
  ): PerformanceMetric {
    const metric: PerformanceMetric = {
      id: nextMetricId(),
      type,
      name,
      startTime: Date.now() - durationMs,
      endTime: Date.now(),
      durationMs,
      data,
    };
    this.recordMetric(metric);
    return metric;
  }

  /** 记录指标并检查告警。 */
  private recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.options.maxMetrics) {
      this.metrics.shift();
    }

    // 检查基线告警
    this.checkAlert(metric);

    this.options.onMetricComplete?.(metric);
  }

  /** 检查指标是否超过基线阈值。 */
  private checkAlert(metric: PerformanceMetric): void {
    if (!metric.durationMs) return;

    const baseline = this.baselines.get(`${metric.type}:${metric.name}`);
    if (!baseline || !baseline.maxDurationMs) return;

    if (metric.durationMs > baseline.maxDurationMs) {
      const level: PerformanceAlertLevel =
        metric.durationMs > baseline.maxDurationMs * 2 ? 'critical' : 'warning';

      const alert: PerformanceAlert = {
        id: nextAlertId(),
        level,
        type: metric.type,
        message: `${metric.name} 耗时 ${metric.durationMs}ms 超过阈值 ${baseline.maxDurationMs}ms`,
        metric,
        timestamp: Date.now(),
      };

      this.alerts.push(alert);
      if (this.alerts.length > this.options.maxAlerts) {
        this.alerts.shift();
      }

      this.options.onAlert?.(alert);
    }
  }

  /** 获取指标列表。 */
  getMetrics(type?: PerformanceMetricType, limit?: number): PerformanceMetric[] {
    let result = this.metrics;
    if (type) {
      result = result.filter(m => m.type === type);
    }
    if (limit) {
      result = result.slice(-limit);
    }
    return [...result];
  }

  /** 获取告警列表。 */
  getAlerts(level?: PerformanceAlertLevel, limit?: number): PerformanceAlert[] {
    let result = this.alerts;
    if (level) {
      result = result.filter(a => a.level === level);
    }
    if (limit) {
      result = result.slice(-limit);
    }
    return [...result].reverse();
  }

  /** 获取基线配置。 */
  getBaselines(): PerformanceBaseline[] {
    return [...this.baselines.values()];
  }

  /** 更新基线配置。 */
  updateBaseline(baseline: PerformanceBaseline): void {
    this.baselines.set(`${baseline.type}:${baseline.name}`, baseline);
  }

  /** 生成性能报告。 */
  generateReport(from?: number, to?: number): PerformanceReport {
    const endTime = to ?? Date.now();
    const startTime = from ?? endTime - 24 * 60 * 60 * 1000; // 默认 24 小时

    const filtered = this.metrics.filter(
      m => m.startTime >= startTime && (m.endTime ?? m.startTime) <= endTime,
    );

    // 按类型分组统计
    const groups = new Map<string, PerformanceMetric[]>();
    for (const metric of filtered) {
      const key = `${metric.type}:${metric.name}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(metric);
    }

    const metricsReport = Array.from(groups.entries()).map(([key, items]) => {
      const [type, name] = key.split(':');
      const durations = items
        .map(m => m.durationMs ?? 0)
        .filter(d => d > 0)
        .sort((a, b) => a - b);
      const count = durations.length;
      const avg = count > 0 ? durations.reduce((a, b) => a + b, 0) / count : undefined;
      const p50 = count > 0 ? durations[Math.floor(count * 0.5)] : undefined;
      const p95 = count > 0 ? durations[Math.floor(count * 0.95)] : undefined;
      const p99 = count > 0 ? durations[Math.floor(count * 0.99)] : undefined;
      const alertCount = this.alerts.filter(
        a => a.type === type && a.timestamp >= startTime && a.timestamp <= endTime,
      ).length;

      return {
        type: type as PerformanceMetricType,
        name,
        count,
        avgDurationMs: avg,
        minDurationMs: count > 0 ? durations[0] : undefined,
        maxDurationMs: count > 0 ? durations[count - 1] : undefined,
        p50DurationMs: p50,
        p95DurationMs: p95,
        p99DurationMs: p99,
        alerts: alertCount,
      };
    });

    const filteredAlerts = this.alerts.filter(
      a => a.timestamp >= startTime && a.timestamp <= endTime,
    );

    return {
      generatedAt: Date.now(),
      from: startTime,
      to: endTime,
      metrics: metricsReport,
      alerts: filteredAlerts,
      summary: {
        totalMetrics: filtered.length,
        totalAlerts: filteredAlerts.length,
        criticalAlerts: filteredAlerts.filter(a => a.level === 'critical').length,
        warningAlerts: filteredAlerts.filter(a => a.level === 'warning').length,
      },
    };
  }

  /** 清空所有指标和告警。 */
  clear(): void {
    this.metrics = [];
    this.alerts = [];
    this.activeMetrics.clear();
  }

  /** 销毁监控器。 */
  destroy(): void {
    this.clear();
    this.baselines.clear();
  }
}
