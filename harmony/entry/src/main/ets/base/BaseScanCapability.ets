/**
 * 扫码（Scan Kit）。
 *
 * 单独成文件只为隔离风险：Scan Kit 属于 HMS SDK，OpenHarmony 运行时（本机模拟器）里没有
 * 对应实现。若在 BaseCapabilitiesTurboModule.ets 里静态 import，模块加载失败会连带剪贴板、
 * 日志、文件等全部能力一起挂掉；因此那边用 `import('./BaseScanCapability')` 懒加载，
 * 只有真机点「扫码」时才解析本文件。
 */
import { scanBarcode, scanCore } from '@kit.ScanKit';
import type { BusinessError } from '@ohos.base';
import { common } from '@kit.AbilityKit';

export interface BaseScanResult {
  code: string;
  format: string;
}

/** 取消扫码的固定文案：H5 侧按 message 判断是否用户主动取消，不弹错误提示。 */
const CANCELLED: string = '用户取消扫码';

/**
 * H5/Android 用的是 ZXing 的码制名（QR_CODE / EAN_13 / CODE_128 ...），
 * 鸿蒙用 scanCore.ScanType 枚举；大小写、下划线都兼容，识别不了的回退 ALL。
 */
function toScanType(format: string): scanCore.ScanType | null {
  const key: string = format.replace(/[_\s-]/g, '').toUpperCase();
  if (key === 'QR' || key === 'QRCODE') {
    return scanCore.ScanType.QR_CODE;
  }
  if (key === 'DATAMATRIX' || key === 'DATAMATRIXCODE') {
    return scanCore.ScanType.DATAMATRIX_CODE;
  }
  if (key === 'EAN13' || key === 'EAN13CODE') {
    return scanCore.ScanType.EAN13_CODE;
  }
  if (key === 'EAN8' || key === 'EAN8CODE') {
    return scanCore.ScanType.EAN8_CODE;
  }
  if (key === 'UPCA' || key === 'UPCACODE') {
    return scanCore.ScanType.UPC_A_CODE;
  }
  if (key === 'UPCE' || key === 'UPCECODE') {
    return scanCore.ScanType.UPC_E_CODE;
  }
  if (key === 'CODE39' || key === 'CODE39CODE') {
    return scanCore.ScanType.CODE39_CODE;
  }
  if (key === 'CODE93' || key === 'CODE93CODE') {
    return scanCore.ScanType.CODE93_CODE;
  }
  if (key === 'CODE128' || key === 'CODE128CODE') {
    return scanCore.ScanType.CODE128_CODE;
  }
  if (key === 'CODABAR' || key === 'CODABARCODE') {
    return scanCore.ScanType.CODABAR_CODE;
  }
  if (key === 'ITF' || key === 'ITF14' || key === 'ITF14CODE') {
    return scanCore.ScanType.ITF14_CODE;
  }
  if (key === 'PDF417' || key === 'PDF417CODE') {
    return scanCore.ScanType.PDF417_CODE;
  }
  if (key === 'AZTEC' || key === 'AZTECCODE') {
    return scanCore.ScanType.AZTEC_CODE;
  }
  if (key === 'ONED' || key === 'BARCODE') {
    return scanCore.ScanType.ONE_D_CODE;
  }
  if (key === 'TWOD') {
    return scanCore.ScanType.TWO_D_CODE;
  }
  if (key === 'ALL') {
    return scanCore.ScanType.ALL;
  }
  return null;
}

function scanTypeName(type: scanCore.ScanType): string {
  switch (type) {
    case scanCore.ScanType.QR_CODE:
      return 'QR_CODE';
    case scanCore.ScanType.DATAMATRIX_CODE:
      return 'DATA_MATRIX';
    case scanCore.ScanType.EAN13_CODE:
      return 'EAN_13';
    case scanCore.ScanType.EAN8_CODE:
      return 'EAN_8';
    case scanCore.ScanType.UPC_A_CODE:
      return 'UPC_A';
    case scanCore.ScanType.UPC_E_CODE:
      return 'UPC_E';
    case scanCore.ScanType.CODE39_CODE:
      return 'CODE_39';
    case scanCore.ScanType.CODE93_CODE:
      return 'CODE_93';
    case scanCore.ScanType.CODE128_CODE:
      return 'CODE_128';
    case scanCore.ScanType.CODABAR_CODE:
      return 'CODABAR';
    case scanCore.ScanType.ITF14_CODE:
      return 'ITF';
    case scanCore.ScanType.PDF417_CODE:
      return 'PDF_417';
    case scanCore.ScanType.AZTEC_CODE:
      return 'AZTEC';
    case scanCore.ScanType.ONE_D_CODE:
      return 'ONE_D';
    case scanCore.ScanType.TWO_D_CODE:
      return 'TWO_D';
    default:
      return 'ALL';
  }
}

/** Scan Kit 的取消码；其它错误按「扫码失败」原样带码抛出。 */
const CODE_CANCELLED: number = 1000500002;

export async function scanWithScanKit(
  context: common.UIAbilityContext,
  formats: string[],
): Promise<BaseScanResult> {
  const types: scanCore.ScanType[] = [];
  if (formats !== undefined && formats !== null) {
    for (const item of formats) {
      const mapped: scanCore.ScanType | null = toScanType(item);
      if (mapped !== null) {
        types.push(mapped);
      }
    }
  }
  const options: scanBarcode.ScanOptions = {
    scanTypes: types.length > 0 ? types : [scanCore.ScanType.ALL],
    enableMultiMode: false,
    enableAlbum: true,
  };
  let scanned: scanBarcode.ScanResult;
  try {
    scanned = await scanBarcode.startScanForResult(context, options);
  } catch (error) {
    const biz: BusinessError = error as BusinessError;
    if (biz && biz.code === CODE_CANCELLED) {
      throw new Error(CANCELLED);
    }
    throw new Error(`扫码失败（code=${biz ? biz.code : 'unknown'} ${biz ? biz.message : error}）`);
  }
  const result: BaseScanResult = {
    code: scanned.originalValue,
    format: scanTypeName(scanned.scanType),
  };
  return result;
}
