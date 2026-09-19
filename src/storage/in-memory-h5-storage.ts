/**
 * 内存版 H5Storage（用于单测与无文件系统环境的兜底）。
 *
 * 真实 App 应提供基于 react-native-fs / 沙盒目录的实现，
 * 但必须保持相同的接口（规则 32）。
 */
import type { H5Storage } from './types';
import type { H5Manifest } from '../updater/types';

type VersionRecord = {
  manifest: H5Manifest;
  data: Uint8Array;
};

export class InMemoryH5Storage implements H5Storage {
  private current: string | null = null;
  private readonly versions = new Map<string, VersionRecord>();

  async getCurrentVersion(): Promise<string | null> {
    return this.current;
  }

  async listVersions(): Promise<string[]> {
    return Array.from(this.versions.keys());
  }

  async install(version: string, packageData: Uint8Array, manifest: H5Manifest): Promise<void> {
    this.versions.set(version, { manifest, data: packageData });
  }

  async activate(version: string): Promise<void> {
    if (!this.versions.has(version)) {
      throw new Error(`版本不存在: ${version}`);
    }
    this.current = version;
  }

  async getActiveEntry(): Promise<string | null> {
    if (!this.current) {
      return null;
    }
    return this.versions.get(this.current)?.manifest.entry ?? null;
  }

  async rollback(version: string): Promise<void> {
    await this.activate(version);
  }

  async remove(version: string): Promise<void> {
    this.versions.delete(version);
    if (this.current === version) {
      this.current = null;
    }
  }
}
