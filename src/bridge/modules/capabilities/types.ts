/**
 * 原生能力适配器接口（规则 51：平台差异集中在 adapter）。
 *
 * 各模块在 RN 侧由对应原生/三方库实现；未接入时返回 DEVICE_UNSUPPORTED，
 * 保证 Bridge 契约完整且可测试（规则 13：适配现有工程而非强制覆盖）。
 */
import { BridgeException } from '../../bridge-error';

export type PickedFile = {
  name: string;
  size: number;
  mimeType: string;
  uri: string;
};

export interface ScannerAdapter {
  scan(opts?: { formats?: string[] }): Promise<{ code: string; format?: string }>;
}

export interface CameraAdapter {
  takePhoto(): Promise<{ uri: string }>;
  recordVideo?(opts?: {
    quality?: 'high' | 'low';
    maxDuration?: number;
  }): Promise<{ uri: string; duration?: number }>;
  switchCamera?(): Promise<{ facing: 'front' | 'back' }>;
  setTorch?(enabled: boolean): Promise<{ enabled: boolean }>;
}

export interface MediaAdapter {
  pickImage(opts?: { multiple?: boolean }): Promise<{ files: PickedFile[] }>;
  pickVideo?(opts?: { multiple?: boolean }): Promise<{ files: PickedFile[] }>;
  pickAudio?(opts?: { multiple?: boolean }): Promise<{ files: PickedFile[] }>;
  saveImage(uri: string): Promise<{ saved: boolean }>;
  saveVideo?(uri: string): Promise<{ saved: boolean }>;
}

export interface FileAdapter {
  pick(opts?: { accept?: string[]; multiple?: boolean }): Promise<{
    files: PickedFile[];
  }>;
  /** 读取文件内容为 Base64（供 H5 侧转 Blob 上传，如头像上传）。 */
  readAsBase64(uri: string): Promise<{
    base64: string;
    mimeType: string;
    name: string;
    size: number;
  }>;
  getInfo?(uri: string): Promise<{
    name: string;
    size: number;
    mimeType: string;
    lastModified: number;
  }>;
  download(url: string): Promise<{ uri: string }>;
  open(uri: string): Promise<{ opened: boolean }>;
}

export interface LocationAdapter {
  getCurrentPosition(opts?: { enableHighAccuracy?: boolean; timeout?: number }): Promise<{
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    timestamp: number;
  }>;
  watchPosition?(
    callback: (pos: { latitude: number; longitude: number; accuracy?: number }) => void,
    opts?: { enableHighAccuracy?: boolean },
  ): Promise<{ watchId: string }>;
  clearWatch?(watchId: string): Promise<void>;
}

export interface NotificationAdapter {
  getToken?: () => Promise<string | null>;
  setBadge?: (count: number) => Promise<boolean>;
  playSound?: () => Promise<{ ok: boolean }>;
  sendNotification?: (
    title: string,
    content: string,
  ) => Promise<{ ok: boolean; notificationId?: number }>;
  cancelNotification?(notificationId: number): Promise<{ ok: boolean }>;
  cancelAll?(): Promise<{ ok: boolean }>;
}

/** 剪贴板 */
export interface ClipboardAdapter {
  getString(): Promise<{ text: string }>;
  setString(text: string): Promise<{ ok: boolean }>;
  hasString?(): Promise<{ has: boolean }>;
}

/** 屏幕亮度 */
export interface BrightnessAdapter {
  getBrightness(): Promise<{ brightness: number }>;
  setBrightness(brightness: number): Promise<{ brightness: number }>;
  getSystemBrightness?(): Promise<{ brightness: number }>;
}

/** 手电筒 */
export interface FlashlightAdapter {
  isAvailable(): Promise<{ available: boolean }>;
  toggle(enabled: boolean): Promise<{ enabled: boolean }>;
}

/** 传感器 */
export type SensorType =
  | 'accelerometer'
  | 'gyroscope'
  | 'magnetometer'
  | 'barometer'
  | 'pedometer'
  | 'gravity'
  | 'rotation';

