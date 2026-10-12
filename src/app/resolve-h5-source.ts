/**
 * 启动期 H5 入口决策（规则 5/34）：远程模式直接用车主 URL，否则优先已验证的本地版本，
 * 再否则使用内置兜底 H5。
 *
 * 纯函数，便于单测；不直接依赖 WebView 或网络。
 */
export type H5Source = { uri: string } | { html: string };

export interface EntryResolver {
  resolveEntry(): Promise<string>;
}

export async function resolveH5Source(
  runtime: EntryResolver,
  fallbackHtml: string,
  remoteUrl?: string | null,
): Promise<H5Source> {
  // 「基座 + URL」模式：不查本地激活版本、不回退兜底页，WebView 就是那个站点。
  if (remoteUrl) {
    return { uri: remoteUrl };
  }
  const entry = await runtime.resolveEntry();
  if (entry && entry.length > 0) {
    return { uri: entry };
  }
  return { html: fallbackHtml };
}
