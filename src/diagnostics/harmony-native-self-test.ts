/**
 * 鸿蒙原生能力自检（Phase 4 验收通道）。
 *
 * 只在 harmony 启动时跑一次，结果经 deviceLogger 落到 `<filesDir>/logs/device-*.log`；
 * 用 `hdc file recv` 把这个文件拉出来就能逐项验收 Base* 是否真的通了。
 * 为什么不复用 H5 的能力测试页：那个入口在登录之后，而模拟器验证要在登录前就看到结果。
 *
 * 只测不需要人点的项。会拉系统面板或抢前台的一律不自动触发：share（分享面板）、
 * appOpenSettings / appOpenSystemSettings（跳设置）、takePhoto / pickImage / filePick /
 * saveImage（相机与系统 Picker 面板）、sendNotification / getCurrentPosition（授权弹窗）、
 * fileOpen（跳外部应用）。这些已在 ArkTS 侧实现，验收改由 H5 能力测试页人工点一遍。
 * scan 曾进过自动探针：模拟器（OpenHarmony-7.0.0.105）里 Scan Kit 默认扫码界面真的能拉起来，
 * 取消回「用户取消扫码」，链路已通；但它会抢前台并卡在启动画面上，所以移出自动探针。
 *
 * 非 harmony 平台直接 return：本文件只 import RN 核心 API，装了 RNOH 与否都不会影响安卓/iOS 启动。
 */
import { NativeModules } from 'react-native';
import { deviceLogger } from './device-logger';
import { deviceLogStore } from './device-log-store';
import { isHarmony } from '../platform/os';
import { H5_DEV_SERVER_PORT } from '../config';

const TAG = '[harmony-selftest]';

type AnyModule = Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>;

function fmt(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function probe(name: string, call: () => Promise<unknown>): Promise<void> {
  try {
    deviceLogger.info(`${TAG} ${name} OK ${fmt(await call())}`);
  } catch (e) {
    // RNOH 把 ArkTS 侧抛出的 Error 传成 {message} 对象而非 Error 实例，只判 instanceof
    // 会把人话文案打成 JSON。
    const message = (e as { message?: unknown })?.message;
    const reason = typeof message === 'string' && message ? message : fmt(e);
    deviceLogger.error(`${TAG} ${name} FAIL ${reason}`);
  }
}

let started = false;

/**
 * 后台跑一批探针：自测在启动期触发，不能阻塞调用方；批次内若整体抛错也要留痕，
 * 否则日志里只会看到「前几条 OK、后几条消失」这种无法定位的现象。
 */
function runDetached(task: () => Promise<void>): void {
  task().catch(e => deviceLogger.error(`${TAG} 批次异常 ${fmt(e)}`));
}

export function runHarmonyNativeSelfTest(): void {
  if (!isHarmony() || started) {
    return;
  }
  started = true;

  const system = NativeModules.BaseSystem as AnyModule | undefined;
  const network = NativeModules.BaseNetwork as AnyModule | undefined;
  const capabilities = NativeModules.BaseCapabilities as AnyModule | undefined;

  probe('BaseSystem.getDeviceInfo', () => {
    const call = system?.getDeviceInfo;
    return call ? call.call(system) : Promise.reject('BaseSystem 未注册');
  });
  probe('BaseNetwork.getStatus', () => {
    const call = network?.getStatus;
    return call ? call.call(network) : Promise.reject('BaseNetwork 未注册');
  });
  probe('BaseLog.getLogDir', () => deviceLogStore.getLogDir());
  probe('BaseLog.listLogs', () => deviceLogStore.listLogs());

  // 批次 2：文件读取 / 下载 / 角标。sendNotification（弹通知条）、getCurrentPosition
  // （弹授权框）、fileOpen（跳外部应用）会抢前台或需用户点，留给能力测试页人工验。
  runDetached(async () => {
    let logPath = '';
    try {
      const logs = await deviceLogStore.listLogs();
      logPath = logs?.[0]?.path ?? '';
    } catch {
      // 上面的 BaseLog.listLogs 探针已经记过一次失败原因
    }
    const read = capabilities?.readFileAsBase64;
    if (!logPath || !read) {
      deviceLogger.error(`${TAG} BaseCapabilities.readFileAsBase64 FAIL 缺少日志文件路径或方法`);
    } else {
      await probe('BaseCapabilities.readFileAsBase64', async () => {
        const info = (await read.call(capabilities, logPath)) as {
          base64?: string;
          mimeType?: string;
          name?: string;
          size?: number;
        };
        return {
          name: info?.name,
          mimeType: info?.mimeType,
          size: info?.size,
          base64Length: info?.base64?.length ?? 0,
        };
      });
    }
    const download = capabilities?.fileDownload;
    if (download) {
      await probe('BaseCapabilities.fileDownload', () =>
        download.call(capabilities, `http://127.0.0.1:${H5_DEV_SERVER_PORT}/index.html`),
      );
    }
    const badge = capabilities?.setBadge;
    if (badge) {
      await probe('BaseCapabilities.setBadge(3)', () => badge.call(capabilities, 3));
      await probe('BaseCapabilities.setBadge(0)', () => badge.call(capabilities, 0));
    }
    const sound = capabilities?.playSound;
    if (sound) {
      await probe('BaseCapabilities.playSound(200)', () => sound.call(capabilities, 200));
    }
  });

  // 剪贴板：先留原文，写完自检再写回去，避免把用户/测试机的剪贴板改坏。
  runDetached(async () => {
    const getString = capabilities?.clipboardGetString;
    const setString = capabilities?.clipboardSetString;
    if (!getString || !setString) {
      deviceLogger.error(`${TAG} clipboard FAIL BaseCapabilities 未注册`);
      return;
    }
    const marker = `qux-selftest-${Date.now()}`;
    let original = '';
    try {
      const before = (await getString.call(capabilities)) as { text?: string };
      original = before?.text ?? '';
    } catch (e) {
      deviceLogger.warn(`${TAG} clipboardGetString(初始读取) FAIL ${fmt(e)}`);
    }
    await probe('BaseCapabilities.clipboardSetString', () => setString.call(capabilities, marker));
    await probe('BaseCapabilities.clipboardGetString', async () => {
      const after = (await getString.call(capabilities)) as { text?: string };
      return { expected: marker, got: after?.text ?? '', match: after?.text === marker };
    });
    const hasString = capabilities?.clipboardHasString;
    if (hasString) {
      await probe('BaseCapabilities.clipboardHasString', async () => {
        const r = (await hasString.call(capabilities)) as { has?: boolean };
        return { has: r?.has };
      });
    }
    if (original) {
      await probe('BaseCapabilities.clipboardSetString(还原)', () =>
        setString.call(capabilities, original),
      );
    }
  });
}
