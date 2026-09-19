/**
 * 原生能力适配器（RN 侧，规则 13/51）：将 Bridge 能力模块对接到原生模块
 * `NativeModules.ERPCapabilities`。原生未链接时安全降级为空（模块返回
 * DEVICE_UNSUPPORTED），不抛出、不影响 App 启动。
 *
 * 延迟读取 NativeModules，便于测试时注入 mock。
 */
import { NativeModules } from 'react-native';
import { BridgeException } from '../../bridge/bridge-error';
import type { CapabilityAdapters, PickedFile } from '../../bridge/modules/capabilities/types';

type NativeFile = {
  name: string;
  size: number;
  mimeType: string;
  uri: string;
};

/**
 * 原生能力模块接口声明。
 * 新增能力时在此声明对应方法，适配器中做包装；原生未实现时方法不存在，
 * 适配器对应字段为 undefined，Bridge 模块返回 DEVICE_UNSUPPORTED。
 */
export interface ERPCapabilitiesNative {
  // ── 已有能力 ──
  scan(formats?: string[]): Promise<{ code: string; format?: string }>;
  takePhoto(): Promise<{ uri: string }>;
  pickImage(opts: { multiple?: boolean }): Promise<{ files: NativeFile[] }>;
  saveImage(uri: string): Promise<{ saved: boolean }>;
  filePick(opts: { accept?: string[]; multiple?: boolean }): Promise<{ files: NativeFile[] }>;
  readFileAsBase64(uri: string): Promise<{
    base64: string;
    mimeType: string;
    name: string;
    size: number;
  }>;
  fileDownload(url: string): Promise<{ uri: string }>;
  fileOpen(uri: string): Promise<{ opened: boolean }>;
  getCurrentPosition(opts?: { enableHighAccuracy?: boolean; timeout?: number }): Promise<{
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    timestamp: number;
  }>;
  setBadge(count: number): Promise<{ ok: boolean }>;
  playSound(duration?: number): Promise<{ ok: boolean }>;
  sendNotification(
    title: string,
    content: string,
    opts?: { channelId?: string },
  ): Promise<{ ok: boolean; notificationId?: number }>;

