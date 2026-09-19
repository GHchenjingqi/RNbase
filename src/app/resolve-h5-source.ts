/**
 * 启动期 H5 入口决策（规则 5/34）：优先已验证的本地版本，否则使用内置兜底 H5。
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
): Promise<H5Source> {
  const entry = await runtime.resolveEntry();
  if (entry && entry.length > 0) {
    return { uri: entry };
  }
  return { html: fallbackHtml };
}
