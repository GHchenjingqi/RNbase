/**
 * 文件与图片统一类型定义（Phase 11 / 规范 §20、§21、§22、§23）。
 *
 * 红线：大文件不走 Base64 穿桥，Bridge 只传元数据/URI，
 * 文件本体走 Native 文件能力或受控上传通道（规范 §23、§66）。
 */

/** 图片来源：相机 / 相册。 */
export type ImageSource = 'camera' | 'gallery';

/** 图片压缩配置（规范 §21）。 */
export type ImageCompressOptions = {
  /** 压缩质量 0-1，默认 0.8 */
  quality?: number;
  /** 最大宽度（像素），默认 1920 */
  maxWidth?: number;
  /** 最大高度（像素），默认 1920 */
  maxHeight?: number;
  /** 输出格式：jpeg / png / webp，默认 jpeg */
  format?: 'jpeg' | 'png' | 'webp';
  /** 是否校正 EXIF 方向，默认 true */
  fixOrientation?: boolean;
};

/** 图片元数据（Bridge 只传这些，不传 Base64）。 */
export type ImageAsset = {
  /** 临时文件 URI（Native 侧可访问） */
  uri: string;
  /** 文件名 */
  name: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 宽度（像素） */
  width: number;
  /** 高度（像素） */
  height: number;
  /** 来源 */
  source: ImageSource;
  /** 创建时间（ISO 8601） */
  createdAt: string;
};

/** 拍照/选图结果。 */
export type PickImageResult = {
  /** 选中的图片列表 */
  images: ImageAsset[];
  /** 用户是否取消 */
  cancelled: boolean;
};

/** 文件元数据（规范 §22）。 */
export type FileAsset = {
  /** 文件 URI（Native 侧可访问） */
  uri: string;
  /** 文件名 */
  name: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件扩展名 */
  extension: string;
};

/** 文件选择配置。 */
export type PickFileOptions = {
  /** 允许的 MIME 类型，如 ['application/pdf', 'image/*'] */
  accept?: string[];
  /** 是否允许多选，默认 false */
  multiple?: boolean;
  /** 最大文件大小（字节），默认 50MB */
  maxSize?: number;
};

/** 文件选择结果。 */
export type PickFileResult = {
  files: FileAsset[];
  cancelled: boolean;
};

/** 下载进度。 */
export type DownloadProgress = {
  /** 已下载字节 */
  downloaded: number;
  /** 总字节 */
  total: number;
  /** 进度百分比 0-100 */
  percent: number;
  /** 下载速度（字节/秒） */
  speed: number;
};

/** 下载配置。 */
export type DownloadOptions = {
  /** 下载 URL */
  url: string;
  /** 保存文件名（可选，默认从 URL 提取） */
  fileName?: string;
  /** 保存目录（可选，默认下载目录） */
  directory?: string;
  /** 进度回调 */
  onProgress?: (progress: DownloadProgress) => void;
  /** 是否显示系统通知，默认 true */
  showNotification?: boolean;
  /** 断点续传，默认 true */
  resumable?: boolean;
};

/** 下载结果。 */
export type DownloadResult = {
  /** 下载后的文件 URI */
  uri: string;
  /** 文件名 */
  name: string;
  /** 文件大小 */
  size: number;
};

/** 上传状态。 */
export type UploadStatus = 'pending' | 'uploading' | 'paused' | 'success' | 'failed' | 'cancelled';

/** 上传进度。 */
export type UploadProgress = {
  /** 已上传字节 */
  uploaded: number;
  /** 总字节 */
  total: number;
  /** 进度百分比 0-100 */
  percent: number;
  /** 上传速度（字节/秒） */
  speed: number;
};

/** 上传任务。 */
export type UploadTask = {
  /** 任务唯一 ID */
  id: string;
  /** 文件 URI */
  uri: string;
  /** 文件名 */
  name: string;
  /** 文件大小 */
  size: number;
  /** MIME 类型 */
  mimeType: string;
  /** 上传 URL */
  uploadUrl: string;
  /** 当前状态 */
  status: UploadStatus;
  /** 已上传字节 */
  uploaded: number;
  /** 进度回调 */
  onProgress?: (progress: UploadProgress) => void;
  /** 完成回调 */
  onComplete?: (result: UploadResult) => void;
  /** 失败回调 */
  onError?: (error: UploadError) => void;
  /** 重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 创建时间 */
  createdAt: number;
};

/** 上传结果。 */
export type UploadResult = {
  /** 任务 ID */
  taskId: string;
  /** 服务器返回的文件 URL */
  fileUrl: string;
  /** 文件大小 */
  size: number;
  /** 上传耗时（毫秒） */
  durationMs: number;
};

/** 上传错误。 */
export type UploadError = {
  /** 错误码 */
  code:
    | 'NETWORK_ERROR'
    | 'FILE_TOO_LARGE'
    | 'INVALID_TYPE'
    | 'UPLOAD_FAILED'
    | 'CANCELLED'
    | 'WEAK_NETWORK';
  /** 错误信息 */
  message: string;
  /** 任务 ID */
  taskId: string;
  /** 是否可重试 */
  retryable: boolean;
};

/** 上传队列配置。 */
export type UploadQueueOptions = {
  /** 最大并发数，默认 3 */
  maxConcurrent?: number;
  /** 单文件最大重试次数，默认 3 */
  maxRetries?: number;
  /** 弱网阈值（KB/s），低于此值触发弱网策略，默认 50 */
  weakNetworkThreshold?: number;
  /** 上传超时（毫秒），默认 120000 */
  timeoutMs?: number;
};

/** 上传前校验结果。 */
export type UploadValidationResult = {
  valid: boolean;
  error?: UploadError;
};

/** 平台适配器接口（Android/iOS 差异收敛）。 */
export type PlatformAdapter = {
  /** 拍照 */
  takePhoto(options?: ImageCompressOptions): Promise<PickImageResult>;
  /** 从相册选图 */
  pickFromGallery(options?: {
    multiple?: boolean;
    compress?: ImageCompressOptions;
  }): Promise<PickImageResult>;
  /** 压缩图片 */
  compressImage(uri: string, options: ImageCompressOptions): Promise<ImageAsset>;
  /** 预览图片 */
  previewImage(uris: string[], index?: number): Promise<void>;
  /** 保存图片到相册 */
  saveImage(uri: string): Promise<boolean>;
  /** 选择文件 */
  pickFile(options: PickFileOptions): Promise<PickFileResult>;
  /** 下载文件 */
  downloadFile(options: DownloadOptions): Promise<DownloadResult>;
  /** 打开文件 */
  openFile(uri: string, mimeType?: string): Promise<boolean>;
  /** 获取文件信息 */
  getFileInfo(uri: string): Promise<FileAsset | null>;
  /** 删除临时文件 */
  deleteTempFile(uri: string): Promise<boolean>;
  /** 清理临时目录 */
  clearTempFiles(): Promise<number>;
};
