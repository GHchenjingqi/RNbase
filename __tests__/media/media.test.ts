/**
 * Phase 11：文件与图片单元测试（规范 §20、§21、§22、§23）。
 */
import { ImageService } from '../../src/media/image-service';
import { FileService } from '../../src/media/file-service';
import { UploadQueue, createMockUploader } from '../../src/media/upload-queue';
import { createMockPlatformAdapter } from '../../src/media/mock-adapter';
import type { ImageAsset, FileAsset } from '../../src/media/types';

describe('P11.1 图片服务', () => {
  let adapter: ReturnType<typeof createMockPlatformAdapter>;
  let imageService: ImageService;

  beforeEach(() => {
    adapter = createMockPlatformAdapter();
    imageService = new ImageService({
      adapter,
      maxImages: 9,
      maxImageSize: 10 * 1024 * 1024,
    });
  });

  test('拍照返回压缩后的图片', async () => {
    const result = await imageService.takePhoto({
      quality: 0.5,
      maxWidth: 1024,
    });
    expect(result.cancelled).toBe(false);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].source).toBe('camera');
    expect(result.images[0].width).toBe(1024);
    expect(result.images[0].uri).toMatch(/^file:\/\//);
  });

  test('从相册选图（单选）', async () => {
    const result = await imageService.pickFromGallery({ multiple: false });
    expect(result.cancelled).toBe(false);
    expect(result.images.length).toBeGreaterThanOrEqual(1);
    expect(result.images[0].source).toBe('gallery');
  });

  test('从相册选图（多选，限制数量）', async () => {
    const result = await imageService.pickFromGallery({
      multiple: true,
      maxCount: 2,
    });
    expect(result.images.length).toBeLessThanOrEqual(2);
  });

  test('统一入口 pickImage', async () => {
    const cameraResult = await imageService.pickImage('camera');
    expect(cameraResult.images[0].source).toBe('camera');

    const galleryResult = await imageService.pickImage('gallery');
    expect(galleryResult.images[0].source).toBe('gallery');
  });

  test('压缩图片', async () => {
    const result = await imageService.takePhoto();
    const compressed = await imageService.compress(result.images[0].uri, {
      quality: 0.3,
      maxWidth: 800,
      maxHeight: 800,
    });
    expect(compressed.width).toBe(800);
    expect(compressed.height).toBe(800);
  });

  test('预览图片', async () => {
    await expect(imageService.preview(['file:///test.jpg'])).resolves.toBeUndefined();
  });

  test('保存图片', async () => {
    const result = await imageService.save('file:///test.jpg');
    expect(result).toBe(true);
  });

  test('校验图片大小', () => {
    const smallImage: ImageAsset = {
      uri: 'file:///small.jpg',
      name: 'small.jpg',
      mimeType: 'image/jpeg',
      size: 1024 * 1024,
      width: 100,
      height: 100,
      source: 'gallery',
      createdAt: new Date().toISOString(),
    };
    expect(imageService.validateSize(smallImage).valid).toBe(true);

    const largeImage: ImageAsset = { ...smallImage, size: 20 * 1024 * 1024 };
    const result = imageService.validateSize(largeImage);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('超过上限');
  });

  test('清理临时图片', async () => {
    const result = await imageService.takePhoto();
    const count = await imageService.clearTempImages(result.images);
    expect(count).toBe(1);
  });

  test('清理所有临时文件', async () => {
    await imageService.takePhoto();
    await imageService.takePhoto();
    const count = await imageService.clearAllTemp();
    expect(count).toBe(2);
  });

  test('默认压缩配置', async () => {
    const service = new ImageService({
      adapter,
      defaultCompress: {
        quality: 0.6,
        maxWidth: 1280,
        maxHeight: 1280,
        format: 'webp',
      },
    });
    const result = await service.takePhoto();
    expect(result.images[0].width).toBe(1280);
    expect(result.images[0].mimeType).toBe('image/webp');
  });
});

