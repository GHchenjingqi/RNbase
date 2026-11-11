/**
 * iOS H5 版本管理 + 包安全原生模块（对齐上游基座 2026-11-11 的最新 iOS 实现，
 * 并保留本基座的包签名校验）。
 *
 * 对应 RN 侧：
 *   src/storage/native-h5-storage.ts —— getVersionsDir / listVersions / install /
 *     getManifest / getCurrentVersion / getPreviousVersion / activate / rollback /
 *     remove / getActiveEntry / clearAll
 *   src/updater/native-sha256.ts     —— sha256(base64) 返回小写 hex
 *   src/updater/native-signature-verifier.ts —— verifyPackageSignature(base64Data,
 *     signature, publicKeyPem) -> { valid }（RNbase 专属，SecKey RSASSA-PKCS1v15-SHA256）
 *
 * 落盘：<Documents>/h5-versions/<version>/ + current.json 指针（原子替换）。
 * zip 解压使用系统 Compression 框架，不引入三方库；路径穿越防护与 Android 一致。
 */
import Compression
import CryptoKit
import Foundation
import React
import Security

private enum BaseZipError: LocalizedError {
  case invalidArchive
  case unsupported(String)
  case inflateFailed(String)

  var errorDescription: String? {
    switch self {
    case .invalidArchive:
      return "不是有效的 zip 包"
    case .unsupported(let message):
      return message
    case .inflateFailed(let name):
      return "解压失败: \(name)"
    }
  }
}

private struct BaseZipEntry {
  let name: String
  let method: Int
  let compressedSize: Int
  let uncompressedSize: Int
  let localHeaderOffset: Int
  let encrypted: Bool
}

