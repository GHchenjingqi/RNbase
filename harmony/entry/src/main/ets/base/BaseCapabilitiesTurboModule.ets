/**
 * 鸿蒙侧 BaseCapabilities TurboModule。
 *
 * 方法名与返回体按 RNbase 的 JS 契约（`src/middleware/native/capability-native-adapters.ts`
 * 的 `BaseCapabilitiesNative`）对齐，而不是照抄安卓的 `BaseCapabilitiesModule.kt`：
 * RN 侧按「方法存在与否」挂载适配器，名字对不上就等于能力不存在。
 * 基座抽离时改过名：copy→clipboardSetString、paste→clipboardGetString、
 * openSystemSettings→appOpenSystemSettings。
 *
 * 已接通（全部走 OpenHarmony 公开 API）：
 * clipboardSetString / clipboardGetString / clipboardHasString / share /
 * appOpenSettings / appOpenSystemSettings / readFileAsBase64 / fileDownload /
 * fileOpen / setBadge / sendNotification / getCurrentPosition / takePhoto / pickImage /
 * saveImage / filePick / playSound / scan（Scan Kit 走懒加载，只在真机生效）。
 *
 * 故意「不注册」的方法（ArkTS 与 `cpp/BaseTurboModules.h` 同时删除）：
 * appInstalled（需系统级 GET_BUNDLE_INFO_PRIVILEGED）、appOpen / appOpenStore（鸿蒙无
 * 「按包名拉起」的公开入口）、nfcAvailable / nfcReadTag / nfcWriteNdef（需真机 NFC 标签，
 * 且读标签要 system API）。JS 侧取不到这些方法 → 对应能力报 DEVICE_UNSUPPORTED，
 * H5 直接把入口藏掉；比留一个只会 reject 的空壳更诚实。
 * share 在 ArkTS 侧保留可用，但 RNbase 的 share 走 RN 自带 Share API，不经过本模块。
 *
 * 拍照/选图/存图/文件选择会弹系统面板，提示音要出声，通知与定位要授权 —— 这些只能人工点，
 * 自检脚本不自动触发（见 src/diagnostics/harmony-native-self-test.ts 的注释）。
 */
import type Want from '@ohos.app.ability.Want';
import type { BusinessError } from '@ohos.base';
import fs from '@ohos.file.fs';
import geoLocationManager from '@ohos.geoLocationManager';
import notificationManager from '@ohos.notificationManager';
import pasteboard from '@ohos.pasteboard';
import request from '@ohos.request';
import util from '@ohos.util';
import { media } from '@kit.MediaKit';
import { camera, cameraPicker } from '@kit.CameraKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { picker } from '@kit.CoreFileKit';
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { abilityAccessCtrl, common, type Permissions } from '@kit.AbilityKit';
import { UITurboModule } from '@rnoh/react-native-openharmony';
import type { BaseScanResult } from './BaseScanCapability';

export interface BaseOkResult {
  ok: boolean;
}

/** JS 侧 clipboardGetString 读的是 text（不是 content）。 */
export interface BaseClipboardGetResult {
  text: string;
}

export interface BaseClipboardHasResult {
  has: boolean;
}

/** appOpenSettings / appOpenSystemSettings 的返回体，字段名与安卓一致。 */
export interface BaseOpenSettingsResult {
  opened: boolean;
}

export interface BaseReadFileResult {
  base64: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface BaseDownloadResult {
  uri: string;
}

export interface BaseOpenFileResult {
  opened: boolean;
}

export interface BasePositionResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  provider: string;
}

export interface BaseSendNotificationResult {
  ok: boolean;
  notificationId: number;
}

