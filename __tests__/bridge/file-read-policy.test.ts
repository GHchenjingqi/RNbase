/**
 * file.readAsBase64 的 URI 闸门与体积闸门。
 *
 * 钉住的核心风险：原生照 H5 给的 uri 直接 open，子应用页面因此能读到宿主的
 * shared_prefs / preferences（里面就是会话凭据）。
 */
import { assertReadableSize, decideFileReadUri } from '../../src/bridge/file-read-policy';
import { createAppBridgeServer } from '../../src/app/compose-bridge-server';
import { BRIDGE_FILE_READ_MAX_BYTES } from '../../src/config';

async function callFile(
  server: ReturnType<typeof createAppBridgeServer>,
  action: string,
  params?: object
) {
  return server.handle({
    type: 'request',
    id: `file-${action}-${Math.random()}`,
    version: '1.0.0',
    module: 'file',
    action,
    params,
  } as never);
}

describe('decideFileReadUri', () => {
  test('放行在用的三种形态：Android picker、容器下载产物、鸿蒙相册', () => {
    for (const uri of [
      'content://media/external/images/media/1234',
      'file:///data/user/0/com.qux/cache/download/a.pdf',
      'file:///data/data/com.qux/files/x.png',
      'file://media/Photo/7/IMG_007/screenshot_007.jpg?utm_origin=picker',
      '/data/storage/el2/base/files/download/report.xlsx',
      'file:///android_asset/h5/index.html',
    ]) {
      expect({ uri, d: decideFileReadUri(uri) }).toEqual({
        uri,
        d: { allow: true, reason: 'allowed' },
      });
    }
  });

  test('拒绝本应用凭据目录（安卓与鸿蒙两种拼写）', () => {
    for (const uri of [
      'file:///data/data/com.qux/shared_prefs/RNStorage.xml',
      'file:///data/user/0/com.qux/databases/app.db',
      'file:///data/storage/el2/base/haps/entry/preferences/token',
      'file:///data/storage/el1/base/files/anything',
    ]) {
      expect(decideFileReadUri(uri)).toEqual({ allow: false, reason: 'credential_dir_denied' });
    }
  });

  test('拒绝路径穿越，含百分号编码的穿越', () => {
    expect(decideFileReadUri('file:///data/user/0/com.qux/cache/../../shared_prefs/x')).toEqual({
      allow: false,
      reason: 'path_traversal',
    });
    expect(decideFileReadUri('file:///data/user/0/com.qux/cache/%2e%2e/shared_prefs/x')).toEqual({
      allow: false,
      reason: 'path_traversal',
    });
    // 编码后的凭据目录同样拦得住：解码发生在分段比较之前
    expect(decideFileReadUri('file:///data/data/com.qux/%73hared_prefs/x')).toEqual({
      allow: false,
      reason: 'credential_dir_denied',
    });
  });

  test('拒绝非文件类 scheme，避免把读文件变成下载/协议攻击面', () => {
    expect(decideFileReadUri('http://host/secret')).toEqual({
      allow: false,
      reason: 'unsupported_scheme:http',
    });
    expect(decideFileReadUri('jar:file:///data/app/base.apk!/res/x')).toEqual({
      allow: false,
      reason: 'unsupported_scheme:jar',
    });
  });

  test('空 uri 与全空格 uri 直接拒', () => {
    expect(decideFileReadUri('')).toEqual({ allow: false, reason: 'empty_uri' });
    expect(decideFileReadUri('   ')).toEqual({ allow: false, reason: 'empty_uri' });
  });

  test('文件名里带 databases 字样的普通路径不误伤（只按路径段比较）', () => {
    expect(
      decideFileReadUri('file:///storage/emulated/0/Download/my_databases_backup.txt')
    ).toEqual({
      allow: true,
      reason: 'allowed',
    });
  });
});

describe('assertReadableSize', () => {
  test('按原生回报的 size 判；缺失时用 base64 长度反推', () => {
    expect(assertReadableSize({ size: 1024 }, 2048)).toEqual({ allow: true, bytes: 1024 });
    expect(assertReadableSize({ size: 2049 }, 2048).allow).toBe(false);
    expect(assertReadableSize({ base64: 'A'.repeat(1500) }, 2048)).toEqual({
      allow: true,
      bytes: 1125,
    });
    expect(assertReadableSize({ base64: 'A'.repeat(3000) }, 2048)).toEqual({
      allow: false,
      bytes: 2250,
    });
    expect(assertReadableSize({}, 2048)).toEqual({ allow: true, bytes: 0 });
  });
});

describe('file.readAsBase64 闸门接线', () => {
  test('凭据目录的 uri 到不了原生 adapter', async () => {
    const readFileAsBase64 = jest.fn(async () => ({
      base64: 'AA==',
      mimeType: 'text/xml',
      name: 'x',
      size: 1,
    }));
    const server = createAppBridgeServer({ file: { readAsBase64: readFileAsBase64 } } as never);
    const res = await callFile(server, 'readAsBase64', {
      uri: 'file:///data/data/com.qux/shared_prefs/RNStorage.xml',
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('SECURITY_BLOCKED');
    expect(readFileAsBase64).not.toHaveBeenCalled();
  });

  test('正常文件透传 adapter 结果', async () => {
    const ok = { base64: 'aGVsbG8=', mimeType: 'image/jpeg', name: 'a.jpg', size: 5 };
    const server = createAppBridgeServer({
      file: { readAsBase64: jest.fn(async () => ok) },
    } as never);
    const res = await callFile(server, 'readAsBase64', {
      uri: 'content://media/external/images/media/1',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual(ok);
  });

  test('超过 Bridge 体积上限的结果报 FILE_TOO_LARGE，不把大字符串交给 H5', async () => {
    const huge = {
      base64: 'A'.repeat(3),
      mimeType: 'application/octet-stream',
      name: 'big.bin',
      size: BRIDGE_FILE_READ_MAX_BYTES + 1,
    };
    const server = createAppBridgeServer({
      file: { readAsBase64: jest.fn(async () => huge) },
    } as never);
    const res = await callFile(server, 'readAsBase64', {
      uri: 'file:///data/user/0/com.qux/files/big.bin',
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('FILE_TOO_LARGE');
  });
});