private enum BaseZipExtractor {
  static func unzip(_ data: Data, to targetDir: URL) throws -> String {
    let bytes = [UInt8](data)
    guard bytes.count > 22 else { throw BaseZipError.invalidArchive }

    func u16(_ offset: Int) -> Int {
      Int(bytes[offset]) | Int(bytes[offset + 1]) << 8
    }
    func u32(_ offset: Int) -> Int {
      Int(bytes[offset]) | Int(bytes[offset + 1]) << 8 | Int(bytes[offset + 2]) << 16
        | Int(bytes[offset + 3]) << 24
    }

    // 1. 从尾部找 End of Central Directory（注释最长 65535 字节）
    var eocd = -1
    var cursor = bytes.count - 22
    let lowerBound = max(0, bytes.count - 22 - 65535)
    while cursor >= lowerBound {
      if bytes[cursor] == 0x50, bytes[cursor + 1] == 0x4b,
        bytes[cursor + 2] == 0x05, bytes[cursor + 3] == 0x06
      {
        eocd = cursor
        break
      }
      cursor -= 1
    }
    guard eocd >= 0 else { throw BaseZipError.invalidArchive }

    let entryCount = u16(eocd + 10)
    let centralOffset = u32(eocd + 16)
    guard entryCount != 0xFFFF, centralOffset != 0xFFFFFFFF else {
      throw BaseZipError.unsupported("暂不支持 ZIP64 格式的子包")
    }
    guard centralOffset > 0, centralOffset < bytes.count else {
      throw BaseZipError.invalidArchive
    }

    // 2. 遍历中央目录
    var entries: [BaseZipEntry] = []
    var offset = centralOffset
    for _ in 0..<entryCount {
      guard offset + 46 <= bytes.count,
        bytes[offset] == 0x50, bytes[offset + 1] == 0x4b,
        bytes[offset + 2] == 0x01, bytes[offset + 3] == 0x02
      else {
        throw BaseZipError.invalidArchive
      }
      let flags = u16(offset + 8)
      let method = u16(offset + 10)
      let compressedSize = u32(offset + 20)
      let uncompressedSize = u32(offset + 24)
      let nameLength = u16(offset + 28)
      let extraLength = u16(offset + 30)
      let commentLength = u16(offset + 32)
      let localOffset = u32(offset + 42)
      guard offset + 46 + nameLength <= bytes.count else { throw BaseZipError.invalidArchive }

      let nameData = data.subdata(in: (offset + 46)..<(offset + 46 + nameLength))
      let name = String(data: nameData, encoding: .utf8)
        ?? String(bytes: nameData, encoding: .isoLatin1)
        ?? ""
      entries.append(
        BaseZipEntry(
          name: name,
          method: method,
          compressedSize: compressedSize,
          uncompressedSize: uncompressedSize,
          localHeaderOffset: localOffset,
          encrypted: (flags & 0x1) != 0
        )
      )
      offset += 46 + nameLength + extraLength + commentLength
    }

    // 3. 逐条落盘（含路径穿越防护）
    let targetCanonical = targetDir.standardizedFileURL.path
    var entryPath = "index.html"
    var fileCount = 0

    for entry in entries {
      let name = entry.name
      guard !name.isEmpty, !name.hasSuffix("/") else { continue }
      guard !name.contains(".."), !name.hasPrefix("/"), !name.contains("\\"),
        !entry.encrypted
      else { continue }
      guard entry.localHeaderOffset + 30 <= bytes.count else { throw BaseZipError.invalidArchive }

      let localNameLength = u16(entry.localHeaderOffset + 26)
      let localExtraLength = u16(entry.localHeaderOffset + 28)
      let dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength
      guard dataStart >= 0, dataStart + entry.compressedSize <= bytes.count else {
        throw BaseZipError.invalidArchive
      }

      let destination = targetDir.appendingPathComponent(name)
      let canonical = destination.standardizedFileURL.path
      guard canonical == targetCanonical || canonical.hasPrefix(targetCanonical + "/") else {
        continue
      }
      try FileManager.default.createDirectory(
        at: destination.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )

      let fileData: Data
      switch entry.method {
      case 0:
        fileData = data.subdata(in: dataStart..<(dataStart + entry.compressedSize))
      case 8:
        fileData = try inflate(
          bytes,
          offset: dataStart,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          name: name
        )
      default:
        throw BaseZipError.unsupported("不支持的压缩方式(\(entry.method)): \(name)")
      }
      try fileData.write(to: destination, options: .atomic)
      fileCount += 1

      if (name as NSString).lastPathComponent.lowercased() == "index.html" {
        entryPath = name
      }
    }

    guard fileCount > 0 else { throw BaseZipError.invalidArchive }
    return entryPath
  }

  private static func inflate(
    _ bytes: [UInt8],
    offset: Int,
    compressedSize: Int,
    uncompressedSize: Int,
    name: String
  ) throws -> Data {
    guard uncompressedSize > 0, compressedSize > 0 else { return Data() }
    var output = [UInt8](repeating: 0, count: uncompressedSize)
    let written = output.withUnsafeMutableBufferPointer { destination -> Int in
      bytes.withUnsafeBufferPointer { source -> Int in
        guard let src = source.baseAddress, let dst = destination.baseAddress else { return 0 }
        return compression_decode_buffer(
          dst,
          uncompressedSize,
          src.advanced(by: offset),
          compressedSize,
          nil,
          COMPRESSION_ZLIB
        )
      }
    }
    guard written > 0 else {
      throw BaseZipError.inflateFailed(name)
    }
    return Data(output.prefix(written))
  }
}

@objc(BaseH5)
class BaseH5: NSObject {

  private var rootDir: URL {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return documents.appendingPathComponent("h5-versions", isDirectory: true)
  }

  private var currentFile: URL {
    rootDir.appendingPathComponent("current.json")
  }

  private func versionDir(_ version: String) -> URL {
    rootDir.appendingPathComponent(version, isDirectory: true)
  }

  private func readCurrent() -> [String: Any]? {
    guard FileManager.default.fileExists(atPath: currentFile.path) else { return nil }
    guard let data = try? Data(contentsOf: currentFile),
      let object = try? JSONSerialization.jsonObject(with: data),
      let json = object as? [String: Any]
    else {
      return nil
    }
    return json
  }