/** 选中/拍照后的文件描述，字段与 Android 侧 buildFileMap 一致。 */
export interface BaseFileItem {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface BaseFilesResult {
  files: BaseFileItem[];
}

export interface BaseTakePhotoResult {
  uri: string;
}

export interface BaseSaveImageResult {
  saved: boolean;
}

/** JS 侧 pickImage(opts) 传的是对象，不是裸 boolean（见 capabilityNativeAdapters.ts）。 */
export interface BaseImagePickOptions {
  multiple?: boolean;
}

export interface BaseFilePickOptions {
  accept?: string[];
  multiple?: boolean;
}

/** rawfile 里的提示音资源；Android 用系统默认通知音，鸿蒙无对应公开 API，只能内置。 */
const BEEP_ASSET_NAME: string = 'base_beep.wav';

const SETTINGS_BUNDLE: string = 'com.huawei.hmos.settings';
const SETTINGS_ABILITY: string = 'com.huawei.hmos.settings.MainAbility';

/** BusinessError 转可读文案：鸿蒙只给码，H5 侧需要看得懂的原因。 */
function describeError(error: Object, fallback: string): string {
  const biz: BusinessError = error as BusinessError;
  if (biz && biz.code !== undefined && biz.message) {
    return `${fallback}（code=${biz.code} ${biz.message}）`;
  }
  return `${fallback}：${error}`;
}

/** 后缀 → MIME；Android 侧用系统 MimeTypeMap，鸿蒙没有等价公开 API，这里覆盖基座用到的类型。 */
// ArkTS 不收对象字面量形式的 Map 初始化（arkts-no-untyped-obj-literals），故用链式 set 构造。
function buildMimeMap(): Map<string, string> {
  const map: Map<string, string> = new Map<string, string>();
  map.set('png', 'image/png');
  map.set('jpg', 'image/jpeg');
  map.set('jpeg', 'image/jpeg');
  map.set('gif', 'image/gif');
  map.set('webp', 'image/webp');
  map.set('bmp', 'image/bmp');
  map.set('txt', 'text/plain');
  map.set('json', 'application/json');
  map.set('pdf', 'application/pdf');
  map.set('mp4', 'video/mp4');
  return map;
}

const MIME_BY_SUFFIX: Map<string, string> = buildMimeMap();

function suffixOf(name: string): string {
  const dot: number = name.lastIndexOf('.');
  return dot >= 0 && dot < name.length - 1 ? name.substring(dot + 1).toLowerCase() : '';
}

function mimeTypeOf(name: string): string {
  const mime: string | undefined = MIME_BY_SUFFIX.get(suffixOf(name));
  return mime ? mime : 'application/octet-stream';
}

function baseNameOf(uri: string): string {
  const clean: string = uri.split('?')[0];
  const slash: number = clean.lastIndexOf('/');
  return slash >= 0 && slash < clean.length - 1 ? clean.substring(slash + 1) : 'file';
}

/**
 * fs 可读目标：`file:///data/...`（本机绝对路径写法）剥掉 scheme；
 * `file://media/...` 这类带授权的 uri 原样交给 fs（它自己解析），裸路径也原样。
 */
function toFsTarget(uri: string): string {
  const prefix: string = 'file://';
  if (uri.startsWith(`${prefix}/`)) {
    return uri.substring(prefix.length);
  }
  return uri;
}

export class BaseCapabilitiesTurboModule extends UITurboModule {
  public static readonly NAME: string = 'BaseCapabilities';

  // ===================== 剪贴板 =====================

  async clipboardSetString(text: string): Promise<BaseOkResult> {
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      await pasteboard.getSystemPasteboard().setData(data);
      const result: BaseOkResult = { ok: true };
      return result;
    } catch (error) {
      this.ctx.logger.error(`[BaseCapabilities] clipboardSetString 失败: ${error}`);
      throw new Error('复制失败');
    }
  }

  async clipboardGetString(): Promise<BaseClipboardGetResult> {
    try {
      const data: pasteboard.PasteData = await pasteboard.getSystemPasteboard().getData();
      const text: string | undefined = data.getPrimaryText();
      const result: BaseClipboardGetResult = { text: text ? text : '' };
      return result;
    } catch (error) {
      // 剪贴板为空时 getData 会抛，按 Android 的语义回空串而不是报错。
      // 模拟器实测：读取系统剪贴板会被 pasteboard 服务判为需要
      // ohos.permission.READ_PASTEBOARD（受限权限，上架要单独申请），日志留痕便于真机复查。
      this.ctx.logger.warn(`[BaseCapabilities] clipboardGetString 读取失败，按空内容返回: ${error}`);
      const result: BaseClipboardGetResult = { text: '' };
      return result;
    }
  }

