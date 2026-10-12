/**
 * 包安装器（Phase 7 / 规范 §7）。
 *
 * 流程：下载到 staging → 解压 → 文件完整性检查 → 标记为可激活。
 * 核心原则：绝不覆盖 current，安装失败不影响正在运行的版本。
 *
 * 接口驱动：FileSystem / Unzipper 可注入，便于单测与替换为真实实现。
 */
import type { H5Manifest } from './types';

export type FileSystem = {
  /** 写入 staging 目录下的文件 */
  writeStagingFile: (version: string, path: string, data: Uint8Array) => Promise<void>;
  /** 读取 staging 目录下的文件 */
  readStagingFile: (version: string, path: string) => Promise<Uint8Array>;
  /** 检查 staging 目录下文件是否存在 */
  existsStagingFile: (version: string, path: string) => Promise<boolean>;
  /** 列出 staging 目录下的所有文件 */
  listStagingFiles: (version: string) => Promise<string[]>;
  /** 清理 staging 目录 */
  clearStaging: (version: string) => Promise<void>;
  /** 将 staging 移动到 versions 目录（安装完成） */
  commitStaging: (version: string) => Promise<void>;
};

export type Unzipper = (data: Uint8Array) => Promise<Array<{ path: string; data: Uint8Array }>>;

export type InstallResult =
  | { ok: true; version: string; entryPath: string; fileCount: number }
  | {
      ok: false;
      reason: 'unzip_failed' | 'integrity_check_failed' | 'missing_entry' | 'commit_failed';
      details: string;
    };

export type InstallerOptions = {
  fileSystem: FileSystem;
  unzipper: Unzipper;
  /** 必须存在的文件列表（相对路径），默认只检查 entry */
  requiredFiles?: string[];
};

export class PackageInstaller {
  private readonly options: InstallerOptions;

  constructor(options: InstallerOptions) {
    this.options = options;
  }

  /**
   * 安装包到 staging 并验证完整性。
   * 成功后调用 commitStaging 将 staging 移动到 versions 目录。
   */
  async install(packageData: Uint8Array, manifest: H5Manifest): Promise<InstallResult> {
    const { fileSystem, unzipper } = this.options;
    const version = manifest.version;

    try {
      // 1. 清理旧的 staging
      await fileSystem.clearStaging(version);

      // 2. 解压
      let files: Array<{ path: string; data: Uint8Array }>;
      try {
        files = await unzipper(packageData);
      } catch (err) {
        return {
          ok: false,
          reason: 'unzip_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }

      if (files.length === 0) {
        return { ok: false, reason: 'unzip_failed', details: '压缩包为空' };
      }

      // 3. 写入 staging
      for (const file of files) {
        await fileSystem.writeStagingFile(version, file.path, file.data);
      }

      // 4. 文件完整性检查
      const requiredFiles = this.options.requiredFiles ?? [manifest.entry];
      for (const required of requiredFiles) {
        const exists = await fileSystem.existsStagingFile(version, required);
        if (!exists) {
          await fileSystem.clearStaging(version);
          return {
            ok: false,
            reason: required === manifest.entry ? 'missing_entry' : 'integrity_check_failed',
            details: `缺少必需文件: ${required}`,
          };
        }
      }

      // 5. 提交到 versions 目录
      try {
        await fileSystem.commitStaging(version);
      } catch (err) {
        await fileSystem.clearStaging(version);
        return {
          ok: false,
          reason: 'commit_failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }

      return {
        ok: true,
        version,
        entryPath: manifest.entry,
        fileCount: files.length,
      };
    } catch (err) {
      await this.options.fileSystem.clearStaging(version);
      return {
        ok: false,
        reason: 'integrity_check_failed',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** 创建 InMemory FileSystem（用于测试）。 */
export function createInMemoryFileSystem(): FileSystem & {
  getVersions: () => string[];
  getVersionFiles: (v: string) => Map<string, Uint8Array>;
} {
  const staging = new Map<string, Map<string, Uint8Array>>();
  const versions = new Map<string, Map<string, Uint8Array>>();

  const getStaging = (version: string) => {
    if (!staging.has(version)) staging.set(version, new Map());
    return staging.get(version)!;
  };

  return {
    async writeStagingFile(version, path, data) {
      getStaging(version).set(path, data);
    },
    async readStagingFile(version, path) {
      const data = getStaging(version).get(path);
      if (!data) throw new Error(`文件不存在: ${path}`);
      return data;
    },
    async existsStagingFile(version, path) {
      return getStaging(version).has(path);
    },
    async listStagingFiles(version) {
      return Array.from(getStaging(version).keys());
    },
    async clearStaging(version) {
      staging.delete(version);
    },
    async commitStaging(version) {
      const files = staging.get(version);
      if (!files) throw new Error('staging 不存在');
      versions.set(version, new Map(files));
      staging.delete(version);
    },
    getVersions() {
      return Array.from(versions.keys());
    },
    getVersionFiles(version) {
      return versions.get(version) ?? new Map();
    },
  };
}

/** 创建 Mock Unzipper（用于测试）。 */
export function createMockUnzipper(
  files: Array<{ path: string; data: Uint8Array }>,
  options?: { fail?: boolean },
): Unzipper {
  return async () => {
    if (options?.fail) throw new Error('Mock 解压失败');
    return files;
  };
}
