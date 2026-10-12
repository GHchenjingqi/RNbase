/**
 * RN 真实 HTTP 下载器（Phase 7 / 规范 §37）。
 *
 * 基于 RN 全局 fetch：arrayBuffer -> Uint8Array。
 * 与 PackageDownloader（重试/进度/网络策略）配合使用。
 */
import type { HttpDownloader } from './downloader';

export const nativeHttpDownloader: HttpDownloader = async (url, onProgress) => {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(`网络请求失败: ${url}`);
  }
  if (!res.ok) {
    throw new Error(`下载失败: ${url} -> HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const data = new Uint8Array(buf);
  onProgress?.(data.length, data.length);
  return data;
};
