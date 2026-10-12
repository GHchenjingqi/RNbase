/**
 * Mock 平台适配器（Phase 11 / 规范 §20、§21、§22）。
 *
 * 用于开发和测试，模拟 Android/iOS 原生能力。
 * 生产环境替换为真实实现（react-native-image-picker、react-native-fs 等）。
 */
import type {
  DownloadOptions,
  DownloadResult,
  FileAsset,
  ImageAsset,
  ImageCompressOptions,
  PickFileOptions,
  PickFileResult,
  PickImageResult,
  PlatformAdapter,
} from './types';

let mockIdCounter = 0;
function nextMockId(): string {
  mockIdCounter += 1;
  return `mock_${Date.now()}_${mockIdCounter}`;
}

function createMockImage(
  source: 'camera' | 'gallery',
  compress?: ImageCompressOptions,
): ImageAsset {
  const width = compress?.maxWidth ?? 1920;
  const height = compress?.maxHeight ?? 1920;
  const quality = compress?.quality ?? 0.8;
  const format = compress?.format ?? 'jpeg';
  const baseSize = width * height * 0.3; // 估算
  const size = Math.round(baseSize * quality);
  return {
    uri: `file:///mock/temp/${nextMockId()}.${format}`,
    name: `image_${Date.now()}.${format}`,
    mimeType: `image/${format}`,
    size,
    width,
    height,
    source,
    createdAt: new Date().toISOString(),
  };
}

function createMockFile(extension = 'pdf', mimeType = 'application/pdf'): FileAsset {
  return {
    uri: `file:///mock/temp/${nextMockId()}.${extension}`,
    name: `file_${Date.now()}.${extension}`,
    mimeType,
    size: Math.round(Math.random() * 5 * 1024 * 1024) + 1024, // 1KB - 5MB
    extension,
  };
}

export function createMockPlatformAdapter(): PlatformAdapter {
  const tempFiles = new Set<string>();

  return {
    async takePhoto(options?: ImageCompressOptions): Promise<PickImageResult> {
      const image = createMockImage('camera', options);
      tempFiles.add(image.uri);
      return { images: [image], cancelled: false };
    },

    async pickFromGallery(options?: {
      multiple?: boolean;
      compress?: ImageCompressOptions;
    }): Promise<PickImageResult> {
      const count = options?.multiple ? Math.floor(Math.random() * 3) + 1 : 1;
      const images: ImageAsset[] = [];
      for (let i = 0; i < count; i++) {
        const image = createMockImage('gallery', options?.compress);
        images.push(image);
        tempFiles.add(image.uri);
      }
      return { images, cancelled: false };
    },

    async compressImage(uri: string, options: ImageCompressOptions): Promise<ImageAsset> {
      const image = createMockImage('gallery', options);
      image.uri = uri.replace(/\.[^.]+$/, `.${options.format ?? 'jpeg'}`);
      return image;
    },

    async previewImage(_uris: string[], _index?: number): Promise<void> {
      // Mock: 无操作
    },

    async saveImage(_uri: string): Promise<boolean> {
      return true;
    },

    async pickFile(options: PickFileOptions): Promise<PickFileResult> {
      const count = options.multiple ? Math.floor(Math.random() * 2) + 1 : 1;
      const files: FileAsset[] = [];
      const types = options.accept ?? ['application/pdf'];
      for (let i = 0; i < count; i++) {
        const mimeType = types[Math.floor(Math.random() * types.length)];
        const ext = mimeType.split('/')[1] ?? 'bin';
        const file = createMockFile(ext, mimeType);
        if (!options.maxSize || file.size <= options.maxSize) {
          files.push(file);
          tempFiles.add(file.uri);
        }
      }
      return { files, cancelled: false };
    },

    async downloadFile(options: DownloadOptions): Promise<DownloadResult> {
      const fileName = options.fileName ?? options.url.split('/').pop() ?? 'download.bin';
      const uri = `file:///mock/downloads/${fileName}`;
      const size = Math.round(Math.random() * 10 * 1024 * 1024) + 1024;

      // 模拟进度
      if (options.onProgress) {
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          options.onProgress({
            downloaded: Math.round((size * i) / steps),
            total: size,
            percent: i * 10,
            speed: Math.round(size / 1000),
          });
        }
      }

      return { uri, name: fileName, size };
    },

    async openFile(_uri: string, _mimeType?: string): Promise<boolean> {
      return true;
    },

    async getFileInfo(uri: string): Promise<FileAsset | null> {
      if (tempFiles.has(uri)) {
        const ext = uri.split('.').pop() ?? 'bin';
        return {
          uri,
          name: uri.split('/').pop() ?? 'file',
          mimeType: `application/${ext}`,
          size: Math.round(Math.random() * 5 * 1024 * 1024) + 1024,
          extension: ext,
        };
      }
      return null;
    },

    async deleteTempFile(uri: string): Promise<boolean> {
      return tempFiles.delete(uri);
    },

    async clearTempFiles(): Promise<number> {
      const count = tempFiles.size;
      tempFiles.clear();
      return count;
    },
  };
}