  /**
   * 只探测「有没有文本」，不返回内容，因此不受 READ_PASTEBOARD 限制的读失败也算 false。
   * 这里复用 getData + getPrimaryText（本文件已验证可用的两个 API），不去调
   * SystemPasteboard.hasData()：该接口在不同 API 版本上的可用性不一致，宁可多一次读取。
   */
  async clipboardHasString(): Promise<BaseClipboardHasResult> {
    let has: boolean = false;
    try {
      const data: pasteboard.PasteData = await pasteboard.getSystemPasteboard().getData();
      has = (data.getPrimaryText() ?? '').length > 0;
    } catch (error) {
      this.ctx.logger.warn(`[BaseCapabilities] clipboardHasString 读取失败，按无内容返回: ${error}`);
      has = false;
    }
    const result: BaseClipboardHasResult = { has: has };
    return result;
  }

  // ===================== 系统分享面板 =====================

  async share(title: string, text: string, url: string): Promise<BaseOkResult> {
    // SharedData 的构造函数只收单条 record（`constructor(record: SharedRecord)`），
    // 所以第一条走构造、其余走 addRecord。
    let sharedData: systemShare.SharedData | null = null;
    if (text) {
      const record: systemShare.SharedRecord = {
        utd: utd.UniformDataType.PLAIN_TEXT,
        content: text,
        title: title,
      };
      sharedData = new systemShare.SharedData(record);
    }
    if (url) {
      const record: systemShare.SharedRecord = {
        utd: utd.UniformDataType.HYPERLINK,
        content: url,
        title: title,
      };
      if (sharedData) {
        sharedData.addRecord(record);
      } else {
        sharedData = new systemShare.SharedData(record);
      }
    }
    if (!sharedData) {
      throw new Error('分享内容不能为空');
    }
    try {
      const controller: systemShare.ShareController = new systemShare.ShareController(sharedData);
      const context: common.UIAbilityContext = this.ctx.uiAbilityContext as common.UIAbilityContext;
      await controller.show(context, {
        previewMode: systemShare.SharePreviewMode.DETAIL,
        selectionMode: systemShare.SelectionMode.BATCH,
      });
    } catch (error) {
      this.ctx.logger.error(`[BaseCapabilities] share 面板拉起失败: ${error}`);
      throw new Error('分享失败');
    }
    const result: BaseOkResult = { ok: true };
    return result;
  }

  // ===================== 跳转系统设置 =====================

  /**
   * 拉起设置应用。鸿蒙没有「按 action 跳设置子页」的公开入口，所以只有两档：
   * appDetail=true 进「本应用详情页」（settingsParamBundleName 参数），否则进设置首页。
   */
  private async startSettings(appDetail: boolean): Promise<BaseOpenSettingsResult> {
    const bundleName: string = this.ctx.uiAbilityContext.abilityInfo.bundleName;
    // ArkTS 不收 `Record` 的字面量初始化（arkts-no-untyped-obj-literals），先建空
    // Record 再按key赋值。
    const parameters: Record<string, Object> = {};
    parameters['settingsParamBundleName'] = bundleName;
    const want: Want = appDetail
      ? {
          bundleName: SETTINGS_BUNDLE,
          abilityName: SETTINGS_ABILITY,
          uri: 'application_info_entry',
          parameters: parameters,
        }
      : {
          bundleName: SETTINGS_BUNDLE,
          abilityName: SETTINGS_ABILITY,
        };
    try {
      await this.ctx.uiAbilityContext.startAbility(want);
    } catch (error) {
      this.ctx.logger.error(`[BaseCapabilities] 拉起设置失败(appDetail=${appDetail}): ${error}`);
      throw new Error('打开系统设置失败');
    }
    const result: BaseOpenSettingsResult = { opened: true };
    return result;
  }

  /** 本应用详情页：JS 侧 appManager.openAppSettings。 */
  async appOpenSettings(): Promise<BaseOpenSettingsResult> {
    return await this.startSettings(true);
  }

