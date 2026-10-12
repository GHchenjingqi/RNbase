/**
 * 文件服务（Phase 11 / 规范 §22）。
 *
 * 职责：
 *  - file.pick 统一选择（name/size/mimeType/uri 元数据）
 *  - file.download 下载到受控目录、进度、通知、断点策略
 *  - file.open 系统能力打开，处理无可用应用/权限问题
 *  - Android Scoped Storage、iOS 文件访问与权限差异收敛到 platform adapter
 *
 * 红线：Bridge 只传 URI/元数据，不传 Base64（规范 §23）。
 */
import type { PlatformAdapter } from './types';
import { MEDIA_FILE_MAX_SIZE, MEDIA_FILE_ALLOWED_TYPES } from '../config';
import type {
  DownloadOptions,
  DownloadResult,
  FileAsset,
  PickFileOptions,
  PickFileResult,
} from './types';

export type FileServiceOptions = {
  adapter: PlatformAdapter;
  /** 最大文件大小（字节），默认 50MB */
  maxFileSize?: number;
  /** 允许的文件类型（MIME），默认全部允许 */
  allowedTypes?: string[];
};

export class FileService {
  private readonly options: Required<FileServiceOptions>;

  constructor(options: FileServiceOptions) {
    this.options = {
      adapter: options.adapter,
      maxFileSize: options.maxFileSize ?? MEDIA_FILE_MAX_SIZE,
      allowedTypes: options.allowedTypes ?? MEDIA_FILE_ALLOWED_TYPES,
    };
  }

  /** 选择文件（统一入口）。 */
  async pick(options?: PickFileOptions): Promise<PickFileResult> {
    const pickOptions: PickFileOptions = {
      accept: options?.accept ?? this.options.allowedTypes,
      multiple: options?.multiple ?? false,
      maxSize: options?.maxSize ?? this.options.maxFileSize,
    };

    const result = await this.options.adapter.pickFile(pickOptions);

    // 校验文件
    const validFiles: FileAsset[] = [];
    for (const file of result.files) {
      const validation = this.validateFile(file, pickOptions);
      if (validation.valid) {
        validFiles.push(file);
      }
    }

    return { ...result, files: validFiles };
  }

  /** 下载文件（带进度）。 */
  async download(options: DownloadOptions): Promise<DownloadResult> {
    return this.options.adapter.downloadFile(options);
  }

  /** 打开文件（系统能力）。 */
  async open(uri: string, mimeType?: string): Promise<boolean> {
    return this.options.adapter.openFile(uri, mimeType);
  }

  /** 获取文件信息。 */
  async getInfo(uri: string): Promise<FileAsset | null> {
    return this.options.adapter.getFileInfo(uri);
  }

  /** 删除临时文件。 */
  async deleteTemp(uri: string): Promise<boolean> {
    return this.options.adapter.deleteTempFile(uri);
  }

  /** 清理所有临时文件。 */
  async clearAllTemp(): Promise<number> {
    return this.options.adapter.clearTempFiles();
  }

  /** 校验文件（类型、大小）。 */
  validateFile(file: FileAsset, options?: PickFileOptions): { valid: boolean; reason?: string } {
    const maxSize = options?.maxSize ?? this.options.maxFileSize;
    const accept = options?.accept ?? this.options.allowedTypes;

    // 大小校验
    if (file.size > maxSize) {
      return {
        valid: false,
        reason: `文件大小 ${(file.size / 1024 / 1024).toFixed(2)}MB 超过上限 ${(
          maxSize /
          1024 /
          1024
        ).toFixed(0)}MB`,
      };
    }

    // 类型校验
    if (accept && accept.length > 0 && !accept.includes('*/*')) {
      const isAllowed = accept.some(type => {
        if (type.endsWith('/*')) {
          return file.mimeType.startsWith(type.replace('/*', '/'));
        }
        return file.mimeType === type;
      });
      if (!isAllowed) {
        return {
          valid: false,
          reason: `文件类型 ${file.mimeType} 不在允许列表中`,
        };
      }
    }

    return { valid: true };
  }

  /** 格式化文件大小。 */
  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  }
}
