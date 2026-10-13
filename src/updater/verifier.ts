/**
 * 包校验器（Phase 7 / 规范 §55、§58；P2 安全闭环强化）。
 *
 * 校验项：
 *  - SHA-256 哈希校验（必须）
 *  - 包大小校验（必须）
 *  - 数字签名校验（规范 §55）：策略驱动
 *      - 'off'：不校验（仅观察）
 *      - 'optional'：manifest 带签名且提供公钥/校验器时校验，缺失则跳过
 *      - 'required'：必须带签名且校验通过，否则拒绝（防篡改 / 防中间人替换）
 *
 * 接口驱动：Sha256Hasher / SignatureVerifier 可注入，便于单测与替换为原生实现。
 * 生产环境 RN/Hermes 无 Web Crypto subtle，需注入原生签名校验器（见 defaultSignatureVerifier 说明）。
 */

export type Sha256Hasher = (data: Uint8Array) => Promise<string>;

export type SignatureVerifier = (
  data: Uint8Array,
  signature: string,
  publicKey: string
) => Promise<boolean>;

/** 签名校验策略（由基座是否配置公钥决定）。 */
export type SignaturePolicy = 'off' | 'optional' | 'required';

export type VerifyOptions = {
  /** 期望的 SHA-256 哈希（来自 manifest） */
  expectedSha256: string;
  /** 期望的包大小（字节，来自 manifest） */
  expectedSize: number;
  /** 可选签名（来自 manifest.signature，base64） */
  signature?: string;
  /** 可选公钥（用于签名校验，PEM/SPKI） */
  publicKey?: string;
  /** SHA-256 实现，默认用 Web Crypto */
  hasher?: Sha256Hasher;
  /** 签名校验实现（RN 环境需注入原生实现） */
  signatureVerifier?: SignatureVerifier;
  /** 签名校验策略，默认 'optional'（向后兼容） */
  signaturePolicy?: SignaturePolicy;
  /** 大小容差（字节），默认 0（严格相等） */
  sizeTolerance?: number;
};

export type VerifyResult =
  | { ok: true; sha256: string; size: number }
  | {
      ok: false;
      reason:
        | 'sha256_mismatch'
        | 'size_mismatch'
        | 'signature_invalid'
        | 'signature_missing'
        | 'signature_verifier_unavailable'
        | 'missing_hasher';
      details: string;
    };

/**
 * 校验下载的包。
 * 流程：大小校验 → SHA-256 校验 → 签名校验（按策略）
 */
export async function verifyPackage(
  data: Uint8Array,
  options: VerifyOptions
): Promise<VerifyResult> {
  // 1. 大小校验
  const sizeTolerance = options.sizeTolerance ?? 0;
  if (Math.abs(data.length - options.expectedSize) > sizeTolerance) {
    return {
      ok: false,
      reason: 'size_mismatch',
      details: `期望 ${options.expectedSize} 字节，实际 ${data.length} 字节`,
    };
  }

  // 2. SHA-256 校验
  const hasher = options.hasher ?? defaultSha256Hasher;
  if (!hasher) {
    return {
      ok: false,
      reason: 'missing_hasher',
      details: '未提供 SHA-256 实现',
    };
  }
  const actualSha256 = await hasher(data);
  if (actualSha256 !== options.expectedSha256) {
    return {
      ok: false,
      reason: 'sha256_mismatch',
      details: `期望 ${options.expectedSha256}，实际 ${actualSha256}`,
    };
  }

  // 3. 签名校验（按策略）
  const policy = options.signaturePolicy ?? 'optional';
  if (policy === 'off') {
    return { ok: true, sha256: actualSha256, size: data.length };
  }

  if (policy === 'required') {
    if (!options.signature) {
      return {
        ok: false,
        reason: 'signature_missing',
        details: '签名策略为 required，但 manifest 未携带签名',
      };
    }
    if (!options.publicKey || !options.signatureVerifier) {
      return {
        ok: false,
        reason: 'signature_verifier_unavailable',
        details:
          '签名策略为 required，但未配置公钥或签名校验器（检查 H5_UPDATE_PUBLIC_KEY 与原生校验器注册）',
      };
    }
    const valid = await options.signatureVerifier(data, options.signature, options.publicKey);
    if (!valid) {
      return { ok: false, reason: 'signature_invalid', details: '数字签名校验失败' };
    }
  } else if (
    policy === 'optional' &&
    options.signature &&
    options.publicKey &&
    options.signatureVerifier
  ) {
    // optional 且仅当 manifest 实际携带签名时才校验，否则放行（灰度观察期）
    const valid = await options.signatureVerifier(data, options.signature, options.publicKey);
    if (!valid) {
      return { ok: false, reason: 'signature_invalid', details: '数字签名校验失败' };
    }
  }

  return { ok: true, sha256: actualSha256, size: data.length };
}

