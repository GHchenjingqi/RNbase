/**
 * TLS 证书锁定（SSL Pinning，P2 安全闭环，JS 策略层）。
 *
 * 真正的锁定在原生信任管理器实施：
 *  - Android：OkHttp/CertificatePinner（network-security-config 或代码注入）
 *  - iOS：URLSession 的 `URLSessionDelegate URLSession:didReceiveChallenge:` 校验证书 SPKI
 *  - 鸿蒙：@ohos.net.http 的证书校验扩展 / 自定义 SSLSocketFactory
 *
 * 本文件只提供「pin 校验纯逻辑 + 配置」，供原生层在握手回调里调用，
 * 也便于单测与 CI 静态校验 pin 配置是否过期。pin 值为证书 SPKI 的 SHA-256（base64）。
 */
import { TRUSTED_CERT_PINS } from '../config';

/**
 * 校验握手呈现的证书链 SPKI 指纹是否命中任一可信 pin。
 *
 * @param trustedPins 可信 pin 列表（config.TRUSTED_CERT_PINS，base64 SPKI-SHA256）
 * @param presentedHashes 本次握手证书链各证书的 SPKI SHA-256（base64）
 * @returns 是否通过锁定。trustedPins 为空（观察模式）一律返回 true，不误拦。
 */
export function validatePinning(trustedPins: string[], presentedHashes: string[]): boolean {
  // 未配置 pin = 观察模式：不强制锁定，正常放行
  if (trustedPins.length === 0) {
    return true;
  }
  return presentedHashes.some(h => trustedPins.includes(h));
}

/** 单个 leaf 指纹是否命中 pin（便捷封装）。 */
export function pinMatches(trustedPins: string[], leafHash: string): boolean {
  return validatePinning(trustedPins, [leafHash]);
}

/** 对外暴露当前基座配置的 pin（供原生层读取）。 */
export function getConfiguredPins(): string[] {
  return TRUSTED_CERT_PINS.slice();
}
