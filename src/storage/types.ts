/**
 * H5 本地存储抽象（规则 32：业务层不直接访问文件系统路径）。
 *
 * 从 updater 拆分到独立的 storage 模块，与 Skill 第 2 节推荐目录结构对齐。
 * 具体 IO（读写沙盒目录、解压、原子切换）由实现类注入，便于单测与替换。
 */
import type { H5Manifest } from '../updater/types';

export interface H5Storage {
  getCurrentVersion(): Promise<string | null>;
  listVersions(): Promise<string[]>;
  /** 将已校验的包写入 versions/<version>，并记录 manifest。 */
  install(version: string, packageData: Uint8Array, manifest: H5Manifest): Promise<void>;
  /** 原子切换 current -> version（规则 7/8）。 */
  activate(version: string): Promise<void>;
  /** 返回当前激活版本的入口（entry）路径/URI。 */
  getActiveEntry(): Promise<string | null>;
  /** 回滚到指定历史版本。 */
  rollback(version: string): Promise<void>;
  remove(version: string): Promise<void>;
}
