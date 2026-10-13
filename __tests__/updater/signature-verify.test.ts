/**
 * P2-1：H5 包签名强制校验单元测试。
 *
 * 使用 Node WebCrypto 真实生成 RSA 密钥对并签名，验证 defaultSignatureVerifier 端到端；
 * 同时覆盖 required 策略的各类拒绝分支与 UpdateOrchestrator 接线。
 */
import { webcrypto } from 'crypto';
import {
  verifyPackage,
  defaultSignatureVerifier,
  createMockHasher,
  createMockSignatureVerifier,
} from '../../src/updater/verifier';
import { UpdateOrchestrator } from '../../src/updater/update-orchestrator';
import { createMockManifestClient } from '../../src/updater/manifest-client';
import { createMockDownloader } from '../../src/updater/downloader';
import { createInMemoryFileSystem, createMockUnzipper } from '../../src/updater/installer';
import { createInMemoryPointer } from '../../src/updater/activator';
import type { H5Manifest } from '../../src/updater/types';
import { H5_UPDATE_PUBLIC_KEY, SIGNATURE_POLICY } from '../../src/config';

const subtle = webcrypto.subtle;

function abToBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa 全局可用（Node 16+ / 浏览器）
  return btoa(bin);
}

function toPem(derB64: string, label: string): string {
  return `-----BEGIN ${label}-----\n${derB64}\n-----END ${label}-----`;
}

async function makeKeyAndSignature(data: Uint8Array): Promise<{ pubPem: string; sigB64: string }> {
  const kp = await subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const pubDer = await subtle.exportKey('spki', kp.publicKey);
  const pubPem = toPem(abToBase64(pubDer), 'PUBLIC KEY');
  const sigBuf = await subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, data);
  return { pubPem, sigB64: abToBase64(sigBuf) };
}

describe('P2-1 verifier 签名校验', () => {
  const data = new TextEncoder().encode('h5-package-bytes');
  const hasher = createMockHasher('deadbeef');

  test('defaultSignatureVerifier 在 Node 环境可用', () => {
    expect(defaultSignatureVerifier).not.toBeNull();
  });

  test('required 策略 + 合法签名 → 通过', async () => {
    const { pubPem, sigB64 } = await makeKeyAndSignature(data);
    const res = await verifyPackage(data, {
      expectedSha256: 'deadbeef',
      expectedSize: data.length,
      hasher,
      signature: sigB64,
      publicKey: pubPem,
      signatureVerifier: defaultSignatureVerifier ?? undefined,
      signaturePolicy: 'required',
    });
    expect(res.ok).toBe(true);
  });

  test('required 策略 + 篡改数据 → signature_invalid', async () => {
    const { pubPem, sigB64 } = await makeKeyAndSignature(data);
    const tampered = new TextEncoder().encode('h5-package-bytes-TAMPERED');
    const res = await verifyPackage(tampered, {
      expectedSha256: 'deadbeef',
      expectedSize: tampered.length,
      hasher,
      signature: sigB64,
      publicKey: pubPem,
      signatureVerifier: defaultSignatureVerifier ?? undefined,
      signaturePolicy: 'required',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_invalid');
  });

  test('required 策略 + 缺失签名 → signature_missing', async () => {
    const { pubPem } = await makeKeyAndSignature(data);
    const res = await verifyPackage(data, {
      expectedSha256: 'deadbeef',
      expectedSize: data.length,
      hasher,
      publicKey: pubPem,
      signatureVerifier: defaultSignatureVerifier ?? undefined,
      signaturePolicy: 'required',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_missing');
  });

  test('required 策略 + 无校验器 → signature_verifier_unavailable', async () => {
    const { pubPem, sigB64 } = await makeKeyAndSignature(data);
    const res = await verifyPackage(data, {
      expectedSha256: 'deadbeef',
      expectedSize: data.length,
      hasher,
      signature: sigB64,
      publicKey: pubPem,
      signaturePolicy: 'required',
      // 故意不传 signatureVerifier，模拟 RN 原生未注册校验器的场景
      signatureVerifier: undefined,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_verifier_unavailable');
  });

  test('optional 策略 + 无签名 → 放行（灰度观察期）', async () => {
    const res = await verifyPackage(data, {
      expectedSha256: 'deadbeef',
      expectedSize: data.length,
      hasher,
      signaturePolicy: 'optional',
    });
    expect(res.ok).toBe(true);
  });

  test('optional 策略 + 签名校验失败 → signature_invalid', async () => {
    const res = await verifyPackage(data, {
      expectedSha256: 'deadbeef',
      expectedSize: data.length,
      hasher,
      signature: 'bogus',
      publicKey: 'bogus',
      signatureVerifier: createMockSignatureVerifier(false),
      signaturePolicy: 'optional',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_invalid');
  });
});

describe('P2-1 UpdateOrchestrator 签名接线', () => {
  const data = new TextEncoder().encode('package-bytes');
  const manifest: H5Manifest = {
    version: '2.0.0',
    buildId: 'b2',
    entry: 'index.html',
    packageUrl: 'https://cdn/manifest/2.0.0.zip',
    sha256: 'hash-ok',
    size: data.length,
    publishedAt: '2026-01-01T00:00:00Z',
    signature: 'sig-placeholder',
  };

  async function buildOrchestrator(
    signatureVerifier: Parameters<typeof verifyPackage>[1]['signatureVerifier']
  ) {
    return new UpdateOrchestrator({
      manifestClient: createMockManifestClient(manifest),
      httpDownloader: createMockDownloader(data),
      hasher: createMockHasher('hash-ok'),
      fileSystem: createInMemoryFileSystem(),
      unzipper: createMockUnzipper([{ path: manifest.entry, data: new Uint8Array([1]) }]),
      currentPointer: createInMemoryPointer(),
      context: {
        currentH5Version: '1.0.0',
        appVersion: '1.0.0',
        bridgeVersion: '1.0.1',
        platform: 'android',
      },
      signatureVerifier,
      signaturePublicKey: 'dummy-public-key',
    });
  }

  test('manifest 带签名但校验器返回 false → 更新被拒', async () => {
    const orch = await buildOrchestrator(createMockSignatureVerifier(false));
    const check = await orch.check(true);
    expect(check.available).toBe(true);
    const res = await orch.update();
    expect(res.success).toBe(false);
    if (!res.success) expect(res.reason).toBe('signature_invalid');
  });

  test('manifest 带签名且校验器返回 true → 更新通过', async () => {
    const orch = await buildOrchestrator(createMockSignatureVerifier(true));
    const check = await orch.check(true);
    expect(check.available).toBe(true);
    const res = await orch.update();
    expect(res.success).toBe(true);
  });
});

describe('P2-1 配置派生', () => {
  test('未配置公钥时策略为 optional（默认灰度观察期）', () => {
    // 当前 version.json 无 h5PublicKey（CI/构建期未注入），策略应为 optional
    expect(H5_UPDATE_PUBLIC_KEY).toBeNull();
    expect(SIGNATURE_POLICY).toBe('optional');
  });
});
