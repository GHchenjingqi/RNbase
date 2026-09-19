/**
 * 版本激活器（Phase 7 / 规范 §7）。
 *
 * 职责：在启动验证通过后，原子切换 current 指针指向新版本。
 * 核心原则：
 *  - 切换必须是原子操作，防止进程被杀留下半切换状态
 *  - 切换前备份 current，切换失败可回滚
 *  - 不在业务进行中热切换（规范 §38，由调用方保证时机）
 *
 * 接口驱动：CurrentPointer 可注入，便于单测与替换为真实文件系统实现。
 */

export type CurrentPointer = {
  /** 获取当前激活的版本 */
  getCurrent: () => Promise<string | null>;
  /** 原子设置当前激活的版本 */
  setCurrent: (version: string) => Promise<void>;
  /** 获取上一个版本（用于回滚） */
  getPrevious: () => Promise<string | null>;
  /** 检查版本是否已安装 */
  isInstalled: (version: string) => Promise<boolean>;
  /** 标记版本为已安装（安装成功后调用） */
  markInstalled: (version: string) => Promise<void>;
};

export type ActivateResult =
  | { ok: true; version: string; previousVersion: string | null }
  | {
      ok: false;
      reason: 'not_installed' | 'already_current' | 'activate_failed';
      details: string;
    };

export class VersionActivator {
  private readonly pointer: CurrentPointer;

  constructor(pointer: CurrentPointer) {
    this.pointer = pointer;
  }

  /**
   * 原子激活指定版本。
   * 流程：检查已安装 → 记录 previous → 原子设置 current → 验证切换成功
   */
  async activate(version: string): Promise<ActivateResult> {
    // 1. 检查是否已安装
    const installed = await this.pointer.isInstalled(version);
    if (!installed) {
      return {
        ok: false,
        reason: 'not_installed',
        details: `版本 ${version} 未安装`,
      };
    }

    // 2. 检查是否已是 current
    const current = await this.pointer.getCurrent();
    if (current === version) {
      return {
        ok: false,
        reason: 'already_current',
        details: `版本 ${version} 已是当前版本`,
      };
    }

    // 3. 记录 previous
    const previousVersion = current;

    try {
      // 4. 原子设置 current
      await this.pointer.setCurrent(version);

      // 5. 验证切换成功
      const newCurrent = await this.pointer.getCurrent();
      if (newCurrent !== version) {
        throw new Error(`切换验证失败：期望 ${version}，实际 ${newCurrent}`);
      }

      return { ok: true, version, previousVersion };
    } catch (err) {
      // 切换失败，尝试回滚到 previous
      if (previousVersion) {
        try {
          await this.pointer.setCurrent(previousVersion);
        } catch {
          // 回滚也失败，保留现状，由上层处理
        }
      }
      return {
        ok: false,
        reason: 'activate_failed',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** 创建 InMemory CurrentPointer（用于测试）。 */
export function createInMemoryPointer(
  installedVersions: string[] = [],
  initialCurrent: string | null = null,
): CurrentPointer & { getInstalled: () => string[] } {
  const installed = new Set(installedVersions);
  let current: string | null = initialCurrent;
  let previous: string | null = null;

  return {
    async getCurrent() {
      return current;
    },
    async setCurrent(version) {
      previous = current;
      current = version;
    },
    async getPrevious() {
      return previous;
    },
    async isInstalled(version) {
      return installed.has(version);
    },
    async markInstalled(version) {
      installed.add(version);
    },
    getInstalled() {
      return Array.from(installed);
    },
  };
}
