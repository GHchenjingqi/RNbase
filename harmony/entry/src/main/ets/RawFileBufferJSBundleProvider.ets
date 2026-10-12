import { JSBundleProvider } from '@rnoh/react-native-openharmony';
import type resmgr from '@ohos.resourceManager';

/**
 * RNOH 自带的 ResourceJSBundleProvider 在有 RNOHCoreContext 时用 mmap 读 rawfile，
 * 但 HAP 内 rawfile 的起始偏移不保证 8 字节对齐，Hermes 加载 HBC 会报
 * "Compiling JS failed: Buffer misaligned."（实测：release HAP 白屏）。
 * 这里整块拷成 ArrayBuffer，走 C++ 的 loadScriptFromBuffer（std::vector 堆分配，天然对齐）。
 */
export class RawFileBufferJSBundleProvider extends JSBundleProvider {
  private resourceManager: resmgr.ResourceManager;
  private path: string;
  private appKeys: string[];

  constructor(resourceManager: resmgr.ResourceManager, path: string, appKeys: string[] = []) {
    super();
    this.resourceManager = resourceManager;
    this.path = path;
    this.appKeys = appKeys;
  }

  getURL(): string {
    return this.path;
  }

  getAppKeys(): string[] {
    return this.appKeys;
  }

  async getBundle(
    onProgress?: (progress: number) => void,
    onProviderSwitch?: (currentProvider: JSBundleProvider) => void
  ): Promise<ArrayBuffer> {
    const content: Uint8Array = await this.resourceManager.getRawFileContent(this.path);
    const buffer = new ArrayBuffer(content.length);
    new Uint8Array(buffer).set(content);
    return buffer;
  }
}
