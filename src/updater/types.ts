/**
 * H5 版本管理类型与契约（规则 6/7/32/33）。
 *
 * 设计原则（规则 12）：优先稳定、可回滚、可观测，不为了架构漂亮过度抽象。
 * 所有具体 IO（下载 / 解压 / 哈希 / 文件系统）通过接口注入，便于单测。
 */
import type { H5Storage } from '../storage/types';

export type { H5Storage };

export type H5Manifest = {
  version: string;
  buildId: string;
  minAppVersion?: string;
  maxAppVersion?: string;
  bridgeVersion?: string;
  entry: string;
  packageUrl: string;
  sha256: string;
  size: number;
  publishedAt: string;
  forceUpdate?: boolean;
};

export type UpdateState =
  | 'IDLE'
  | 'CHECKING'
  | 'AVAILABLE'
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'INSTALLING'
  | 'READY_TO_ACTIVATE'
  | 'ACTIVATING'
  | 'SMOKE_TEST'
  | 'STABLE'
  | 'NO_UPDATE'
  | 'INCOMPATIBLE'
  | 'DOWNLOAD_FAILED'
  | 'VERIFY_FAILED'
  | 'INSTALL_FAILED'
  | 'BOOT_FAILED'
  | 'ROLLBACK';

export interface ManifestProvider {
  fetchManifest(): Promise<H5Manifest>;
}

export interface PackageDownloader {
  download(url: string): Promise<Uint8Array>;
}

export interface Verifier {
  sha256(data: Uint8Array): Promise<string>;
}

/** 灰度规则（规范 §30）。 */
export type RolloutRule = {
  /** 灰度百分比 0-100 */
  percentage?: number;
  /** 指定租户列表 */
  tenants?: string[];
  /** 指定用户列表 */
  users?: string[];
  /** 指定设备列表 */
  devices?: string[];
  /** 指定 appVersion 范围 */
  appVersionMin?: string;
  appVersionMax?: string;
  /** 指定平台 */
  platforms?: Array<'android' | 'ios' | 'web'>;
};
