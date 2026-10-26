/**
 * native-signature-verifier 单测：原生模块探测、SignatureVerifier 包装、大包防护阈值。
 * base64 编解码本身已收敛到 src/updater/base64.ts，由 __tests__/updater/base64.test.ts 覆盖。
 */
import { NativeModules } from 'react-native';

import {
  createNativeSignatureVerifier,
  MAX_BRIDGE_BYTES,
} from '../../src/updater/native-signature-verifier';

type BaseH5Mock = {
  verifyPackageSignature: jest.Mock<
    Promise<{ valid?: boolean; error?: string }>,
    [string, string, string]
  >;
};

const native = NativeModules as Record<string, unknown>;

/** 编码正确性不在本文件的职责内（见 __tests__/updater/base64.test.ts），这里只要一个能过桥的字节串。 */
function bytesOf(s: string): Uint8Array {
  return Uint8Array.from(s.split('').map(c => c.charCodeAt(0)));
}

function mockBaseH5(): BaseH5Mock {
  const mock: BaseH5Mock = {
    // 桩只关心返回值、不读参数，所以按声明的三元签名收一次类型（jest.fn 推出来的空参数
    // 签名和 BaseH5Mock 不重叠，直接赋值会被 TS 拒）。
    verifyPackageSignature: jest.fn(async () => ({
      valid: true,
    })) as unknown as BaseH5Mock['verifyPackageSignature'],
  };
  native.BaseH5 = mock;
  return mock;
}

afterEach(() => {
  delete native.BaseH5;
});

describe('createNativeSignatureVerifier', () => {
  test('原生模块缺失时返回 null（回退 defaultSignatureVerifier）', () => {
    expect(createNativeSignatureVerifier()).toBeNull();
  });

  test('模块存在但方法缺失时返回 null', () => {
    native.BaseH5 = {};
    expect(createNativeSignatureVerifier()).toBeNull();
  });

  test('探测成功：数据转 base64 过桥并透传 valid=true', async () => {
    const mock = mockBaseH5();
    const verifier = createNativeSignatureVerifier();
    expect(verifier).not.toBeNull();

    const ok = await verifier!(bytesOf('hello'), 'sig-b64', 'PEM');
    expect(ok).toBe(true);
    expect(mock.verifyPackageSignature).toHaveBeenCalledWith('aGVsbG8=', 'sig-b64', 'PEM');
  });

  test('原生返回 valid=false 时透传 false（校验失败语义）', async () => {
    const mock = mockBaseH5();
    mock.verifyPackageSignature.mockResolvedValueOnce({ valid: false, error: 'mismatch' });
    const verifier = createNativeSignatureVerifier();
    await expect(verifier!(new Uint8Array(1), 'bad-sig', 'PEM')).resolves.toBe(false);
  });

  test('原生 reject 时向上抛出（调用方按校验器不可用处理）', async () => {
    const mock = mockBaseH5();
    mock.verifyPackageSignature.mockRejectedValueOnce(new Error('INVALID_PUBLIC_KEY'));
    const verifier = createNativeSignatureVerifier();
    await expect(verifier!(new Uint8Array(1), 'sig', 'bad-pem')).rejects.toThrow(
      'INVALID_PUBLIC_KEY',
    );
  });

  test('超过桥接防护阈值时抛明确错误，不调用原生', async () => {
    const mock = mockBaseH5();
    const verifier = createNativeSignatureVerifier();
    const big = new Uint8Array(MAX_BRIDGE_BYTES + 1);
    await expect(verifier!(big, 'sig', 'PEM')).rejects.toThrow('exceeds bridge limit');
    expect(mock.verifyPackageSignature).not.toHaveBeenCalled();
  });
});