  private func writeCurrentAtomically(_ json: [String: Any]) -> Bool {
    let dir = rootDir
    guard
      (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil,
      let data = try? JSONSerialization.data(withJSONObject: json, options: [])
    else {
      return false
    }
    let tmp = dir.appendingPathComponent("current.json.tmp")
    do {
      try data.write(to: tmp, options: .atomic)
      if FileManager.default.fileExists(atPath: currentFile.path) {
        _ = try FileManager.default.replaceItemAt(currentFile, withItemAt: tmp)
      } else {
        try FileManager.default.moveItem(at: tmp, to: currentFile)
      }
      return true
    } catch {
      try? FileManager.default.removeItem(at: tmp)
      return false
    }
  }

  private func hexString(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  private func countFiles(in dir: URL) -> Int {
    guard let enumerator = FileManager.default.enumerator(
      at: dir,
      includingPropertiesForKeys: [.isRegularFileKey],
      options: [.skipsHiddenFiles]
    ) else { return 0 }
    var count = 0
    for case let url as URL in enumerator {
      let values = try? url.resourceValues(forKeys: [.isRegularFileKey])
      if values?.isRegularFile == true, url.lastPathComponent != "manifest.json" {
        count += 1
      }
    }
    return count
  }

  // MARK: - 目录与列表

  @objc(getVersionsDir:rejecter:)
  func getVersionsDir(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let dir = rootDir
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    resolve(dir.path)
  }

  @objc(listVersions:rejecter:)
  func listVersions(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let dir = rootDir
      guard FileManager.default.fileExists(atPath: dir.path) else {
        resolve([String]())
        return
      }
      let urls = try FileManager.default.contentsOfDirectory(
        at: dir,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles]
      )
      let versions = urls.filter { url in
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
          && url.lastPathComponent != "current.json"
      }.map { $0.lastPathComponent }.sorted()
      resolve(versions)
    } catch {
      reject("LIST_FAILED", error.localizedDescription, error)
    }
  }

  // MARK: - 安装 / 读取 manifest

  @objc(install:base64Zip:manifestJson:resolver:rejecter:)
  func install(
    _ version: String,
    base64Zip: String,
    manifestJson: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      reject("INVALID_PARAMS", "version 为空", nil)
      return
    }
    guard let zipData = Data(base64Encoded: base64Zip, options: .ignoreUnknownCharacters) else {
      reject("UNZIP_FAILED", "子包 Base64 解码失败", nil)
      return
    }
    let dir = versionDir(version)
    let fileManager = FileManager.default
    do {
      try fileManager.createDirectory(at: rootDir, withIntermediateDirectories: true)
      if fileManager.fileExists(atPath: dir.path) {
        try fileManager.removeItem(at: dir)
      }
      try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)

      let entry: String
      do {
        entry = try BaseZipExtractor.unzip(zipData, to: dir)
      } catch {
        try? fileManager.removeItem(at: dir)
        reject("UNZIP_FAILED", "解压失败: \(error.localizedDescription)", error)
        return
      }

      try manifestJson.write(
        to: dir.appendingPathComponent("manifest.json"),
        atomically: true,
        encoding: .utf8
      )

