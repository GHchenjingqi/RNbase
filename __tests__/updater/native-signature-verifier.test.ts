/**
 * native-signature-verifier 单测：原生模块探测、SignatureVerifier 包装、
 * 大包防护阈值、base64 编码正确性（含已知向量）。
 */
import { NativeModules } from 'react-native';

import {
  createNativeSignatureVerifier,
  bytesToBase64,
  MAX_BRIDGE_BYTES,
} from '../../src/updater/native-signature-verifier';

type ERPH5Mock = {
  verifyPackageSignature: jest.Mock<
    Promise<{ valid?: boolean; error?: string }>,
    [string, string, string]
  >;
};

const native = NativeModules as Record<string, unknown>;

function mockErph5(): ERPH5Mock {
  const mock: ERPH5Mock = {
    verifyPackageSignature: jest.fn(async () => ({ valid: true })),
  };
  native.ERPH5 = mock;
  return mock;
}

afterEach(() => {
  delete native.ERPH5;
});

describe('createNativeSignatureVerifier', () => {
  test('原生模块缺失时返回 null（回退 defaultSignatureVerifier）', () => {
    expect(createNativeSignatureVerifier()).toBeNull();
  });

  test('模块存在但方法缺失时返回 null', () => {
    native.ERPH5 = {};
    expect(createNativeSignatureVerifier()).toBeNull();
  });

  test('探测成功：数据转 base64 过桥并透传 valid=true', async () => {
    const mock = mockErph5();
    const verifier = createNativeSignatureVerifier();
    expect(verifier).not.toBeNull();

    const ok = await verifier!(bytesOf('hello'), 'sig-b64', 'PEM');
    expect(ok).toBe(true);
    expect(mock.verifyPackageSignature).toHaveBeenCalledWith('aGVsbG8=', 'sig-b64', 'PEM');
  });

  test('原生返回 valid=false 时透传 false（校验失败语义）', async () => {
    const mock = mockErph5();
    mock.verifyPackageSignature.mockResolvedValueOnce({ valid: false, error: 'mismatch' });
    const verifier = createNativeSignatureVerifier();
    await expect(verifier!(new Uint8Array(1), 'bad-sig', 'PEM')).resolves.toBe(false);
  });

  test('原生 reject 时向上抛出（调用方按校验器不可用处理）', async () => {
    const mock = mockErph5();
    mock.verifyPackageSignature.mockRejectedValueOnce(new Error('INVALID_PUBLIC_KEY'));
    const verifier = createNativeSignatureVerifier();
    await expect(verifier!(new Uint8Array(1), 'sig', 'bad-pem')).rejects.toThrow(
      'INVALID_PUBLIC_KEY'
    );
  });

  test('超过桥接防护阈值时抛明确错误，不调用原生', async () => {
    const mock = mockErph5();
    const verifier = createNativeSignatureVerifier();
    const big = new Uint8Array(MAX_BRIDGE_BYTES + 1);
    await expect(verifier!(big, 'sig', 'PEM')).rejects.toThrow('exceeds bridge limit');
    expect(mock.verifyPackageSignature).not.toHaveBeenCalled();
  });
});

function bytesOf(s: string): Uint8Array {
  return Uint8Array.from(s.split('').map((c) => c.charCodeAt(0)));
}

describe('bytesToBase64', () => {
  test('已知向量：空串 / RFC 4648 用例', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(bytesToBase64(bytesOf('f'))).toBe('Zg==');
    expect(bytesToBase64(bytesOf('fo'))).toBe('Zm8=');
    expect(bytesToBase64(bytesOf('foo'))).toBe('Zm9v');
    expect(bytesToBase64(bytesOf('foobar'))).toBe('Zm9vYmFy');
  });

  test('跨块边界正确（超过 0x8000 分块阈值）', () => {
    // 0x8000 + 1 字节的确定性数据，与 Node Buffer 编码对拍
    const bytes = new Uint8Array(0x8001);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