export interface SensorData {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface SensorAdapter {
  isAvailable(type: SensorType): Promise<{ available: boolean }>;
  start(
    type: SensorType,
    callback: (data: SensorData) => void,
    opts?: { interval?: 'fastest' | 'game' | 'ui' | 'normal' },
  ): Promise<{ subscriptionId: string }>;
  stop(subscriptionId: string): Promise<void>;
  getStepCount?(): Promise<{ steps: number }>;
}

/** 生物识别 */
export interface BiometricAdapter {
  isAvailable(): Promise<{
    available: boolean;
    biometryType?: 'fingerprint' | 'face' | 'iris' | 'none';
    error?: string;
  }>;
  authenticate(opts?: {
    promptMessage?: string;
    cancelButtonText?: string;
    fallbackLabel?: string;
    requireConfirmation?: boolean;
  }): Promise<{ success: boolean; error?: string }>;
}

/** 通讯录 */
export interface Contact {
  id: string;
  name: string;
  phones?: string[];
  emails?: string[];
  company?: string;
  thumbnail?: string;
}

export interface ContactsAdapter {
  getAll(opts?: { pageSize?: number; page?: number }): Promise<{
    contacts: Contact[];
    hasMore: boolean;
  }>;
  pick(): Promise<Contact | null>;
  add(contact: Omit<Contact, 'id'>): Promise<{ id: string }>;
}

/** 日历 */
export interface CalendarEvent {
  id?: string;
  title: string;
  startDate: number;
  endDate: number;
  location?: string;
  description?: string;
  allDay?: boolean;
  reminders?: number[];
}

export interface CalendarAdapter {
  getCalendars(): Promise<{
    calendars: { id: string; title: string; color?: string }[];
  }>;
  getEvents(opts: {
    calendarId?: string;
    startDate: number;
    endDate: number;
  }): Promise<{ events: CalendarEvent[] }>;
  addEvent(event: CalendarEvent): Promise<{ id: string }>;
  removeEvent(id: string): Promise<{ ok: boolean }>;
}

/** NFC */
export interface NfcAdapter {
  isAvailable(): Promise<{ available: boolean }>;
  readTag(timeout?: number): Promise<{
    tagId: string;
    techTypes: string[];
    data?: Record<string, unknown>;
  }>;
  writeNdef?(records: { type: string; data: string }[]): Promise<{ ok: boolean }>;
}

/** 蓝牙 */
export interface BluetoothDevice {
  id: string;
  name: string;
  rssi?: number;
  paired?: boolean;
}

export interface BluetoothAdapter {
  isAvailable(): Promise<{ available: boolean; enabled: boolean }>;
  enable?(): Promise<{ ok: boolean }>;
  startScan(opts?: {
    serviceUuids?: string[];
    timeout?: number;
  }): Promise<{ devices: BluetoothDevice[] }>;
  stopScan(): Promise<void>;
  connect(deviceId: string): Promise<{ connected: boolean }>;
  disconnect(deviceId: string): Promise<void>;
  write?(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    data: string,
  ): Promise<{ ok: boolean }>;
  read?(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<{ data: string }>;
}

/** 音频录制 */
export interface AudioAdapter {
  startRecording(opts?: {
    format?: 'aac' | 'mp3' | 'wav';
    quality?: 'high' | 'low';
    maxDuration?: number;
  }): Promise<{ ok: boolean }>;
  stopRecording(): Promise<{ uri: string; duration?: number; size?: number }>;
  play(uri: string, opts?: { loop?: boolean; volume?: number }): Promise<{ ok: boolean }>;
  pause?(): Promise<{ ok: boolean }>;
  stop?(): Promise<{ ok: boolean }>;
}

/** 存储管理 */
export interface StorageAdapter {
  getDiskInfo(): Promise<{
    totalSpace: number;
    freeSpace: number;
    appCacheSize: number;
  }>;
  clearCache(): Promise<{ cleared: number }>;
  getAppDir?(): Promise<{
    cacheDir: string;
    filesDir: string;
    documentDir?: string;
  }>;
}

/** 网络详细信息 */
export interface NetworkInfoAdapter {
  getWifiInfo(): Promise<{
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
  getIpAddress?(type?: 'ipv4' | 'ipv6'): Promise<{ ip: string }>;
}

/** 二维码生成 */
export interface QrAdapter {
  generate(
    text: string,
    opts?: {
      size?: number;
      margin?: number;
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    },
  ): Promise<{ uri: string; base64?: string }>;
}

/** 图片处理 */
export interface ImageAdapter {
  compress(
    uri: string,
    opts?: {
      quality?: number;
      maxWidth?: number;
      maxHeight?: number;
      format?: 'jpeg' | 'png';
    },
  ): Promise<{ uri: string; size: number; width: number; height: number }>;
  crop?(
    uri: string,
    opts: { x: number; y: number; width: number; height: number },
  ): Promise<{ uri: string }>;
  getSize?(uri: string): Promise<{ width: number; height: number; size: number }>;
}

/** 触觉反馈 */
export interface HapticsAdapter {
  impact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): Promise<void>;
  notification(type: 'success' | 'warning' | 'error'): Promise<void>;
  selection(): Promise<void>;
}

/** 语音合成 */
export interface SpeechAdapter {
  speak(
    text: string,
    opts?: {
      language?: string;
      rate?: number;
      pitch?: number;
      volume?: number;
    },
  ): Promise<{ ok: boolean }>;
  stop?(): Promise<{ ok: boolean }>;
  isSpeaking?(): Promise<{ speaking: boolean }>;
  getAvailableLanguages?(): Promise<{ languages: string[] }>;
}

/** 应用管理 */
export interface AppManagerAdapter {
  isInstalled(packageName: string): Promise<{ installed: boolean }>;
  openApp(packageName: string, opts?: { data?: string }): Promise<{ opened: boolean }>;
  openAppStore?(appId?: string): Promise<{ opened: boolean }>;
  openAppSettings?(): Promise<{ opened: boolean }>;
  getInstalledApps?(): Promise<{
    apps: { packageName: string; appName: string; versionName?: string }[];
  }>;
}

/** 后台任务 */
export interface BackgroundTaskAdapter {
  start(taskKey: string, opts?: { timeout?: number }): Promise<{ taskId: number }>;
  stop(taskId: number): Promise<void>;
  isRunning?(taskKey: string): Promise<{ running: boolean }>;
}

/** 应用内评价 */
export interface InAppReviewAdapter {
  requestReview(): Promise<{ ok: boolean }>;
}

export type CapabilityAdapters = {
  scanner?: ScannerAdapter;
  camera?: CameraAdapter;
  media?: MediaAdapter;
  file?: FileAdapter;
  location?: LocationAdapter;
  notification?: NotificationAdapter;
  clipboard?: ClipboardAdapter;
  brightness?: BrightnessAdapter;
  flashlight?: FlashlightAdapter;
  sensor?: SensorAdapter;
  biometric?: BiometricAdapter;
  contacts?: ContactsAdapter;
  calendar?: CalendarAdapter;
  nfc?: NfcAdapter;
  bluetooth?: BluetoothAdapter;
  audio?: AudioAdapter;
  storage?: StorageAdapter;
  networkInfo?: NetworkInfoAdapter;
  qr?: QrAdapter;
  image?: ImageAdapter;
  haptics?: HapticsAdapter;
  speech?: SpeechAdapter;
  appManager?: AppManagerAdapter;
  backgroundTask?: BackgroundTaskAdapter;
  inAppReview?: InAppReviewAdapter;
};

/** 能力未接入时统一抛出 DEVICE_UNSUPPORTED（规则 15/16）。 */
export function requireAdapter<T>(adapter: T | undefined, name: string): T {
  if (!adapter) {
    throw new BridgeException('DEVICE_UNSUPPORTED', `${name} 能力未接入`);
  }
  return adapter;
}
