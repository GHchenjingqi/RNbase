/**
 * 基于原生 ERPH5 模块的真实 H5Storage（规则 32）。
 *
 * 落盘位置：<filesDir>/h5-versions/（App 私有目录，无需额外权限）。
 *  - current.json：current 指针（原子切换，含 previous）
 *  - <version>/：子包解压后的文件 + manifest.json
 *
 * 原生模块缺失时（测试/浏览器环境）方法抛错，由 createRealRuntime 降级兜底。
 */
import { NativeModules } from 'react-native';
import type { H5Storage } from './types';
import type { H5Manifest } from '../updater/types';
import { bytesToBase64 } from '../updater/base64';

const ERPH5 = NativeModules.ERPH5;

function requireERPH5(): unknown {
  if (!ERPH5) {
    throw new Error('ERPH5 原生模块未注册');
  }
  return ERPH5;
}

export class NativeH5Storage implements H5Storage {
  async getCurrentVersion(): Promise<string | null> {
    const v = await (
      requireERPH5() as { getCurrentVersion(): Promise<string | null> }
    ).getCurrentVersion();
    return v ?? null;
  }

  async listVersions(): Promise<string[]> {
    const arr = await (requireERPH5() as { listVersions(): Promise<string[]> }).listVersions();
    return Array.isArray(arr) ? Array.from(arr) : [];
  }

  async install(version: string, packageData: Uint8Array, manifest: H5Manifest): Promise<void> {
    await (
      requireERPH5() as {
        install(version: string, base64Zip: string, manifestJson: string): Promise<void>;
      }
    ).install(version, bytesToBase64(packageData), JSON.stringify(manifest));
  }

  async activate(version: string): Promise<void> {
    await (requireERPH5() as { activate(version: string): Promise<void> }).activate(version);
  }

  async getActiveEntry(): Promise<string | null> {
    const entry = await (
      requireERPH5() as { getActiveEntry(): Promise<string | null> }
    ).getActiveEntry();
    return entry ?? null;
  }

  async rollback(version: string): Promise<void> {
    await (requireERPH5() as { rollback(version: string): Promise<void> }).rollback(version);
  }

  async remove(version: string): Promise<void> {
    await (requireERPH5() as { remove(version: string): Promise<void> }).remove(version);
  }
}