  /**
   * JS 侧 appManager.openSystemSettings(action)。wifi/bluetooth/location 等 action
   * 在鸿蒙无对应入口，一律落到设置首页；只有明确指向应用详情的 action 才进详情页。
   */
  async appOpenSystemSettings(action: string): Promise<BaseOpenSettingsResult> {
    const isAppDetail: boolean = !action || action === 'application_details' || action === 'notification';
    return await this.startSettings(isAppDetail);
  }

  // ===================== 文件读取 / 下载 / 打开 =====================

  /**
   * 读沙箱文件或 Picker 授权 uri，转 base64 交给 H5（契约同 Android）。
   * Android 侧图片会先压到 1024 边长再转码；鸿蒙的解码压缩要接 ImageKit，
   * 与选图面板同属一批（选图批次）一起做，这里先按原字节返回。
   */
  async readFileAsBase64(uri: string): Promise<BaseReadFileResult> {
    const target: string = toFsTarget(uri);
    let file: fs.File | null = null;
    try {
      file = fs.openSync(target, fs.OpenMode.READ_ONLY);
      const size: number = fs.statSync(file.fd).size;
      const buffer: ArrayBuffer = new ArrayBuffer(size);
      const read: number = fs.readSync(file.fd, buffer);
      const bytes: Uint8Array = new Uint8Array(buffer, 0, read);
      const base64: string = new util.Base64Helper().encodeToStringSync(bytes);
      const name: string = baseNameOf(uri);
      const result: BaseReadFileResult = {
        base64: base64,
        mimeType: mimeTypeOf(name),
        name: name,
        size: read,
      };
      return result;
    } catch (error) {
      throw new Error(describeError(error, '读取文件失败'));
    } finally {
      if (file !== null) {
        fs.closeSync(file);
      }
    }
  }

  /** 下载到 `<filesDir>/download`，返回 `file://` uri（Android 侧下 cacheDir，语义一致）。 */
  async fileDownload(url: string): Promise<BaseDownloadResult> {
    const dir: string = `${this.ctx.uiAbilityContext.filesDir}/download`;
    // 扩展名要跟着 URL 走：落成 .dat 会让图库拒绝保存（saveImage 报 14000011），
    // fileOpen 也按文件名猜 MIME，最后只会「暂无可用打开方式」。
    const ext: string = suffixOf(baseNameOf(url)) || 'dat';
    const filePath: string = `${dir}/erp_${Date.now()}.${ext}`;
    try {
      if (!fs.accessSync(dir)) {
        fs.mkdirSync(dir, true);
      }
      const config: request.DownloadConfig = { url: url, filePath: filePath };
      const task: request.DownloadTask = await request.downloadFile(this.ctx.uiAbilityContext, config);
      await new Promise<void>((resolve: () => void, reject: (reason: Error) => void): void => {
        task.on('complete', (): void => {
          resolve();
        });
        task.on('fail', (code: number): void => {
          reject(new Error(`下载失败 code=${code}`));
        });
      });
      task.remove((): void => {});
    } catch (error) {
      throw new Error(describeError(error, '下载失败'));
    }
    const result: BaseDownloadResult = { uri: `file://${filePath}` };
    return result;
  }

  /** 交给系统「能打开该类型的应用」；没有匹配应用时按 Android 语义回 opened:false。 */
  async fileOpen(uri: string): Promise<BaseOpenFileResult> {
    const openWant: Want = {
      action: 'ohos.want.action.viewData',
      uri: uri,
      type: mimeTypeOf(baseNameOf(uri)),
    };
    let opened: boolean = true;
    try {
      await this.ctx.uiAbilityContext.startAbility(openWant);
    } catch (error) {
      this.ctx.logger.warn(`[BaseCapabilities] fileOpen 无匹配应用: ${error}`);
      opened = false;
    }
    const result: BaseOpenFileResult = { opened: opened };
    return result;
  }

  // ===================== 通知与桌面角标 =====================

