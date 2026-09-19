/**
 * 图片服务（Phase 11 / 规范 §20、§21、§23、§52、§53）。
 *
 * 职责：
 *  - 拍照/相册统一入口
 *  - 图片压缩（质量、最大尺寸、EXIF 方向校正）
 *  - 多选、预览、保存
 *  - 内存控制（避免大图 OOM）
 *
 * 红线：Bridge 只传 URI/元数据，不传 Base64（规范 §23）。
 */
import type { PlatformAdapter } from './types';
import {
  MEDIA_IMAGE_DEFAULT_COMPRESS,
  MEDIA_IMAGE_MAX_COUNT,
  MEDIA_IMAGE_MAX_SIZE,
} from '../config';
import type { ImageAsset, ImageCompressOptions, ImageSource, PickImageResult } from './types';

export type ImageServiceOptions = {
  adapter: PlatformAdapter;
  /** 默认压缩配置 */
  defaultCompress?: ImageCompressOptions;
  /** 最大图片数量（多选），默认 9 */
  maxImages?: number;
  /** 单张图片最大尺寸（字节），默认 10MB */
  maxImageSize?: number;
};

export class ImageService {
  private readonly options: Required<Omit<ImageServiceOptions, 'defaultCompress'>> & {
    defaultCompress: Required<ImageCompressOptions>;
  };

  constructor(options: ImageServiceOptions) {
    this.options = {
      adapter: options.adapter,
      defaultCompress: {
        ...MEDIA_IMAGE_DEFAULT_COMPRESS,
        ...options.defaultCompress,
      },
      maxImages: options.maxImages ?? MEDIA_IMAGE_MAX_COUNT,
      maxImageSize: options.maxImageSize ?? MEDIA_IMAGE_MAX_SIZE,
    };
  }

  /** 拍照（自动压缩）。 */
  async takePhoto(compress?: ImageCompressOptions): Promise<PickImageResult> {
    const options = { ...this.options.defaultCompress, ...compress };
    const result = await this.options.adapter.takePhoto(options);
    return this.validateAndCompress(result, options);
  }

  /** 从相册选图（支持多选，自动压缩）。 */
  async pickFromGallery(options?: {
    multiple?: boolean;
    compress?: ImageCompressOptions;
    maxCount?: number;
  }): Promise<PickImageResult> {
    const compress = { ...this.options.defaultCompress, ...options?.compress };
    const maxCount = options?.maxCount ?? this.options.maxImages;
    const result = await this.options.adapter.pickFromGallery({
      multiple: options?.multiple ?? false,
      compress,
    });

    // 限制数量
    if (result.images.length > maxCount) {
      result.images = result.images.slice(0, maxCount);
    }

    return this.validateAndCompress(result, compress);
  }

  /** 统一入口：拍照或相册。 */
  async pickImage(
    source: ImageSource,
    options?: { multiple?: boolean; compress?: ImageCompressOptions },
  ): Promise<PickImageResult> {
    if (source === 'camera') {
      return this.takePhoto(options?.compress);
    }
    return this.pickFromGallery({
      multiple: options?.multiple,
      compress: options?.compress,
    });
  }

  /** 压缩单张图片。 */
  async compress(uri: string, options?: ImageCompressOptions): Promise<ImageAsset> {
    const compressOptions = { ...this.options.defaultCompress, ...options };
    return this.options.adapter.compressImage(uri, compressOptions);
  }

  /** 预览图片。 */
  async preview(uris: string[], index = 0): Promise<void> {
    return this.options.adapter.previewImage(uris, index);
  }

  /** 保存图片到相册。 */
  async save(uri: string): Promise<boolean> {
    return this.options.adapter.saveImage(uri);
  }

  /** 校验图片大小，超过上限返回错误。 */
  validateSize(image: ImageAsset): { valid: boolean; reason?: string } {
    if (image.size > this.options.maxImageSize) {
      return {
        valid: false,
        reason: `图片大小 ${(image.size / 1024 / 1024).toFixed(2)}MB 超过上限 ${(
          this.options.maxImageSize /
          1024 /
          1024
        ).toFixed(0)}MB`,
      };
    }
    return { valid: true };
  }

  /** 清理临时图片文件。 */
  async clearTempImages(images: ImageAsset[]): Promise<number> {
    let count = 0;
    for (const image of images) {
      if (await this.options.adapter.deleteTempFile(image.uri)) {
        count += 1;
      }
    }
    return count;
  }

  /** 清理所有临时文件。 */
  async clearAllTemp(): Promise<number> {
    return this.options.adapter.clearTempFiles();
  }

  private async validateAndCompress(
    result: PickImageResult,
    compress: Required<ImageCompressOptions>,
  ): Promise<PickImageResult> {
    if (result.cancelled || result.images.length === 0) {
      return result;
    }

    const validImages: ImageAsset[] = [];
    for (const image of result.images) {
      const validation = this.validateSize(image);
      if (!validation.valid) {
        // 尝试压缩
        try {
          const compressed = await this.options.adapter.compressImage(image.uri, compress);
          const compressedValidation = this.validateSize(compressed);
          if (compressedValidation.valid) {
            validImages.push(compressed);
          }
        } catch {
          // 压缩失败，跳过
        }
      } else {
        validImages.push(image);
      }
    }

    return { ...result, images: validImages };
  }
}