  // ── 新增能力（原生未实现时方法不存在） ──
  clipboardGetString?(): Promise<{ text: string }>;
  clipboardSetString?(text: string): Promise<{ ok: boolean }>;
  clipboardHasString?(): Promise<{ has: boolean }>;
  getBrightness?(): Promise<{ brightness: number }>;
  setBrightness?(brightness: number): Promise<{ brightness: number }>;
  getSystemBrightness?(): Promise<{ brightness: number }>;
  flashlightAvailable?(): Promise<{ available: boolean }>;
  flashlightToggle?(enabled: boolean): Promise<{ enabled: boolean }>;
  sensorAvailable?(type: string): Promise<{ available: boolean }>;
  sensorStart?(type: string, opts?: { interval?: string }): Promise<{ subscriptionId: string }>;
  sensorStop?(subscriptionId: string): Promise<void>;
  getStepCount?(): Promise<{ steps: number }>;
  biometricAvailable?(): Promise<{
    available: boolean;
    biometryType?: string;
    error?: string;
  }>;
  biometricAuthenticate?(opts?: {
    promptMessage?: string;
    cancelButtonText?: string;
    fallbackLabel?: string;
    requireConfirmation?: boolean;
  }): Promise<{ success: boolean; error?: string }>;
  contactsGetAll?(opts?: {
    pageSize?: number;
    page?: number;
  }): Promise<{ contacts: unknown[]; hasMore: boolean }>;
  contactsPick?(): Promise<unknown | null>;
  contactsAdd?(contact: unknown): Promise<{ id: string }>;
  calendarGetCalendars?(): Promise<{ calendars: unknown[] }>;
  calendarGetEvents?(opts: {
    calendarId?: string;
    startDate: number;
    endDate: number;
  }): Promise<{ events: unknown[] }>;
  calendarAddEvent?(event: unknown): Promise<{ id: string }>;
  calendarRemoveEvent?(id: string): Promise<{ ok: boolean }>;
  nfcAvailable?(): Promise<{ available: boolean }>;
  nfcReadTag?(timeout?: number): Promise<{
    tagId: string;
    techTypes: string[];
    data?: Record<string, unknown>;
  }>;
  nfcWriteNdef?(records: { type: string; data: string }[]): Promise<{ ok: boolean }>;
  bluetoothAvailable?(): Promise<{ available: boolean; enabled: boolean }>;
  bluetoothEnable?(): Promise<{ ok: boolean }>;
  bluetoothStartScan?(opts?: {
    serviceUuids?: string[];
    timeout?: number;
  }): Promise<{ devices: unknown[] }>;
  bluetoothStopScan?(): Promise<void>;
  bluetoothConnect?(deviceId: string): Promise<{ connected: boolean }>;
  bluetoothDisconnect?(deviceId: string): Promise<void>;
  bluetoothWrite?(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    data: string,
  ): Promise<{ ok: boolean }>;
  bluetoothRead?(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<{ data: string }>;
  audioStartRecording?(opts?: {
    format?: string;
    quality?: string;
    maxDuration?: number;
  }): Promise<{ ok: boolean }>;
  audioStopRecording?(): Promise<{
    uri: string;
    duration?: number;
    size?: number;
  }>;
  audioPlay?(uri: string, opts?: { loop?: boolean; volume?: number }): Promise<{ ok: boolean }>;
  audioPause?(): Promise<{ ok: boolean }>;
  audioStop?(): Promise<{ ok: boolean }>;
  getDiskInfo?(): Promise<{
    totalSpace: number;
    freeSpace: number;
    appCacheSize: number;
  }>;
  clearCache?(): Promise<{ cleared: number }>;
  getAppDir?(): Promise<{
    cacheDir: string;
    filesDir: string;
    documentDir?: string;
  }>;
  getWifiInfo?(): Promise<{
    ssid: string;
    bssid?: string;
    ipAddress: string;
    signalStrength?: number;
    isConnected: boolean;
  }>;
  getCellularInfo?(): Promise<{
    carrier: string;
    networkType: string;
    signalStrength?: number;
  }>;
  getIpAddress?(type?: string): Promise<{ ip: string }>;
  qrGenerate?(
    text: string,
    opts?: { size?: number; margin?: number; errorCorrectionLevel?: string },
  ): Promise<{ uri: string; base64?: string }>;
  imageCompress?(
    uri: string,
    opts?: {
      quality?: number;
      maxWidth?: number;
      maxHeight?: number;
      format?: string;
    },
  ): Promise<{ uri: string; size: number; width: number; height: number }>;
  imageCrop?(
    uri: string,
    opts: { x: number; y: number; width: number; height: number },
  ): Promise<{ uri: string }>;
  imageGetSize?(uri: string): Promise<{ width: number; height: number; size: number }>;
  hapticsImpact?(style: string): Promise<void>;
  hapticsNotification?(type: string): Promise<void>;
  hapticsSelection?(): Promise<void>;
  speechSpeak?(
    text: string,
    opts?: {
      language?: string;
      rate?: number;
      pitch?: number;
      volume?: number;
    },
  ): Promise<{ ok: boolean }>;
  speechStop?(): Promise<{ ok: boolean }>;
  speechIsSpeaking?(): Promise<{ speaking: boolean }>;
  speechGetLanguages?(): Promise<{ languages: string[] }>;
  appInstalled?(packageName: string): Promise<{ installed: boolean }>;
  appOpen?(packageName: string, opts?: { data?: string }): Promise<{ opened: boolean }>;
  appOpenStore?(appId?: string): Promise<{ opened: boolean }>;
  appOpenSettings?(): Promise<{ opened: boolean }>;
  appGetInstalled?(): Promise<{ apps: unknown[] }>;
  backgroundStart?(taskKey: string, opts?: { timeout?: number }): Promise<{ taskId: number }>;
  backgroundStop?(taskId: number): Promise<void>;
  backgroundRunning?(taskKey: string): Promise<{ running: boolean }>;
  inAppReview?(): Promise<{ ok: boolean }>;
}

function toPickedFile(f: NativeFile): PickedFile {
  return { name: f.name, size: f.size, mimeType: f.mimeType, uri: f.uri };
}

/**
 * 原生模块 reject 时包装为 BridgeException，保留真实错误信息。
 * 否则 BridgeServer 会把非 BridgeException 统一吞成 UNKNOWN_ERROR（"未知错误"）。
 */
function wrapNativeError(e: unknown, defaultMsg: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  throw new BridgeException('NATIVE_ERROR', msg || defaultMsg);
}

/** 解析原生能力适配器；原生模块缺失时返回空对象（按需降级）。 */
export function resolveNativeCapabilityAdapters(): CapabilityAdapters {
  const nativeModule = (NativeModules as Record<string, unknown>).ERPCapabilities as
    | ERPCapabilitiesNative
    | undefined;

  if (!nativeModule) {
    return {};
  }

  return {
    // ── 已有能力 ──
    scanner: {
      scan: opts => nativeModule.scan(opts?.formats).catch(e => wrapNativeError(e, '扫码失败')),
    },
    camera: {
      takePhoto: () => nativeModule.takePhoto().catch(e => wrapNativeError(e, '拍照失败')),
    },
    media: {
      pickImage: async opts => {
        try {
          const r = await nativeModule.pickImage(opts ?? {});
          return { files: (r.files ?? []).map(toPickedFile) };
        } catch (e) {
          wrapNativeError(e, '选图失败');
        }
      },
      saveImage: uri => nativeModule.saveImage(uri).catch(e => wrapNativeError(e, '保存图片失败')),
    },
    file: {
      pick: async opts => {
        try {
          const r = await nativeModule.filePick(opts ?? {});
          return { files: (r.files ?? []).map(toPickedFile) };
        } catch (e) {
          wrapNativeError(e, '文件选择失败');
        }
      },
      readAsBase64: uri =>
        nativeModule.readFileAsBase64(uri).catch(e => wrapNativeError(e, '读取文件失败')),
      download: url => nativeModule.fileDownload(url).catch(e => wrapNativeError(e, '下载失败')),
      open: uri => nativeModule.fileOpen(uri).catch(e => wrapNativeError(e, '打开文件失败')),
    },
    location: {
      // 原生 getCurrentPosition(promise) 只接受 promise，不传 opts
      getCurrentPosition: () =>
        nativeModule.getCurrentPosition().catch(e => wrapNativeError(e, '获取定位失败')),
    },
    notification: {
      // 推送 Token：项目未接入 FCM/厂商推送，返回模拟值便于 H5 联调
      getToken: async () => 'mock-token-emulator',
      setBadge: async count => {
        try {
          const r = await nativeModule.setBadge(count);
          return Boolean(r?.ok);
        } catch (e) {
          wrapNativeError(e, '角标设置失败');
        }
      },
      playSound: () =>
        nativeModule.playSound(3000).catch(e => wrapNativeError(e, '提示音播放失败')),
      // 原生 sendNotification(title, content, promise) 只接受 2 个参数，不传 opts
      sendNotification: async (title, content) => {
        try {
          return await nativeModule.sendNotification(title, content);
        } catch (e) {
          wrapNativeError(e, '通知发送失败');
        }
      },
    },

    // ── 新增能力（原生方法存在时才挂载适配器） ──
    clipboard: nativeModule.clipboardGetString
      ? {
          getString: () =>
            nativeModule.clipboardGetString!().catch(e => wrapNativeError(e, '读取剪贴板失败')),
          setString: text =>
            nativeModule.clipboardSetString!(text).catch(e => wrapNativeError(e, '写入剪贴板失败')),
          hasString: nativeModule.clipboardHasString
            ? () =>
                nativeModule.clipboardHasString!().catch(e => wrapNativeError(e, '查询剪贴板失败'))
            : undefined,
        }
      : undefined,

    brightness: nativeModule.getBrightness
      ? {
          getBrightness: () =>
            nativeModule.getBrightness!().catch(e => wrapNativeError(e, '获取亮度失败')),
          setBrightness: v =>
            nativeModule.setBrightness!(v).catch(e => wrapNativeError(e, '设置亮度失败')),
          getSystemBrightness: nativeModule.getSystemBrightness
            ? () =>
                nativeModule.getSystemBrightness!().catch(e =>
                  wrapNativeError(e, '获取系统亮度失败'),
                )
            : undefined,
        }
      : undefined,

    flashlight: nativeModule.flashlightAvailable
      ? {
          isAvailable: () =>
            nativeModule.flashlightAvailable!().catch(e => wrapNativeError(e, '查询手电筒失败')),
          toggle: enabled =>
            nativeModule.flashlightToggle!(enabled).catch(e =>
              wrapNativeError(e, '切换手电筒失败'),
            ),
        }
      : undefined,

    sensor: nativeModule.sensorStart
      ? {
          isAvailable: type =>
            nativeModule.sensorAvailable!(type).catch(e => wrapNativeError(e, '查询传感器失败')),
          start: (type, callback, opts) =>
            nativeModule.sensorStart!(type, opts).catch(e => wrapNativeError(e, '启动传感器失败')),
          stop: id => nativeModule.sensorStop!(id).catch(e => wrapNativeError(e, '停止传感器失败')),
          getStepCount: nativeModule.getStepCount
            ? () => nativeModule.getStepCount!().catch(e => wrapNativeError(e, '获取步数失败'))
            : undefined,
        }
      : undefined,

    biometric: nativeModule.biometricAvailable
      ? {
          isAvailable: async () => {
            try {
              const r = await nativeModule.biometricAvailable!();
              return {
                available: r.available,
                biometryType: r.biometryType as
                  | 'fingerprint'
                  | 'face'
                  | 'iris'
                  | 'none'
                  | undefined,
                error: r.error,
              };
            } catch (e) {
              wrapNativeError(e, '查询生物识别失败');
            }
          },
          authenticate: opts =>
            nativeModule.biometricAuthenticate!(opts).catch(e =>
              wrapNativeError(e, '生物识别认证失败'),
            ),
        }
      : undefined,

    contacts: nativeModule.contactsGetAll
      ? {
          getAll: opts =>
            nativeModule.contactsGetAll!(opts).catch(e =>
              wrapNativeError(e, '获取通讯录失败'),
            ) as Promise<{
              contacts: import('../../bridge/modules/capabilities/types').Contact[];
              hasMore: boolean;
            }>,
          pick: () =>
            nativeModule.contactsPick!().catch(e =>
              wrapNativeError(e, '选择联系人失败'),
            ) as Promise<import('../../bridge/modules/capabilities/types').Contact | null>,
          add: contact =>
            nativeModule.contactsAdd!(contact).catch(e => wrapNativeError(e, '添加联系人失败')),
        }
      : undefined,

    calendar: nativeModule.calendarGetCalendars
      ? {
          getCalendars: () =>
            nativeModule.calendarGetCalendars!().catch(e =>
              wrapNativeError(e, '获取日历失败'),
            ) as Promise<{
              calendars: { id: string; title: string; color?: string }[];
            }>,
          getEvents: opts =>
            nativeModule.calendarGetEvents!(opts).catch(e =>
              wrapNativeError(e, '获取日历事件失败'),
            ) as Promise<{
              events: import('../../bridge/modules/capabilities/types').CalendarEvent[];
            }>,
          addEvent: event =>
            nativeModule.calendarAddEvent!(event).catch(e =>
              wrapNativeError(e, '添加日历事件失败'),
            ),
          removeEvent: id =>
            nativeModule.calendarRemoveEvent!(id).catch(e =>
              wrapNativeError(e, '删除日历事件失败'),
            ),
        }
      : undefined,

    nfc: nativeModule.nfcAvailable
      ? {
          isAvailable: () =>
            nativeModule.nfcAvailable!().catch(e => wrapNativeError(e, '查询 NFC 失败')),
          readTag: timeout =>
            nativeModule.nfcReadTag!(timeout).catch(e => wrapNativeError(e, '读取 NFC 标签失败')),
          writeNdef: nativeModule.nfcWriteNdef
            ? records =>
                nativeModule.nfcWriteNdef!(records).catch(e => wrapNativeError(e, '写入 NFC 失败'))
            : undefined,
        }
      : undefined,

    bluetooth: nativeModule.bluetoothAvailable
      ? {
          isAvailable: () =>
            nativeModule.bluetoothAvailable!().catch(e => wrapNativeError(e, '查询蓝牙失败')),
          enable: nativeModule.bluetoothEnable
            ? () => nativeModule.bluetoothEnable!().catch(e => wrapNativeError(e, '启用蓝牙失败'))
            : undefined,
          startScan: opts =>
            nativeModule.bluetoothStartScan!(opts).catch(e =>
              wrapNativeError(e, '蓝牙扫描失败'),
            ) as Promise<{
              devices: import('../../bridge/modules/capabilities/types').BluetoothDevice[];
            }>,
          stopScan: () =>
            nativeModule.bluetoothStopScan!().catch(e => wrapNativeError(e, '停止蓝牙扫描失败')),
          connect: id =>
            nativeModule.bluetoothConnect!(id).catch(e => wrapNativeError(e, '蓝牙连接失败')),
          disconnect: id =>
            nativeModule.bluetoothDisconnect!(id).catch(e => wrapNativeError(e, '蓝牙断开失败')),
          write: nativeModule.bluetoothWrite
            ? (id, svc, ch, data) =>
                nativeModule.bluetoothWrite!(id, svc, ch, data).catch(e =>
                  wrapNativeError(e, '蓝牙写入失败'),
                )
            : undefined,
          read: nativeModule.bluetoothRead
            ? (id, svc, ch) =>
                nativeModule.bluetoothRead!(id, svc, ch).catch(e =>
                  wrapNativeError(e, '蓝牙读取失败'),
                )
            : undefined,
        }
      : undefined,

    audio: nativeModule.audioStartRecording
      ? {
          startRecording: opts =>
            nativeModule.audioStartRecording!(opts).catch(e => wrapNativeError(e, '开始录音失败')),
          stopRecording: () =>
            nativeModule.audioStopRecording!().catch(e => wrapNativeError(e, '停止录音失败')),
          play: (uri, opts) =>
            nativeModule.audioPlay!(uri, opts).catch(e => wrapNativeError(e, '播放音频失败')),
          pause: nativeModule.audioPause
            ? () => nativeModule.audioPause!().catch(e => wrapNativeError(e, '暂停音频失败'))
            : undefined,
          stop: nativeModule.audioStop
            ? () => nativeModule.audioStop!().catch(e => wrapNativeError(e, '停止音频失败'))
            : undefined,
        }
      : undefined,

    storage: nativeModule.getDiskInfo
      ? {
          getDiskInfo: () =>
            nativeModule.getDiskInfo!().catch(e => wrapNativeError(e, '获取存储信息失败')),
          clearCache: () =>
            nativeModule.clearCache!().catch(e => wrapNativeError(e, '清理缓存失败')),
          getAppDir: nativeModule.getAppDir
            ? () => nativeModule.getAppDir!().catch(e => wrapNativeError(e, '获取应用目录失败'))
            : undefined,
        }
      : undefined,

    networkInfo: nativeModule.getWifiInfo
      ? {
          getWifiInfo: () =>
            nativeModule.getWifiInfo!().catch(e => wrapNativeError(e, '获取 WiFi 信息失败')),
          getCellularInfo: nativeModule.getCellularInfo
            ? () =>
                nativeModule.getCellularInfo!().catch(e => wrapNativeError(e, '获取蜂窝信息失败'))
            : undefined,
          getIpAddress: nativeModule.getIpAddress
            ? (type?: 'ipv4' | 'ipv6') =>
                nativeModule.getIpAddress!(type).catch(e => wrapNativeError(e, '获取 IP 失败'))
            : undefined,
        }
      : undefined,

    qr: nativeModule.qrGenerate
      ? {
          generate: (text, opts) =>
            nativeModule.qrGenerate!(text, opts).catch(e => wrapNativeError(e, '生成二维码失败')),
        }
      : undefined,

    image: nativeModule.imageCompress
      ? {
          compress: (uri, opts) =>
            nativeModule.imageCompress!(uri, opts).catch(e => wrapNativeError(e, '压缩图片失败')),
          crop: nativeModule.imageCrop
            ? (uri, opts) =>
                nativeModule.imageCrop!(uri, opts).catch(e => wrapNativeError(e, '裁剪图片失败'))
            : undefined,
          getSize: nativeModule.imageGetSize
            ? uri =>
                nativeModule.imageGetSize!(uri).catch(e => wrapNativeError(e, '获取图片尺寸失败'))
            : undefined,
        }
      : undefined,

    haptics: nativeModule.hapticsImpact
      ? {
          impact: style =>
            nativeModule.hapticsImpact!(style).catch(e => wrapNativeError(e, '触觉反馈失败')),
          notification: type =>
            nativeModule.hapticsNotification!(type).catch(e => wrapNativeError(e, '触觉反馈失败')),
          selection: () =>
            nativeModule.hapticsSelection!().catch(e => wrapNativeError(e, '触觉反馈失败')),
        }
      : undefined,

    speech: nativeModule.speechSpeak
      ? {
          speak: (text, opts) =>
            nativeModule.speechSpeak!(text, opts).catch(e => wrapNativeError(e, '语音合成失败')),
          stop: nativeModule.speechStop
            ? () => nativeModule.speechStop!().catch(e => wrapNativeError(e, '停止语音失败'))
            : undefined,
          isSpeaking: nativeModule.speechIsSpeaking
            ? () =>
                nativeModule.speechIsSpeaking!().catch(e => wrapNativeError(e, '查询语音状态失败'))
            : undefined,
          getAvailableLanguages: nativeModule.speechGetLanguages
            ? () =>
                nativeModule.speechGetLanguages!().catch(e =>
                  wrapNativeError(e, '获取语言列表失败'),
                )
            : undefined,
        }
      : undefined,

    appManager: nativeModule.appInstalled
      ? {
          isInstalled: pkg =>
            nativeModule.appInstalled!(pkg).catch(e => wrapNativeError(e, '查询应用失败')),
          openApp: (pkg, opts) =>
            nativeModule.appOpen!(pkg, opts).catch(e => wrapNativeError(e, '打开应用失败')),
          openAppStore: nativeModule.appOpenStore
            ? appId =>
                nativeModule.appOpenStore!(appId).catch(e => wrapNativeError(e, '打开应用市场失败'))
            : undefined,
          openAppSettings: nativeModule.appOpenSettings
            ? () =>
                nativeModule.appOpenSettings!().catch(e => wrapNativeError(e, '打开应用设置失败'))
            : undefined,
          getInstalledApps: nativeModule.appGetInstalled
            ? () =>
                nativeModule.appGetInstalled!().catch(e =>
                  wrapNativeError(e, '获取已安装应用失败'),
                ) as Promise<{
                  apps: {
                    packageName: string;
                    appName: string;
                    versionName?: string;
                  }[];
                }>
            : undefined,
        }
      : undefined,

    backgroundTask: nativeModule.backgroundStart
      ? {
          start: (key, opts) =>
            nativeModule.backgroundStart!(key, opts).catch(e =>
              wrapNativeError(e, '启动后台任务失败'),
            ),
          stop: id =>
            nativeModule.backgroundStop!(id).catch(e => wrapNativeError(e, '停止后台任务失败')),
          isRunning: nativeModule.backgroundRunning
            ? key =>
                nativeModule.backgroundRunning!(key).catch(e =>
                  wrapNativeError(e, '查询后台任务失败'),
                )
            : undefined,
        }
      : undefined,

    inAppReview: nativeModule.inAppReview
      ? {
          requestReview: () =>
            nativeModule.inAppReview!().catch(e => wrapNativeError(e, '应用内评价失败')),
        }
      : undefined,
  };
}
