/**
 * iOS H5 包安全模块（对应 src/updater/native-signature-verifier.ts）。
 *
 * RN 侧 H5 更新签名校验：JS 端 defaultSignatureVerifier 依赖 Web Crypto subtle，
 * RN/Hermes 运行时不可用，故由本模块用 Security.framework（SecKey）实现同一算法：
 *   RSASSA-PKCS1-v1_5 + SHA-256，签名对象为原始包数据（非预摘要），
 *   与 __tests__/updater/signature-verify.test.ts 的 Node WebCrypto 测试向量同源。
 *
 * 公钥格式：PEM（SPKI），与 version.json h5PublicKey / config H5_UPDATE_PUBLIC_KEY 一致；
 * 内部剥离 SPKI 的 ASN.1 头得到 PKCS#1 RSAPublicKey 供 SecKeyCreateWithData 使用。
 *
 * 注册方式：本文件与 ERPH5.m 一起加入 Xcode 的 App Target（见 platforms/ios/TODO.md #3）。
 */
import Foundation
import React
import Security

@objc(ERPH5)
class ERPH5: NSObject, RCTBridgeModule {
  static func moduleName() -> String! { "ERPH5" }
  static func requiresMainQueueSetup() -> Bool { false }

  /// 校验包签名。入参均为 base64 / PEM 文本（与 JS 适配器的桥接契约一致）。
  /// 返回 { valid: Bool, error: String? }；输入非法走 reject（JS 侧视为校验器不可用）。
  @objc(verifyPackageSignature:signature:publicKey:resolver:rejecter:)
  func verifyPackageSignature(
    _ base64Data: String,
    signature: String,
    publicKey: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let data = Data(base64Encoded: base64Data, options: [.ignoreUnknownCharacters]) else {
      reject("INVALID_DATA", "包数据 base64 非法", nil)
      return
    }
    guard let sig = Data(base64Encoded: signature, options: [.ignoreUnknownCharacters]) else {
      reject("INVALID_SIGNATURE", "签名字段 base64 非法", nil)
      return
    }
    guard let key = Self.secKey(fromSpkiPem: publicKey) else {
      reject("INVALID_PUBLIC_KEY", "公钥解析失败（需 PEM/SPKI RSA 公钥）", nil)
      return
    }
    var cfError: Unmanaged<CFError>?
    // rsaSignatureMessagePKCS1v15SHA256：对原始消息内部先做 SHA-256 再 PKCS1v15 签名验证，
    // 与 Web Crypto subtle.verify({ 'RSASSA-PKCS1-v1_5' }, ..., data) 语义一致。
    let ok = SecKeyVerify(key, .rsaSignatureMessagePKCS1v15SHA256, data as CFData, sig as CFData, &cfError)
    let errDesc = cfError?.takeRetainedValue().localizedDescription
    resolve(["valid": ok, "error": errDesc ?? ""])
  }

  // MARK: - 公钥解析

  /// PEM(SPKI) → SecKey。解析失败返回 nil（调用方 reject INVALID_PUBLIC_KEY）。
  static func secKey(fromSpkiPem pem: String) -> SecKey? {
    let body = pem
      .split(separator: "\n")
      .filter { !$0.contains("-----") }
      .joined()
    guard let der = Data(base64Encoded: body, options: [.ignoreUnknownCharacters]) else {
      return nil
    }
    // SecKeyCreateWithData 要求 PKCS#1 RSAPublicKey；输入是 SPKI 时剥离外层 ASN.1 头。
    // 走查结果的切片必然以 0x30（RSAPublicKey SEQUENCE）开头，此处只做防御性校验。
    let keyBytes = rsaPublicKeyBytes(fromSpki: der)
    guard let keyData = keyBytes, !keyData.isEmpty,
          keyData[keyData.startIndex] == 0x30 else {
      return nil
    }
    let attrs: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
      kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
    ]
    return SecKeyCreateWithData(keyData as CFData, attrs as CFDictionary, nil)
  }

  /// SPKI(DER) → PKCS#1 RSAPublicKey 字节（含 RSAPublicKey 自身的 SEQUENCE 头）。
  /// SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier,
  ///                                     subjectPublicKey BIT STRING }
  /// BIT STRING 内容即 RSAPublicKey ::= SEQUENCE { modulus, publicExponent }。
  static func rsaPublicKeyBytes(fromSpki der: Data) -> Data? {
    var bytes = [UInt8](der)
    var idx = 0

    // 读 DER 长度（短格式 / 长格式 ≤ 4 字节），成功后 idx 指向内容首字节。
    func readLength() -> Bool {
      guard idx < bytes.count else { return false }
      let first = bytes[idx]
      idx += 1
      guard first & 0x80 != 0 else { return true }  // 短格式，长度即首字节，内容随后
      let count = Int(first & 0x7F)
      guard count >= 1, count <= 4, idx + count <= bytes.count else { return false }
      idx += count
      return true
    }

    // 外层 SEQUENCE
    guard !bytes.isEmpty, bytes[0] == 0x30, readLength() else { return nil }
    // AlgorithmIdentifier SEQUENCE
    guard idx < bytes.count, bytes[idx] == 0x30, readLength() else { return nil }
    // subjectPublicKey BIT STRING
    guard idx < bytes.count, bytes[idx] == 0x03, readLength() else { return nil }
    // 跳过「未使用位数」字节（恒为 0x00）
    idx += 1
    // RSAPublicKey SEQUENCE 头
    guard idx < bytes.count, bytes[idx] == 0x30 else { return nil }
    return Data(bytes[idx...])
  }
}