/** 默认 SHA-256 实现（Web Crypto API，RN 环境需 polyfill）。 */
const defaultSha256Hasher: Sha256Hasher | null = (() => {
  const g = globalThis as unknown as {
    crypto?: {
      subtle?: {
        digest: (algo: string, data: Uint8Array) => Promise<ArrayBuffer>;
      };
    };
  };
  if (g.crypto?.subtle) {
    return async (data) => {
      const hashBuffer = await g.crypto!.subtle!.digest('SHA-256', data);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };
  }
  return null;
})();

/** 创建 Mock 校验器（用于测试，直接返回预设结果）。 */
export function createMockHasher(expectedHash: string): Sha256Hasher {
  return async () => expectedHash;
}

/** 创建总是失败的 Mock 校验器（用于测试故障注入）。 */
export function createFailingHasher(): Sha256Hasher {
  return async () => 'wrong-hash-value';
}

/** base64 → Uint8Array（环境内置 atob 优先）。 */
function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as unknown as { atob?: (s: string) => string };
  if (g.atob) {
    const bin = g.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  throw new Error('base64 解码需要 atob（运行环境未提供）');
}

/** PEM(SPKI) → DER 字节。 */
function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  return base64ToBytes(b64);
}

/** Web Crypto subtle 最小接口（避免引入 any / 依赖 DOM 类型）。 */
type SubtleCryptoLike = {
  importKey: (
    format: string,
    keyData: ArrayBuffer,
    algorithm: { name: string; hash?: string },
    extractable: boolean,
    keyUsages: string[]
  ) => Promise<unknown>;
  verify: (
    algorithm: string,
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array
  ) => Promise<boolean>;
};

/**
 * 默认签名校验器（RSASSA-PKCS1-v1_5 / SHA-256，公钥为 SPKI PEM）。
 *
 * 仅在运行环境提供 Web Crypto `crypto.subtle`（浏览器 / Node / 部分 RN polyfill）时可用；
 * RN/Hermes 原生环境通常为 null —— 此时应在 UpdateOrchestrator 注入原生签名校验器
 * （如 BaseH5.verifyPackageSignature），否则 required 策略会报 signature_verifier_unavailable。
 */
export const defaultSignatureVerifier: SignatureVerifier | null = (() => {
  const subtle = (
    globalThis as unknown as {
      crypto?: { subtle?: SubtleCryptoLike };
    }
  ).crypto?.subtle;
  if (!subtle) {
    return null;
  }
  return async (data: Uint8Array, signature: string, publicKey: string): Promise<boolean> => {
    try {
      const key = await subtle.importKey(
        'spki',
        pemToDer(publicKey).buffer as ArrayBuffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      return await subtle.verify('RSASSA-PKCS1-v1_5', key, base64ToBytes(signature), data);
    } catch {
      return false;
    }
  };
})();

/** 测试用：可预设结果的签名校验器。 */
export function createMockSignatureVerifier(returns: boolean): SignatureVerifier {
  return async () => returns;
}
