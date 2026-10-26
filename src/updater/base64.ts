/**
 * Uint8Array <-> Base64 编解码工具。
 *
 * 为什么自己写：Hermes/RN 里全局 btoa / atob 不保证存在（RN 核心也没带 polyfill），
 * 而这两条都是安全链路上的必经点——签名校验要整包编码，SPKI 公钥要解码。
 * 依赖存在与否来决定「能不能校验签名」，等于把安全闸门挂在运行环境的心情上。
 *
 * 全仓库唯一实现：src/updater 下曾有 3 处各写一份（本文件、native-signature-verifier、
 * verifier 的 atob 分支），行为还不完全一致（分块阈值、缺 atob 时抛错）。
 * 编码正确性由 __tests__/updater/base64.test.ts 与 Node Buffer 对拍。
 */
/* eslint-disable no-bitwise -- base64 本质是 6bit 分组重组，位运算不可替代 */
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

/**
 * Base64 -> Uint8Array。
 *
 * 先剔除非字母表字符再解码：PEM 每 64 字符一个换行、签名串尾部带 `=` 填充，
 * 这两处都是调用方已经知道的事实，在解码器里报错反而要把「去空白」的活儿派给每个调用方。
 * 丢弃填充后按 6bit 累加、满 8bit 出一个字节，末尾不足 8bit 的余数直接丢掉
 * （合法输入的余数恒为 0，非规范输入的尾部本就无意义）。
 */
export function base64ToBytes(b64: string): Uint8Array {
  const chars = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((chars.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < chars.length; i += 1) {
    acc = (acc << 6) | B64_CHARS.indexOf(chars[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (acc >> bits) & 0xff;
      written += 1;
    }
  }
  return written === out.length ? out : out.subarray(0, written);
}
