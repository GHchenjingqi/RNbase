/**
 * 日志脱敏层（Phase 13 / 规范 §27）。
 *
 * 禁止记录：access_token、refresh_token、身份证号、手机号、密码、敏感业务数据。
 * 允许记录：appVersion、bridgeVersion、h5Version、platform、requestId、
 *           module、action、errorCode、networkType、duration。
 *
 * 脱敏策略：
 *  - 敏感 key 的值直接替换为 ***
 *  - 字符串值中的手机号/身份证号自动掩码
 *  - 长令牌（>=16 位）自动掩码
 *  - URL 中的 query 参数 token/password 自动移除
 */

const SENSITIVE_KEYS = new Set([
  'access_token',
  'refresh_token',
  'token',
  'authorization',
  'password',
  'passwd',
  'pwd',
  'secret',
  'api_key',
  'apikey',
  'idcard',
  'id_card',
  'idCard',
  'id_number',
  'phone',
  'mobile',
  'phonenumber',
  'phone_number',
  'email',
  'address',
  'credit_card',
  'creditcard',
  'card_number',
  'cv',
  'cvv',
  'session',
  'sessionid',
  'session_id',
  'cookie',
  'cookies',
]);

const MASK = '***';

/** 掩码手机号（138****1234）。 */
function maskPhone(value: string): string {
  if (/^1[3-9]\d{9}$/.test(value)) {
    return value.slice(0, 3) + '****' + value.slice(7);
  }
  return value;
}

/** 掩码身份证号（110101********1234）。 */
function maskIdCard(value: string): string {
  if (/^\d{17}[\dXx]$/.test(value)) {
    return value.slice(0, 6) + '********' + value.slice(14);
  }
  return value;
}

/** 掩码邮箱（a***@example.com）。 */
function maskEmail(value: string): string {
  const match = value.match(/^(.{1,2})(.*)@(.+)$/);
  if (match) {
    return match[1] + '***@' + match[3];
  }
  return value;
}

/** 掩码长令牌（>=16 位且非纯数字短串）。 */
function maskLongToken(value: string): string {
  if (value.length >= 16 && !/^\d+$/.test(value)) {
    return MASK;
  }
  return value;
}

/** 掩码 URL 中的敏感 query 参数。 */
function maskUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    const params = new URLSearchParams(url.search);
    const keysToDelete: string[] = [];
    params.forEach((_val, key) => {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => params.set(key, MASK));
    url.search = params.toString();
    return url.toString();
  } catch {
    return value;
  }
}

/** 对字符串值进行脱敏。 */
export function maskStringValue(value: string): string {
  if (!value || typeof value !== 'string') return value;
  let result = value;
  let masked = false;

  // 手机号
  const phoneMasked = maskPhone(result);
  if (phoneMasked !== result) {
    result = phoneMasked;
    masked = true;
  }

  // 身份证号
  if (!masked) {
    const idMasked = maskIdCard(result);
    if (idMasked !== result) {
      result = idMasked;
      masked = true;
    }
  }

  // 邮箱
  if (!masked) {
    const emailMasked = maskEmail(result);
    if (emailMasked !== result) {
      result = emailMasked;
      masked = true;
    }
  }

  // URL
  if (!masked) {
    const urlMasked = maskUrl(result);
    if (urlMasked !== result) {
      result = urlMasked;
      masked = true;
    }
  }

  // 长令牌（仅在未被其他掩码处理时执行）
  if (!masked) {
    result = maskLongToken(result);
  }

  return result;
}

/** 递归脱敏任意值。 */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskStringValue(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = MASK;
      } else {
        out[key] = redact(val);
      }
    }
    return out;
  }
  return value;
}

/** 检查 key 是否为敏感 key。 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/** LogEntry 中允许记录、不脱敏的字段（规范 §27）。 */
const ALLOWED_LOG_FIELDS = new Set([
  'id',
  'timestamp',
  'category',
  'level',
  'event',
  'appVersion',
  'bridgeVersion',
  'h5Version',
  'platform',
  'requestId',
  'module',
  'action',
  'errorCode',
  'networkType',
  'durationMs',
]);

/** 脱敏日志条目（确保所有字段都经过脱敏，允许字段跳过）。 */
export function redactLogEntry<T extends Record<string, unknown>>(entry: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(entry)) {
    if (ALLOWED_LOG_FIELDS.has(key)) {
      out[key] = val; // 允许字段直接保留
    } else {
      out[key] = redact(val);
    }
  }
  return out as T;
}