  /**
   * 桌面角标：`notificationManager.setBadgeNumber`（API 10，normal 级、免权限）即鸿蒙的
   * 正规入口，不需要 Android 那套「发通知触发厂商角标」的兜底。
   * 失败回 ok:false 而不抛错：H5 每次刷新未读数都会调它，报错会淹没设备日志。
   */
  async setBadge(count: number): Promise<BaseOkResult> {
    let ok: boolean = true;
    try {
      await notificationManager.setBadgeNumber(count);
    } catch (error) {
      this.ctx.logger.warn(`[BaseCapabilities] setBadge(${count}) 失败: ${error}`);
      ok = false;
    }
    const result: BaseOkResult = { ok: ok };
    return result;
  }

  /**
   * 未授权时 `requestEnableNotification` 会拉起系统授权弹窗，用户拒绝则抛 1600004。
   * @param payload 通知深链负载：仅为与安卓 `BaseCapabilitiesModule.kt` 保持同名同签名而收下，
   *   本端不解析也不做跳转（点击通知仍只打开 App）。RNOH 按位置实参派发，参数个数两端要对得上，
   *   所以 RN 侧加参时这里必须跟着加（含 BaseTurboModules.h 的 arity），不能靠 JS 的多余实参自动忽略。
   */
  async sendNotification(title: string, content: string, payload: string): Promise<BaseSendNotificationResult> {
    const notificationId: number = Date.now() % 100000;
    try {
      const enabled: boolean = await notificationManager.isNotificationEnabled();
      if (!enabled) {
        await notificationManager.requestEnableNotification(this.ctx.uiAbilityContext);
      }
      await notificationManager.addSlot(notificationManager.SlotType.SOCIAL_COMMUNICATION);
      const basic: notificationManager.NotificationBasicContent = {
        title: title ? title : '新消息',
        text: content,
        additionalText: content,
      };
      const notificationContent: notificationManager.NotificationContent = {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: basic,
      };
      const notifyRequest: notificationManager.NotificationRequest = {
        id: notificationId,
        content: notificationContent,
        notificationSlotType: notificationManager.SlotType.SOCIAL_COMMUNICATION,
        badgeNumber: 1,
      };
      await notificationManager.publish(notifyRequest);
    } catch (error) {
      throw new Error(describeError(error, '通知发送失败'));
    }
    const result: BaseSendNotificationResult = { ok: true, notificationId: notificationId };
    return result;
  }

  // ===================== 定位 =====================

