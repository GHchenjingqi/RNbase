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
import { NativeModules } from 'react-native';

import { bytesToBase64 } from './base64';
import type { SignatureVerifier } from './verifier';

/** 原生模块名：iOS 已实现（BaseH5.swift）；Android 落地时保持同名。 */
const NATIVE_MODULE_NAME = 'BaseH5';

type BaseH5Native = {
  verifyPackageSignature?: (
    base64Data: string,
    signature: string,
    publicKey: string,
  ) => Promise<{ valid?: boolean; error?: string }>;
};

/**
 * 大包防护阈值：签名数据需整包 base64 过桥（体积 ×1.33），超过阈值内存与耗时
 * 代价过高，抛明确错误而非静默失败（提示走分片/文件句柄的原生校验扩展）。
 */
export const MAX_BRIDGE_BYTES = 16 * 1024 * 1024;

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
    publicKey: string,
  ) => Promise<{ valid?: boolean; error?: string }>;

  return async (data, signature, publicKey) => {
    if (data.length > MAX_BRIDGE_BYTES) {
      throw new Error(
        `signature data ${data.length} bytes exceeds bridge limit ${MAX_BRIDGE_BYTES}; extend native verifier with file-path API`,
      );
    }
    const res = await verify(bytesToBase64(data), signature, publicKey);
    return Boolean(res && res.valid);
  };
}
