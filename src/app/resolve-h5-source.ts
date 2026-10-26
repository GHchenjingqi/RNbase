/**
 * 启动期 H5 入口决策（规则 5/34）。纯函数，便于单测；不直接依赖 WebView 或网络。
 *
 * 三条路，按优先级：
 *  1. 远程站点（version.json 的 remoteUrl）：入口就是那个站点，不查本地激活版本、不回内置资源；
 *  2. 已激活的 H5 子包（OTA 热更新落地的产物，由原生 BaseH5 给）；
 *  3. 内置资源入口（APK assets / HAP rawfile / iOS bundle，由 resolve-h5-entry 按平台给）。
 *
 * 为什么第 2 条必须在第 3 条前面：只读内置 assets 的话，激活了新子包也永远加载旧包，
 * 整条 OTA 链路等于白跑（这条判断过去只活在一个从未被挂载的组件里，装机实测从未生效）。
 *
 * 三条都没有时返回 null（例如 iOS 开发者没把 h5/ 加进 Xcode folder reference），
 * 由组合根渲染「配置缺失」错误页 —— 它比一张通用兜底页更能指路。
 */
export type H5Source = { uri: string };

export interface EntryResolver {
  resolveEntry(): Promise<string>;
}

export type ResolveH5SourceInput = {
  /** H5 子包运行时（真机走原生 BaseH5，缺原生时由 createRealRuntime 降级）。 */
  runtime: EntryResolver;
  /** 远程站点地址（config 的 REMOTE_H5_URL），非空则一切本地分支不生效。 */
  remoteUrl?: string | null;
  /** 内置资源入口（config 之外的平台逻辑算出来的 URI），解析不出来时为 null。 */
  builtinEntry?: string | null;
};

export async function resolveH5Source(input: ResolveH5SourceInput): Promise<H5Source | null> {
  if (input.remoteUrl) {
    return { uri: input.remoteUrl };
  }
  const activated = await input.runtime.resolveEntry();
  if (activated && activated.length > 0) {
    return { uri: activated };
  }
  return input.builtinEntry ? { uri: input.builtinEntry } : null;
}