describe('P11.2 文件服务', () => {
  let adapter: ReturnType<typeof createMockPlatformAdapter>;
  let fileService: FileService;

  beforeEach(() => {
    adapter = createMockPlatformAdapter();
    fileService = new FileService({ adapter, maxFileSize: 50 * 1024 * 1024 });
  });

  test('选择文件（单选）', async () => {
    const result = await fileService.pick({ multiple: false });
    expect(result.cancelled).toBe(false);
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(result.files[0].uri).toMatch(/^file:\/\//);
    expect(result.files[0].name).toBeDefined();
    expect(result.files[0].size).toBeGreaterThan(0);
    expect(result.files[0].mimeType).toBeDefined();
  });

  test('选择文件（多选）', async () => {
    const result = await fileService.pick({ multiple: true });
    expect(result.files.length).toBeGreaterThanOrEqual(1);
  });

  test('选择文件（限制类型）', async () => {
    const result = await fileService.pick({ accept: ['application/pdf'] });
    for (const file of result.files) {
      expect(file.mimeType).toBe('application/pdf');
    }
  });

  test('下载文件（带进度）', async () => {
    const progressEvents: number[] = [];
    const result = await fileService.download({
      url: 'https://example.com/file.pdf',
      fileName: 'test.pdf',
      onProgress: progress => progressEvents.push(progress.percent),
    });
    expect(result.uri).toMatch(/^file:\/\//);
    expect(result.name).toBe('test.pdf');
    expect(result.size).toBeGreaterThan(0);
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1]).toBe(100);
  });

  test('打开文件', async () => {
    const result = await fileService.open('file:///test.pdf', 'application/pdf');
    expect(result).toBe(true);
  });

  test('获取文件信息', async () => {
    const pickResult = await fileService.pick();
    const info = await fileService.getInfo(pickResult.files[0].uri);
    expect(info).not.toBeNull();
    expect(info?.uri).toBe(pickResult.files[0].uri);
  });

  test('删除临时文件', async () => {
    const pickResult = await fileService.pick();
    const result = await fileService.deleteTemp(pickResult.files[0].uri);
    expect(result).toBe(true);
  });

  test('校验文件大小', () => {
    const smallFile: FileAsset = {
      uri: 'file:///small.pdf',
      name: 'small.pdf',
      mimeType: 'application/pdf',
      size: 1024 * 1024,
      extension: 'pdf',
    };
    expect(fileService.validateFile(smallFile).valid).toBe(true);

    const largeFile: FileAsset = { ...smallFile, size: 60 * 1024 * 1024 };
    const result = fileService.validateFile(largeFile);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('超过上限');
  });

  test('校验文件类型', () => {
    const pdfFile: FileAsset = {
      uri: 'file:///test.pdf',
      name: 'test.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      extension: 'pdf',
    };
    expect(fileService.validateFile(pdfFile, { accept: ['application/pdf'] }).valid).toBe(true);
    expect(fileService.validateFile(pdfFile, { accept: ['image/*'] }).valid).toBe(false);
  });

  test('通配符类型校验', () => {
    const imageFile: FileAsset = {
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      extension: 'jpg',
    };
    expect(fileService.validateFile(imageFile, { accept: ['image/*'] }).valid).toBe(true);
  });

  test('格式化文件大小', () => {
    expect(fileService.formatSize(512)).toBe('512B');
    expect(fileService.formatSize(2048)).toBe('2.0KB');
    expect(fileService.formatSize(5 * 1024 * 1024)).toBe('5.0MB');
    expect(fileService.formatSize(2 * 1024 * 1024 * 1024)).toBe('2.00GB');
  });
});