      resolve([
        "version": version,
        "entry": entry,
        "fileCount": countFiles(in: dir),
      ])
    } catch {
      reject("INSTALL_FAILED", error.localizedDescription, error)
    }
  }

  @objc(getManifest:resolver:rejecter:)
  func getManifest(
    _ version: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let file = versionDir(version).appendingPathComponent("manifest.json")
    guard FileManager.default.fileExists(atPath: file.path) else {
      reject("NOT_FOUND", "version manifest not found: \(version)", nil)
      return
    }
    do {
      let text = try String(contentsOf: file, encoding: .utf8)
      resolve(text)
    } catch {
      reject("READ_FAILED", error.localizedDescription, error)
    }
  }

  // MARK: - 指针读写

  @objc(getCurrentVersion:rejecter:)
  func getCurrentVersion(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if let version = readCurrent()?["current"] as? String {
      resolve(version)
    } else {
      resolve(nil)
    }
  }

  @objc(getPreviousVersion:rejecter:)
  func getPreviousVersion(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if let version = readCurrent()?["previous"] as? String {
      resolve(version)
    } else {
      resolve(nil)
    }
  }

  @objc(activate:resolver:rejecter:)
  func activate(
    _ version: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard FileManager.default.fileExists(atPath: versionDir(version).path) else {
      reject("NOT_INSTALLED", "版本未安装: \(version)", nil)
      return
    }
    let current = readCurrent()
    let old = current?["current"] as? String
    var next: [String: Any] = ["current": version]
    if let old = old, old != version {
      next["previous"] = old
    } else if let previous = current?["previous"] as? String {
      next["previous"] = previous
    } else {
      next["previous"] = NSNull()
    }
    guard writeCurrentAtomically(next) else {
      reject("ACTIVATE_FAILED", "切换 current 指针失败", nil)
      return
    }
    resolve(true)
  }

  @objc(rollback:resolver:rejecter:)
  func rollback(
    _ version: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    activate(version, resolver: resolve, rejecter: reject)
  }

  @objc(remove:resolver:rejecter:)
  func remove(
    _ version: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let dir = versionDir(version)
      var deleted = false
      if FileManager.default.fileExists(atPath: dir.path) {
        try FileManager.default.removeItem(at: dir)
        deleted = true
      }
      if var json = readCurrent(), (json["current"] as? String) == version {
        json["current"] = NSNull()
        _ = writeCurrentAtomically(json)
      }
      resolve(deleted)
    } catch {
      reject("REMOVE_FAILED", error.localizedDescription, error)
    }
  }

  // MARK: - 入口

  @objc(getActiveEntry:rejecter:)
  func getActiveEntry(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let current = readCurrent()?["current"] as? String, !current.isEmpty else {
      resolve(nil)
      return
    }
    let manifest = versionDir(current).appendingPathComponent("manifest.json")
    guard FileManager.default.fileExists(atPath: manifest.path),
      let data = try? Data(contentsOf: manifest),
      let object = try? JSONSerialization.jsonObject(with: data),
      let json = object as? [String: Any]
    else {
      resolve(nil)
      return
    }
    let entry = (json["entry"] as? String) ?? "index.html"
    let entryURL = versionDir(current).appendingPathComponent(entry)
    guard FileManager.default.fileExists(atPath: entryURL.path) else {
      resolve(nil)
      return
    }
    resolve(entryURL.absoluteString)
  }

  /// iOS 专属：内置（随 App 打包）h5/index.html 的 file:// 地址。
  /// 安卓有 APK assets 兜底，iOS 没有对应概念，用打包进 bundle 的 h5 目录兜底。
  /// （"Copy H5 Assets" 构建阶段把根目录 h5/ 拷进 .app；JS 侧常用入口仍是
  /// BaseCapabilities.H5BundleBasePath 常量，这里是同一入口的异步版本。）
  @objc(getBundledEntry:rejecter:)
  func getBundledEntry(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "h5")
    else {
      resolve(nil)
      return
    }
    resolve(url.absoluteString)
  }

  // MARK: - 校验与清理

  @objc(sha256:resolver:rejecter:)
  func sha256(
    _ base64Data: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let data = Data(base64Encoded: base64Data, options: .ignoreUnknownCharacters) else {
      reject("HASH_FAILED", "Base64 解码失败", nil)
      return
    }
    let digest = SHA256.hash(data: data)
    resolve(hexString(Data(digest)))
  }

  @objc(clearAll:rejecter:)
  func clearAll(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let dir = rootDir
      if FileManager.default.fileExists(atPath: dir.path) {
        try FileManager.default.removeItem(at: dir)
      }
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      resolve(true)
    } catch {
      reject("CLEAR_FAILED", error.localizedDescription, error)
    }
  }

  // MARK: - 包签名校验（RNbase 专属，对应 src/updater/native-signature-verifier.ts）

  /**
   * 校验包签名。入参均为 base64 / PEM 文本（与 JS 适配器的桥接契约一致）。
   * 返回 { valid: Bool, error: String? }；输入非法走 reject（JS 侧视为校验器不可用）。
   *
   * 算法：RSASSA-PKCS1-v1_5 + SHA-256，签名对象为原始包数据（非预摘要），
   * 与 __tests__/updater/signature-verify.test.ts 的 Node WebCrypto 测试向量同源。
   * 公钥格式：PEM（SPKI），与 version.json h5PublicKey / config H5_UPDATE_PUBLIC_KEY 一致。
   */
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
    guard let key = BaseH5.secKey(fromSpkiPem: publicKey) else {
      reject("INVALID_PUBLIC_KEY", "公钥解析失败（需 PEM/SPKI RSA 公钥）", nil)
      return
    }
    var cfError: Unmanaged<CFError>?
    // rsaSignatureMessagePKCS1v15SHA256：对原始消息内部先做 SHA-256 再 PKCS1v15 签名验证，
    // 与 Web Crypto subtle.verify({ 'RSASSA-PKCS1-v1_5' }, ..., data) 语义一致；
    // 用 SecKeyVerifySignature，不是 SecKeyVerify（iOS 26 SDK 里搜不到后者）。
    let ok = SecKeyVerifySignature(
      key,
      .rsaSignatureMessagePKCS1v15SHA256,
      data as CFData,
      sig as CFData,
      &cfError
    )
    // 不解析 CFError 文案：JS 侧只用 valid（native-signature-verifier.ts 里
    // `Boolean(res && res.valid)`）；iOS 26 SDK 里 CFError 不能直接 as NSError。
    resolve([
      "valid": ok,
      "error": ok ? "" : "SecKeyVerifySignature 返回 false（cfError=\(cfError != nil)）",
    ])
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
      keyData[keyData.startIndex] == 0x30
    else {
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
    let bytes = [UInt8](der)
    var idx = 0

    /// 读一个 TLV 头：校验 tag、消费 L 字段，返回内容长度；
    /// 成功后 idx 指向内容首字节（要跳过内容本体由调用方 idx += len）。
    /// 注意 L 必须在 tag 之后读——早先把 tag 当长度读，任何合法 SPKI 都会解析失败。
    func readHeader(_ tag: UInt8) -> Int? {
      guard idx < bytes.count, bytes[idx] == tag else { return nil }
      idx += 1
      guard idx < bytes.count else { return nil }
      let first = bytes[idx]
      idx += 1
      if first & 0x80 == 0 { return Int(first) }
      let count = Int(first & 0x7F)
      guard count >= 1, count <= 4, idx + count <= bytes.count else { return nil }
      var length = 0
      for offset in 0..<count {
        length = (length << 8) | Int(bytes[idx + offset])
      }
      idx += count
      return length
    }

    // 外层 SEQUENCE（长度不消费内容，AlgorithmIdentifier 的头紧随其后）
    guard readHeader(0x30) != nil else { return nil }
    // AlgorithmIdentifier：拿到本体长度后整段跳过，否则停在 OID 上找 BIT STRING 必然落空
    guard let algorithmLength = readHeader(0x30), idx + algorithmLength <= bytes.count else {
      return nil
    }
    idx += algorithmLength
    // subjectPublicKey BIT STRING：内容首字节是「未使用位数」（公钥恒为 0x00）
    guard readHeader(0x03) != nil else { return nil }
    idx += 1
    // RSAPublicKey SEQUENCE 头
    guard idx < bytes.count, bytes[idx] == 0x30 else { return nil }
    return Data(bytes[idx...])
  }
}
