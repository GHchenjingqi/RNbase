/**
 * base64 编解码单测（全仓库唯一实现）。
 *
 * 为什么值得单独一个文件对拍：这两条函数在安全链路上——签名校验要把整包编码过桥给原生，
 * SPKI 公钥和签名要解码。以前 src/updater 下有三份各写一点，一致性只存在于「碰巧没测到边界」。
 * 所以编码与 Node Buffer 对拍全量字节（0-255 每种余数长度都覆盖到），解码与 Buffer 反向对拍，
 * 再加 RFC 4648 的已知向量。
 */
import { base64ToBytes, bytesToBase64 } from '../../src/updater/base64';

function bytesOf(s: string): Uint8Array {
  return Uint8Array.from(s.split('').map(c => c.charCodeAt(0)));
}

describe('bytesToBase64', () => {
  test('已知向量：空串 / RFC 4648 用例', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(bytesToBase64(bytesOf('f'))).toBe('Zg==');
    expect(bytesToBase64(bytesOf('fo'))).toBe('Zm8=');
    expect(bytesToBase64(bytesOf('foo'))).toBe('Zm9v');
    expect(bytesToBase64(bytesOf('foobar'))).toBe('Zm9vYmFy');
  });

  test('每种余数长度（n%3=0/1/2）都与 Node Buffer 一致', () => {
    for (let n = 0; n < 12; n += 1) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) bytes[i] = (i * 37 + 11) % 256;
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  test('跨 0x8000 边界的大包仍然正确（签名要整包过桥，大包是常态）', () => {
    const bytes = new Uint8Array(0x8001);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('base64ToBytes', () => {
  test('不依赖 atob：jest/Hermes 环境没有全局 atob 也解得开', () => {
    const g = globalThis as unknown as { atob?: unknown };
    const hadAtob = 'atob' in g;
    const previous = g.atob;
    delete g.atob;
    try {
      expect(Array.from(base64ToBytes('Zm9vYmFy'))).toEqual([102, 111, 111, 98, 97, 114]);
    } finally {
      if (hadAtob) g.atob = previous;
    }
  });

  test('RFC 4648 已知向量（含 0/1/2 字节填充）', () => {
    expect(Array.from(base64ToBytes(''))).toEqual([]);
    expect(Array.from(base64ToBytes('Zg=='))).toEqual([102]);
    expect(Array.from(base64ToBytes('Zm8='))).toEqual([102, 111]);
    expect(Array.from(base64ToBytes('Zm9v'))).toEqual([102, 111, 111]);
  });

  test('与 bytesToBase64 往返：0-255 全字节 + 各长度', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    for (let n = 0; n <= 256; n += 1) {
      const slice = bytes.subarray(0, n);
      expect(Array.from(base64ToBytes(bytesToBase64(slice)))).toEqual(Array.from(slice));
    }
  });

  test('容忍换行与填充：PEM 每 64 字符一个换行，签名串尾部带 =', () => {
    const der = Uint8Array.from({ length: 91 }, (_, i) => i);
    const wrapped = bytesToBase64(der).replace(/(.{20})/g, '$1\n');
    expect(Array.from(base64ToBytes(`${wrapped}\n`))).toEqual(Array.from(der));
  });

  test('与 Node Buffer 解码对拍', () => {
    for (let n = 0; n < 10; n += 1) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) bytes[i] = (i * 89) % 256;
      const b64 = Buffer.from(bytes).toString('base64');
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(Buffer.from(b64, 'base64')));
    }
  });
});