describe('P11.3 上传队列', () => {
  let adapter: ReturnType<typeof createMockPlatformAdapter>;
  let uploadQueue: UploadQueue;

  beforeEach(() => {
    adapter = createMockPlatformAdapter();
    const uploader = createMockUploader({ delayMs: 50 });
    uploadQueue = new UploadQueue(uploader, adapter, {
      maxConcurrent: 2,
      maxRetries: 3,
    });
  });

  test('添加单个上传任务', async () => {
    const task = uploadQueue.addTask({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024 * 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    expect(task.id).toBeDefined();
    expect(task.status).toBe('pending');
    expect(task.size).toBe(1024 * 1024);
  });

  test('上传任务完成', async () => {
    const onComplete = jest.fn();
    uploadQueue.addTask({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024 * 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
      onComplete,
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(onComplete).toHaveBeenCalled();
    const result = onComplete.mock.calls[0][0];
    expect(result.fileUrl).toContain('https://mock-cdn.example.com');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test('上传进度回调', async () => {
    const progressEvents: number[] = [];
    uploadQueue.addTask({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024 * 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
      onProgress: progress => progressEvents.push(progress.percent),
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1]).toBe(100);
  });

  test('批量添加任务', async () => {
    const tasks = uploadQueue.addTasks([
      {
        uri: 'file:///1.jpg',
        name: '1.jpg',
        size: 1024,
        mimeType: 'image/jpeg',
        uploadUrl: 'https://example.com/upload',
      },
      {
        uri: 'file:///2.jpg',
        name: '2.jpg',
        size: 2048,
        mimeType: 'image/jpeg',
        uploadUrl: 'https://example.com/upload',
      },
      {
        uri: 'file:///3.jpg',
        name: '3.jpg',
        size: 3072,
        mimeType: 'image/jpeg',
        uploadUrl: 'https://example.com/upload',
      },
    ]);
    expect(tasks).toHaveLength(3);
  });

  test('取消上传任务', async () => {
    const onError = jest.fn();
    const task = uploadQueue.addTask({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024 * 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
      onError,
    });
    uploadQueue.cancelTask(task.id);
    await new Promise(resolve => setTimeout(resolve, 100));
    const updatedTask = uploadQueue.getTask(task.id);
    expect(updatedTask?.status).toBe('cancelled');
  });

  test('取消所有任务', async () => {
    uploadQueue.addTask({
      uri: 'file:///1.jpg',
      name: '1.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    uploadQueue.addTask({
      uri: 'file:///2.jpg',
      name: '2.jpg',
      size: 2048,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    uploadQueue.cancelAll();
    await new Promise(resolve => setTimeout(resolve, 100));
    const stats = uploadQueue.getStats();
    expect(stats.pending).toBe(0);
  });

  test('上传失败后重试', async () => {
    const failingUploader = createMockUploader({
      failAttempts: 1,
      delayMs: 30,
    });
    const queue = new UploadQueue(failingUploader, adapter, { maxRetries: 3 });
    const onError = jest.fn();
    const task = queue.addTask({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
      onError,
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(onError).toHaveBeenCalled();
    const retryResult = queue.retryTask(task.id);
    expect(retryResult).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 150));
    const updatedTask = queue.getTask(task.id);
    expect(updatedTask?.status).toBe('success');
  });

  test('超过最大重试次数不可重试', async () => {
    const alwaysFailingUploader = createMockUploader({
      failAttempts: 100,
      delayMs: 10,
    });
    const queue = new UploadQueue(alwaysFailingUploader, adapter, {
      maxRetries: 1,
    });
    const task = queue.addTask({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    queue.retryTask(task.id); // 第 1 次重试
    await new Promise(resolve => setTimeout(resolve, 100));
    const retryResult = queue.retryTask(task.id); // 第 2 次重试（超过限制）
    expect(retryResult).toBe(false);
  });

  test('获取任务状态', async () => {
    const task = uploadQueue.addTask({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    expect(uploadQueue.getTask(task.id)).toBeDefined();
    expect(uploadQueue.getTask('nonexistent')).toBeUndefined();
  });

  test('队列统计', async () => {
    uploadQueue.addTask({
      uri: 'file:///1.jpg',
      name: '1.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const stats = uploadQueue.getStats();
    expect(stats.total).toBe(1);
    expect(stats.completed).toBe(1);
  });

  test('上传前校验 - 文件过大', () => {
    const result = uploadQueue.validateUpload({
      uri: 'file:///large.jpg',
      name: 'large.jpg',
      size: 100 * 1024 * 1024,
      mimeType: 'image/jpeg',
      maxSize: 50 * 1024 * 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('FILE_TOO_LARGE');
  });

  test('上传前校验 - 类型不允许', () => {
    const result = uploadQueue.validateUpload({
      uri: 'file:///test.exe',
      name: 'test.exe',
      size: 1024,
      mimeType: 'application/x-msdownload',
      allowedTypes: ['image/*', 'application/pdf'],
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_TYPE');
  });

  test('上传前校验 - 通过', () => {
    const result = uploadQueue.validateUpload({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024 * 1024,
      mimeType: 'image/jpeg',
      allowedTypes: ['image/*'],
    });
    expect(result.valid).toBe(true);
  });

  test('暂停和恢复队列', async () => {
    uploadQueue.pause();
    const task = uploadQueue.addTask({
      uri: 'file:///test.jpg',
      name: 'test.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(uploadQueue.getTask(task.id)?.status).toBe('pending');

    uploadQueue.resume();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(uploadQueue.getTask(task.id)?.status).toBe('success');
  });

  test('清空队列', async () => {
    uploadQueue.addTask({
      uri: 'file:///1.jpg',
      name: '1.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    uploadQueue.clear();
    const stats = uploadQueue.getStats();
    expect(stats.total).toBe(0);
  });

  test('并发控制', async () => {
    const slowUploader = createMockUploader({ delayMs: 200 });
    const queue = new UploadQueue(slowUploader, adapter, { maxConcurrent: 2 });
    queue.addTask({
      uri: 'file:///1.jpg',
      name: '1.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    queue.addTask({
      uri: 'file:///2.jpg',
      name: '2.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    queue.addTask({
      uri: 'file:///3.jpg',
      name: '3.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadUrl: 'https://example.com/upload',
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const stats = queue.getStats();
    expect(stats.active).toBeLessThanOrEqual(2);
    expect(stats.pending).toBe(1);
  });
});
