/**
 * H5 文件读取闸门（file.readAsBase64）。
 *
 * 存在的理由：原生侧 readFileAsBase64 直接把 H5 给的 uri 交给 ContentResolver / fs.open，
 * 于是任何子应用页面都能读到宿主 App 自己的私有文件——session token 就写在
 * shared_prefs（安卓）/ preferences（鸿蒙）里，这是基座里危害最大的一条越权。
 * 这里在 Bridge 层先判一次，三端共用同一道闸门。
 *
 * 策略取向：默认放行、按危险清单拒绝。
 * 理由：合法的 uri 形态各端差别很大（Android 的 content://、鸿蒙 picker 的
 * file://media/…、容器自己下载后的 file:///data/storage/el2/base/files/…），
 * 改白名单会把这些在用路径一起拦掉；而要防的三类（凭据目录、路径穿越、
 * 非文件类 scheme）用拒绝清单就能穷尽。
 * 别人的私有目录不在这里判：那由进程 uid 自己挡，且基座不知道当前租户包名，
 * 判了反而会把租户读自己 filesDir 的正常请求拦掉。
 */

/** 私有目录里绝不允许 H5 读的段落：凭据、数据库、解锁前加密区都落在这里。 */
const DENIED_SEGMENTS = ['shared_prefs', 'databases', 'preferences', 'no_backup'];

/** 允许出现的 scheme；其余（http/ftp/jar/…）一律拒，免得把「读文件」扩成下载或协议攻击面。 */
const ALLOWED_SCHEMES = ['file', 'content', 'android.resource', 'asset', 'resource'];

export type FileReadDecision = { allow: boolean; reason: string };

/** file:// 与裸路径都取到绝对路径；scheme://非斜杠形态（file://media/…）补回前导斜杠。 */
function pathOf(uri: string): string {
  const m = uri.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?!\/)(.*)$/);
  if (m) return `/${m[1]}`;
  return uri.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split(/[?#]/)[0];
}

/** 鸿蒙 el1 = 设备解锁前可读的加密区，凭据级敏感，整片拒。 */
function isHarmonyPreUnlockArea(pathname: string): boolean {
  return /^\/data\/storage\/el1(\/|$)/.test(pathname);
}

/**
 * 判断 H5 请求的文件 URI 是否允许读取。
 * @param uri H5 传入的原始 uri（file:// / content:// / 裸绝对路径都支持）
 */
export function decideFileReadUri(uri: string): FileReadDecision {
  const raw = (uri ?? '').trim();
  if (raw === '') {
    return { allow: false, reason: 'empty_uri' };
  }

  const scheme = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (scheme && !ALLOWED_SCHEMES.includes(scheme[1].toLowerCase())) {
    return { allow: false, reason: `unsupported_scheme:${scheme[1].toLowerCase()}` };
  }

  // 解码后再判：否则 %2e%2e 与 %73hared_prefs 能绕过字符串比较；非法编码按原文判，让原生去报错
  let pathname: string;
  try {
    pathname = decodeURIComponent(pathOf(raw));
  } catch {
    pathname = pathOf(raw);
  }

  const segments = pathname.split('/');
  if (segments.includes('..')) {
    return { allow: false, reason: 'path_traversal' };
  }
  if (segments.some((s) => DENIED_SEGMENTS.includes(s))) {
    return { allow: false, reason: 'credential_dir_denied' };
  }
  if (isHarmonyPreUnlockArea(pathname)) {
    return { allow: false, reason: 'credential_dir_denied' };
  }

  return { allow: true, reason: 'allowed' };
}

/**
 * 读取结果的大小闸门。
 * 注意这是字节已进内存之后才判的：防的是「几十 MB 的 base64 压垮 Bridge/WebView」，
 * 不是防原生读大文件本身——后者要改 Kotlin/ArkTS，属设备验证范围。
 */
export function assertReadableSize(
  result: { size?: number; base64?: string },
  maxBytes: number
): { allow: boolean; bytes: number } {
  const reported = Number(result?.size);
  const bytes =
    Number.isFinite(reported) && reported > 0
      ? reported
      : Math.round(((result?.base64?.length ?? 0) * 3) / 4);
  return { allow: bytes <= maxBytes, bytes };
}