  async getCurrentPosition(): Promise<BasePositionResult> {
    const permissions: Permissions[] = ['ohos.permission.APPROXIMATELY_LOCATION', 'ohos.permission.LOCATION'];
    let granted: boolean = false;
    try {
      const atManager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
      const permissionResult = await atManager.requestPermissionsFromUser(this.ctx.uiAbilityContext, permissions);
      granted = true;
      for (const state of permissionResult.authResults) {
        if (state !== 0) {
          granted = false;
        }
      }
    } catch (error) {
      this.ctx.logger.warn(`[BaseCapabilities] 定位授权弹窗失败: ${error}`);
      granted = false;
    }
    if (!granted) {
      throw new Error('定位权限被拒绝，请在设置中开启定位权限');
    }
    if (!geoLocationManager.isLocationEnabled()) {
      throw new Error('定位服务未开启，请在系统设置中开启定位');
    }
    const locationRequest: geoLocationManager.CurrentLocationRequest = {
      priority: geoLocationManager.LocationRequestPriority.FIRST_FIX,
      scenario: geoLocationManager.LocationRequestScenario.UNSET,
    };
    try {
      const location: geoLocationManager.Location = await geoLocationManager.getCurrentLocation(locationRequest);
      // 该 SDK 版本的 Location 没有 provider 字段，固定回 harmony 供 H5 区分来源。
      const result: BasePositionResult = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        provider: 'harmony',
      };
      return result;
    } catch (error) {
      throw new Error(describeError(error, '获取定位失败'));
    }
  }

  // ===================== 拍照 / 选图 / 存图 / 文件选择 =====================

  /**
   * 系统 Picker 返回的是带临时授权的 media/documents uri，H5 拿去 `<img src>` 或
   * readFileAsBase64 都不可靠；与 Android 的 copyToCacheDir 同因，统一复制进沙箱再回
   * `file://` 绝对路径。
   */
  private async copyIntoSandbox(uri: string, defaultSuffix: string): Promise<BaseFileItem> {
    const dir: string = `${this.ctx.uiAbilityContext.filesDir}/cache`;
    if (!fs.accessSync(dir)) {
      fs.mkdirSync(dir, true);
    }
    const srcName: string = baseNameOf(decodeURIComponent(uri));
    const ext: string = suffixOf(srcName);
    const name: string = `base_${Date.now()}.${ext.length > 0 ? ext : defaultSuffix}`;
    const target: string = `${dir}/${name}`;
    try {
      await fs.copyFile(uri, target);
    } catch (error) {
      throw new Error(describeError(error, '复制选中文件失败'));
    }
    const item: BaseFileItem = {
      uri: `file://${target}`,
      name: name,
      mimeType: mimeTypeOf(name),
      size: fs.statSync(target).size,
    };
    return item;
  }

  /** 系统相机面板（cameraPicker）；用户取消回 `{uri:''}`，与 Android 语义一致。 */
  async takePhoto(): Promise<BaseTakePhotoResult> {
    const profile: cameraPicker.PickerProfile = {
      cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK,
    };
    let uri: string = '';
    try {
      const picked: cameraPicker.PickerResult = await cameraPicker.pick(
        this.ctx.uiAbilityContext,
        [cameraPicker.PickerMediaType.PHOTO],
        profile,
      );
      if (!picked) {
        // 相机应用拉不起来时 pick 会 resolve 出 undefined（模拟器镜像没装
        // com.huawei.hmos.camera 实测如此），不兜住就抛 TypeError 把真实原因吃掉。
        throw new Error('相机未返回结果（相机应用不可用）');
      }
      if (picked.resultCode === 0 && picked.resultUri.length > 0) {
        uri = (await this.copyIntoSandbox(picked.resultUri, 'jpg')).uri;
      }
    } catch (error) {
      throw new Error(describeError(error, '拍照失败'));
    }
    const result: BaseTakePhotoResult = { uri: uri };
    return result;
  }

  async pickImage(opts: BaseImagePickOptions): Promise<BaseFilesResult> {
    const option: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions();
    option.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    option.maxSelectNumber = opts.multiple === true ? 9 : 1;
    const files: BaseFileItem[] = [];
    try {
      const viewPicker: photoAccessHelper.PhotoViewPicker = new photoAccessHelper.PhotoViewPicker();
      const picked: photoAccessHelper.PhotoSelectResult = await viewPicker.select(option);
      for (const uri of picked.photoUris) {
        files.push(await this.copyIntoSandbox(uri, 'jpg'));
      }
    } catch (error) {
      throw new Error(describeError(error, '相册选图失败'));
    }
    const result: BaseFilesResult = { files: files };
    return result;
  }

  /**
   * 存图到相册：三方应用免权限的唯一正规路径是 showAssetsCreationDialog（会弹系统确认框），
   * 用户取消则回 saved:false，不抛错。
   */
  async saveImage(uri: string): Promise<BaseSaveImageResult> {
    const helper: photoAccessHelper.PhotoAccessHelper =
      photoAccessHelper.getPhotoAccessHelper(this.ctx.uiAbilityContext);
    const srcName: string = baseNameOf(decodeURIComponent(uri));
    const ext: string = suffixOf(srcName);
    const config: photoAccessHelper.PhotoCreationConfig = {
      title: `base_${Date.now()}`,
      fileNameExtension: ext.length > 0 ? ext : 'png',
      photoType: photoAccessHelper.PhotoType.IMAGE,
    };
    let saved: boolean = false;
    try {
      const destUris: string[] = await helper.showAssetsCreationDialog([uri], [config]);
      if (destUris.length > 0) {
        const src: fs.File = fs.openSync(toFsTarget(uri), fs.OpenMode.READ_ONLY);
        const dest: fs.File = fs.openSync(destUris[0], fs.OpenMode.WRITE_ONLY);
        try {
          await fs.copyFile(src.fd, dest.fd);
          saved = true;
        } finally {
          fs.closeSync(src);
          fs.closeSync(dest);
        }
      }
    } catch (error) {
      throw new Error(describeError(error, '保存图片失败'));
    }
    const result: BaseSaveImageResult = { saved: saved };
    return result;
  }

  /**
   * 文件选择：DocumentViewPicker 的后缀过滤只认 `.png` 这种写法，H5 传 MIME（image/*）时忽略，
   * 让它退化成「全部文件」。
   */
  async filePick(opts: BaseFilePickOptions): Promise<BaseFilesResult> {
    const option: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
    option.maxSelectNumber = opts.multiple === true ? 9 : 1;
    const filters: string[] = [];
    const accept: string[] | undefined = opts.accept;
    if (accept !== undefined) {
      for (const item of accept) {
        if (item.startsWith('.')) {
          filters.push(item);
        }
      }
    }
    if (filters.length > 0) {
      option.fileSuffixFilters = filters;
    }
    const files: BaseFileItem[] = [];
    try {
      const docPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.ctx.uiAbilityContext);
      const uris: string[] = await docPicker.select(option);
      for (const uri of uris) {
        files.push(await this.copyIntoSandbox(uri, 'dat'));
      }
    } catch (error) {
      throw new Error(describeError(error, '文件选择失败'));
    }
    const result: BaseFilesResult = { files: files };
    return result;
  }

  // ===================== 提示音 =====================

  /**
   * Android 用 RingtoneManager 播系统默认通知音，鸿蒙对三方应用没有等价公开 API，
   * 所以内置一段 rawfile 短音（base_beep.wav）落沙箱后用 AVPlayer 播。
   * 与 Android 一致：拿到 fd 就立刻回 ok，不阻塞等播放完成，duration 到点强制停止。
   */
  async playSound(duration: number): Promise<BaseOkResult> {
    const stopAfterMs: number = duration > 0 ? duration : 3000;
    const path: string = `${this.ctx.uiAbilityContext.cacheDir}/${BEEP_ASSET_NAME}`;
    let file: fs.File | null = null;
    try {
      const raw: Uint8Array = await this.ctx.uiAbilityContext.resourceManager.getRawFileContent(BEEP_ASSET_NAME);
      const buffer: ArrayBuffer = new ArrayBuffer(raw.length);
      const view: Uint8Array = new Uint8Array(buffer);
      view.set(raw);
      file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, buffer);
      const handle: fs.File = file;
      const length: number = fs.statSync(handle.fd).size;
      const player: media.AVPlayer = await media.createAVPlayer();
      let released: boolean = false;
      const release = (): void => {
        if (released) {
          return;
        }
        released = true;
        player.off('stateChange');
        player.off('error');
        player.release().catch((): void => {});
        fs.closeSync(handle);
      };
      player.on('error', (): void => {
        release();
      });
      player.on('stateChange', (state: string): void => {
        if (state === 'initialized') {
          player.prepare().catch((): void => {
            release();
          });
        } else if (state === 'prepared') {
          player.play().catch((): void => {
            release();
          });
        } else if (state === 'completed') {
          release();
        }
      });
      const source: media.AVFileDescriptor = { fd: handle.fd, length: length };
      player.fdSrc = source;
      setTimeout((): void => {
        if (!released) {
          player.stop().then((): void => {
            release();
          }).catch((): void => {
            release();
          });
        }
      }, stopAfterMs);
      file = null;
    } catch (error) {
      if (file !== null) {
        fs.closeSync(file);
      }
      throw new Error(describeError(error, '提示音播放失败'));
    }
    const result: BaseOkResult = { ok: true };
    return result;
  }

  // ===================== 扫码（HMS 能力，按需加载） =====================

  /**
   * Scan Kit 属于 HMS SDK，OpenHarmony 运行时（本机模拟器）里根本没有对应 native 模块，
   * 所以实现单独放 BaseScanCapability.ets 并用 import() 懒加载：真机上正常调用，
   * 模拟器上只有点扫码才失败，不会在启动阶段拖垮整个 BaseCapabilities。
   */
  async scan(formats: string[]): Promise<BaseScanResult> {
    const mod: ESObject = await import('./BaseScanCapability');
    const scanWithScanKit: (context: common.UIAbilityContext, formats: string[]) => Promise<BaseScanResult> =
      mod.scanWithScanKit;
    return await scanWithScanKit(this.ctx.uiAbilityContext, formats);
  }
}
