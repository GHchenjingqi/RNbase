/**
 * 结构化日志与脱敏（规则 27）。
 *
 * 禁止打印 access_token / refresh_token / 身份证号 / 手机号 / 密码 / 敏感业务数据；
 * 仅记录 appVersion / bridgeVersion / h5Version / platform / requestId /
 * module / action / errorCode / networkType / duration 等可观测字段。
 */
export type AppEvent = {
  event: string;
  requestId?: string;
  module?: string;
  action?: string;
  errorCode?: string;
  appVersion?: string;
  bridgeVersion?: string;
  h5Version?: string;
  platform?: string;
  networkType?: string;
  durationMs?: number;
  message?: string;
};

const SENSITIVE_KEYS = new Set([
  'access_token',
  'refresh_token',
  'token',
  'authorization',
  'password',
  'passwd',
  'idcard',
  'id_card',
  'idCard',
  'phone',
  'mobile',
  'phonenumber',
]);

const MASK = '***';

function maskValue(value: string): string {
  // 手机号
  if (/^1[3-9]\d{9}$/.test(value)) {
    return value.slice(0, 3) + '****' + value.slice(7);
  }
  // 身份证号
  if (/^\d{17}[\dXx]$/.test(value)) {
    return value.slice(0, 6) + '**********' + value.slice(16);
  }
  // 长令牌（>=16 位且非纯数字短串）
  if (value.length >= 16) {
    return MASK;
  }
  return value;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskValue(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? MASK : redact(val);
    }
    return out;
  }
  return value;
}

export type LogSink = (line: string) => void;

export function createLogger(sink: LogSink = console.log) {
  return {
    log(event: AppEvent): void {
      const safe = redact(event) as AppEvent;
      sink(`[erp] ${JSON.stringify(safe)}`);
    },
    redact,
  };
}

export const logger = createLogger();
