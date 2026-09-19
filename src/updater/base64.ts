/**
 * Uint8Array -> Base64 编码工具。
 *
 * 手写实现，避免依赖全局 btoa（Hermes/RN 环境下不可靠），
 * 按 3 字节分组，纯字符串拼接，大数据量下也不会爆栈。
 */
/* eslint-disable no-bitwise */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += B64_CHARS[b2 & 0x3f];
  }
  // 剩余 0-2 字节
  if (i < n) {
    const b0 = bytes[i];
    out += B64_CHARS[b0 >> 2];
    if (i + 1 < n) {
      const b1 = bytes[i + 1];
      out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
      out += B64_CHARS[(b1 & 0x0f) << 2];
      out += '=';
    } else {
      out += B64_CHARS[(b0 & 0x03) << 4];
      out += '==';
    }
  }
  return out;
}
