/**
 * 包校验器（Phase 7 / 规范 §55、§58）。
 *
 * 校验项：
 *  - SHA-256 哈希校验（必须）
 *  - 包大小校验（必须）
 *  - 可选数字签名校验（规范 §55，生产环境建议启用）
 *
 * 接口驱动：Sha256Hasher / SignatureVerifier 可注入，便于单测与替换为原生实现。
 */

export type Sha256Hasher = (data: Uint8Array) => Promise<string>;

export type SignatureVerifier = (
  data: Uint8Array,
  signature: string,
  publicKey: string,
) => Promise<boolean>;

export type VerifyOptions = {
  /** 期望的 SHA-256 哈希（来自 manifest） */
  expectedSha256: string;
  /** 期望的包大小（字节，来自 manifest） */
  expectedSize: number;
  /** 可选签名（来自 manifest.signature） */
  signature?: string;
  /** 可选公钥（用于签名校验） */
  publicKey?: string;
  /** SHA-256 实现，默认用 Web Crypto */
  hasher?: Sha256Hasher;
  /** 签名校验实现 */
  signatureVerifier?: SignatureVerifier;
  /** 大小容差（字节），默认 0（严格相等） */
  sizeTolerance?: number;
};

export type VerifyResult =
  | { ok: true; sha256: string; size: number }
  | {
      ok: false;
      reason: 'sha256_mismatch' | 'size_mismatch' | 'signature_invalid' | 'missing_hasher';
      details: string;
    };

/**
 * 校验下载的包。
 * 流程：大小校验 → SHA-256 校验 → 可选签名校验
 */
export async function verifyPackage(
  data: Uint8Array,
  options: VerifyOptions,
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

  // 3. 可选签名校验
  if (options.signature && options.publicKey && options.signatureVerifier) {
    const valid = await options.signatureVerifier(data, options.signature, options.publicKey);
    if (!valid) {
      return {
        ok: false,
        reason: 'signature_invalid',
        details: '数字签名校验失败',
      };
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
    return async data => {
      const hashBuffer = await g.crypto!.subtle!.digest('SHA-256', data);
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
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
