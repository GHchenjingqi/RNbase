/**
 * 原生签名校验适配器（P2 安全闭环的 RN 运行时实现）。
 *
 * 背景：defaultSignatureVerifier 依赖 Web Crypto subtle，RN/Hermes 运行时不可用。
 * 本适配器探测原生模块 BaseH5（iOS：platforms/ios/qux/BaseH5.swift）并包装为
 * SignatureVerifier；Android 侧同名模块落地后无需改动本文件（契约：base64 进、{valid} 出）。
 *
 * 桥接契约（与 BaseH5.swift 一致）：
 *   BaseH5.verifyPackageSignature(base64Data, signature, publicKeyPem)
 *     -> Promise<{ valid: boolean, error?: string }>
 *   输入非法 / 模块缺失时原生 reject 或方法不存在。
 *
 * 未探测到原生模块时 createNativeSignatureVerifier() 返回 null，
 * UpdateOrchestrator 会回退 defaultSignatureVerifier（dev/test 环境）或拒绝（required 策略）。
 */
/* eslint-disable no-bitwise -- base64 编码本质是 6bit 分组重组，位运算不可替代 */
import { NativeModules } from 'react-native';

import type { SignatureVerifier } from './verifier';

/** 原生模块名：iOS 已实现（BaseH5.swift）；Android 落地时保持同名。 */
const NATIVE_MODULE_NAME = 'BaseH5';

type BaseH5Native = {
  verifyPackageSignature?: (
    base64Data: string,
    signature: string,
    publicKey: string
  ) => Promise<{ valid?: boolean; error?: string }>;
};

/**
 * 大包防护阈值：签名数据需整包 base64 过桥（体积 ×1.33），超过阈值内存与耗时
 * 代价过高，抛明确错误而非静默失败（提示走分片/文件句柄的原生校验扩展）。
 */
export const MAX_BRIDGE_BYTES = 16 * 1024 * 1024;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Uint8Array → base64。手写实现（不依赖 Node Buffer / btoa polyfill 的存在性），
 * 分块拼接避免 String.fromCharCode 的调用栈参数上限。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    let bin = '';
    for (let j = 0; j < chunk.length; j += 1) {
      bin += String.fromCharCode(chunk[j]);
    }
    out += bin;
  }
  let encoded = '';
  for (let i = 0; i < out.length; i += 3) {
    const b0 = out.charCodeAt(i);
    const b1 = i + 1 < out.length ? out.charCodeAt(i + 1) : NaN;
    const b2 = i + 2 < out.length ? out.charCodeAt(i + 2) : NaN;
    encoded += BASE64_ALPHABET[b0 >> 2];
    encoded += BASE64_ALPHABET[((b0 & 0x03) << 4) | (Number.isNaN(b1) ? 0 : b1 >> 4)];
    encoded += Number.isNaN(b1)
      ? '='
      : BASE64_ALPHABET[((b1 & 0x0f) << 2) | (Number.isNaN(b2) ? 0 : b2 >> 6)];
    encoded += Number.isNaN(b2) ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return encoded;
}

/**
 * 探测并创建原生签名校验器。
 * 原生模块 / 方法缺失 → null（调用方回退 defaultSignatureVerifier 或拒绝）。
 */
export function createNativeSignatureVerifier(): SignatureVerifier | null {
  const mod = (NativeModules as Record<string, unknown>)[NATIVE_MODULE_NAME] as
    | BaseH5Native
    | undefined;
  if (!mod || typeof mod.verifyPackageSignature !== 'function') {
    return null;
  }
  const verify = mod.verifyPackageSignature.bind(mod) as (
    base64Data: string,
    signature: string,
    publicKey: string
  ) => Promise<{ valid?: boolean; error?: string }>;

  return async (data, signature, publicKey) => {
    if (data.length > MAX_BRIDGE_BYTES) {
      throw new Error(
        `signature data ${data.length} bytes exceeds bridge limit ${MAX_BRIDGE_BYTES}; extend native verifier with file-path API`
      );
    }
    const res = await verify(bytesToBase64(data), signature, publicKey);
    return Boolean(res && res.valid);
  };
}
