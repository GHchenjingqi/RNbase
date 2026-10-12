/**
 * H5 ?????? 33??????????????????????
 *
 * WebView ??????????????? H5VersionManager ???
 */
import type { H5Storage } from '../storage/types';
import type { H5VersionManager } from './h5-version-manager';

export class H5Runtime {
  private readonly storage: H5Storage;
  private readonly versionManager: H5VersionManager;

  constructor(storage: H5Storage, versionManager: H5VersionManager) {
    this.storage = storage;
    this.versionManager = versionManager;
  }

  /** 解析 H5 入口 URL（规则 5）；无已激活版本时返回空串，由上层决定 HTML 兜底 */
  async resolveEntry(): Promise<string> {
    const entry = await this.storage.getActiveEntry();
    return entry ?? '';
  }

  getCurrentVersion(): Promise<string | null> {
    return this.storage.getCurrentVersion();
  }

  /** H5 ????????? 9?? */
  markReady(): Promise<void> {
    return this.versionManager.markReady();
  }

  /** H5 握手失败（规则 8 冒烟失败 -> 回滚） */
  markFailed(): Promise<void> {
    return this.versionManager.markFailed();
  }

  /** 检查是否有可用更新（透传 versionManager）。 */
  checkForUpdate() {
    return this.versionManager.checkForUpdate();
  }

  /** 执行更新：下载 -> 校验 -> 安装 -> 激活（透传 versionManager）。 */
  update() {
    return this.versionManager.update();
  }

  /** 当前更新状态（透传 versionManager）。 */
  getStatus() {
    return this.versionManager.getStatus();
  }

  rollback(version: string): Promise<void> {
    return this.storage.rollback(version);
  }
}
