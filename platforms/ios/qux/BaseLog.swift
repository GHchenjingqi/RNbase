/**
 * iOS 设备日志原生模块（对齐上游基座 2026-11-11 的最新 iOS 实现，
 * 模块名用本基座的 Base 前缀）。
 *
 * 对应 RN 侧 src/diagnostics/device-log-store.ts 的 NativeModules.BaseLog：
 *   write(level, message) / getLogDir() / listLogs() / readLog(name) / clearLogs()
 *
 * 落盘规则与 Android 一致：<Documents>/logs/device-YYYY-MM-DD.log，
 * 行格式 [yyyy-MM-dd HH:mm:ss.SSS] [LEVEL] message。
 *
 * 桥接：RCT_EXTERN_MODULE 声明在 BaseBridge.m。
 */
import Foundation
import React

@objc(BaseLog)
class BaseLog: NSObject {

  private let lock = NSLock()

  private var logsDir: URL {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return documents.appendingPathComponent("logs", isDirectory: true)
  }

  private static func dateString(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  private static func timestamp(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
    return formatter.string(from: date)
  }

  private func isLogFile(_ url: URL) -> Bool {
    guard url.isFileURL else { return false }
    let name = url.lastPathComponent
    return name.hasPrefix("device-") && name.hasSuffix(".log")
  }

  /// 追加写一条日志；失败只忽略（不影响业务），与 Android 的 Log.w 语义一致。
  @objc(write:message:)
  func write(_ level: String, message: String) {
    let now = Date()
    let dir = logsDir
    guard
      (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil
    else {
      return
    }
    let file = dir.appendingPathComponent("device-\(BaseLog.dateString(now)).log")
    let line = "[\(BaseLog.timestamp(now))] [\(level)] \(message)\n"
    guard let data = line.data(using: .utf8) else { return }

    lock.lock()
    defer { lock.unlock() }
    if !FileManager.default.fileExists(atPath: file.path) {
      FileManager.default.createFile(atPath: file.path, contents: nil)
    }
    guard let handle = try? FileHandle(forWritingTo: file) else { return }
    defer { try? handle.close() }
    do {
      try handle.seekToEnd()
      try handle.write(contentsOf: data)
    } catch {
      // 忽略写日志失败
    }
  }

  @objc(getLogDir:rejecter:)
  func getLogDir(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let dir = logsDir
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    resolve(dir.path)
  }

  @objc(listLogs:rejecter:)
  func listLogs(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let dir = logsDir
      guard FileManager.default.fileExists(atPath: dir.path) else {
        resolve([Any]())
        return
      }
      let urls = try FileManager.default.contentsOfDirectory(
        at: dir,
        includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
        options: [.skipsHiddenFiles]
      )
      let files = urls.filter { isLogFile($0) }.sorted { lhs, rhs in
        let left =
          (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
          ?? .distantPast
        let right =
          (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
          ?? .distantPast
        return left > right
      }
      let list: [[String: Any]] = files.map { url in
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        let name = url.lastPathComponent
        return [
          "name": name,
          "date": name.replacingOccurrences(of: "device-", with: "")
            .replacingOccurrences(of: ".log", with: ""),
          "size": values?.fileSize ?? 0,
          "path": url.path,
        ]
      }
      resolve(list)
    } catch {
      reject("LIST_FAILED", error.localizedDescription, error)
    }
  }

  @objc(readLog:resolver:rejecter:)
  func readLog(
    _ name: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // 只允许读取本目录下的 device-*.log，避免路径穿越
    guard
      name.hasPrefix("device-"), name.hasSuffix(".log"),
      !name.contains("/"), !name.contains("..")
    else {
      reject("FILE_NOT_FOUND", "log file not found: \(name)", nil)
      return
    }
    let file = logsDir.appendingPathComponent(name)
    guard FileManager.default.fileExists(atPath: file.path) else {
      reject("FILE_NOT_FOUND", "log file not found: \(name)", nil)
      return
    }
    do {
      let text = try String(contentsOf: file, encoding: .utf8)
      resolve(text)
    } catch {
      reject("READ_FAILED", error.localizedDescription, error)
    }
  }

  @objc(clearLogs:rejecter:)
  func clearLogs(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    var cleared = 0
    do {
      let dir = logsDir
      if FileManager.default.fileExists(atPath: dir.path) {
        let urls = try FileManager.default.contentsOfDirectory(
          at: dir,
          includingPropertiesForKeys: nil,
          options: [.skipsHiddenFiles]
        )
        for url in urls where isLogFile(url) {
          try FileManager.default.removeItem(at: url)
          cleared += 1
        }
      }
      resolve(["cleared": cleared])
    } catch {
      reject("CLEAR_FAILED", error.localizedDescription, error)
    }
  }
}
