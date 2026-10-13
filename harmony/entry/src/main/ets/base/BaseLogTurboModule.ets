/**
 * 鸿蒙侧 BaseLog TurboModule：与 Android `BaseLogModule.kt` 对齐 —— 追加写入
 * `<filesDir>/logs/device-YYYY-MM-DD.log`，供 deviceLogger / 诊断页导出使用。
 *
 * 私有目录写入无需权限。任何一步失败都只记 hilog、不抛出（日志不能拖垮业务）。
 */
import fs from '@ohos.file.fs';
import type { UITurboModuleContext } from '@rnoh/react-native-openharmony';
import { UITurboModule } from '@rnoh/react-native-openharmony';

export interface BaseLogFileInfo {
  name: string;
  date: string;
  size: number;
  path: string;
}

export interface BaseClearLogsResult {
  cleared: number;
}

const PREFIX: string = 'device-';
const SUFFIX: string = '.log';

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function dateStr(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function timestamp(now: Date): string {
  return `${dateStr(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}.${now.getMilliseconds()}`;
}

function isLogFile(name: string): boolean {
  return name.startsWith(PREFIX) && name.endsWith(SUFFIX);
}

export class BaseLogTurboModule extends UITurboModule {
  public static readonly NAME: string = 'BaseLog';

  private logsDir: string;

  constructor(ctx: UITurboModuleContext) {
    super(ctx);
    this.logsDir = `${ctx.uiAbilityContext.filesDir}/logs`;
  }

  private exists(path: string): boolean {
    try {
      return fs.accessSync(path);
    } catch (error) {
      return false;
    }
  }

  private ensureDir(): void {
    if (!this.exists(this.logsDir)) {
      fs.mkdirSync(this.logsDir, true);
    }
  }

  /** 日志文件名（不含目录），按最后修改时间倒序。 */
  private logNames(): string[] {
    if (!this.exists(this.logsDir)) {
      return [];
    }
    const names: string[] = fs.listFileSync(this.logsDir).filter((name: string) => isLogFile(name));
    names.sort((a: string, b: string): number => {
      const ma: number = this.statMtime(`${this.logsDir}/${a}`);
      const mb: number = this.statMtime(`${this.logsDir}/${b}`);
      return mb - ma;
    });
    return names;
  }

  private statMtime(path: string): number {
    try {
      return fs.statSync(path).mtime;
    } catch (error) {
      return 0;
    }
  }

  private statSize(path: string): number {
    try {
      return fs.statSync(path).size;
    } catch (error) {
      return 0;
    }
  }

  /**
   * RN 侧（deviceLogger）不取返回值，这里保持 async：C++ 那半边按 async 登记，
   * 同步登记会让 JS 线程同步等主线程，有死锁风险。
   */
  async write(level: string, message: string): Promise<void> {
    try {
      this.ensureDir();
      const path: string = `${this.logsDir}/${PREFIX}${dateStr(new Date())}${SUFFIX}`;
      const file: fs.File = fs.openSync(
        path,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.APPEND,
      );
      try {
        fs.writeSync(file.fd, `[${timestamp(new Date())}] [${level}] ${message}\n`);
      } finally {
        fs.closeSync(file);
      }
    } catch (error) {
      this.ctx.logger.error(`[BaseLog] 写入失败: ${error}`);
    }
  }

  async getLogDir(): Promise<string> {
    try {
      this.ensureDir();
    } catch (error) {
      this.ctx.logger.error(`[BaseLog] 目录创建失败: ${error}`);
    }
    return this.logsDir;
  }

  async listLogs(): Promise<BaseLogFileInfo[]> {
    const result: BaseLogFileInfo[] = [];
    for (const name of this.logNames()) {
      const path: string = `${this.logsDir}/${name}`;
      const info: BaseLogFileInfo = {
        name: name,
        date: name.substring(PREFIX.length, name.length - SUFFIX.length),
        size: this.statSize(path),
        path: path,
      };
      result.push(info);
    }
    return result;
  }

  async readLog(name: string): Promise<string> {
    if (!isLogFile(name)) {
      throw new Error(`log file not found: ${name}`);
    }
    const path: string = `${this.logsDir}/${name}`;
    if (!this.exists(path)) {
      throw new Error(`log file not found: ${name}`);
    }
    return fs.readTextSync(path);
  }

  async clearLogs(): Promise<BaseClearLogsResult> {
    let cleared: number = 0;
    for (const name of this.logNames()) {
      try {
        fs.unlinkSync(`${this.logsDir}/${name}`);
        cleared += 1;
      } catch (error) {
        this.ctx.logger.error(`[BaseLog] 删除失败 ${name}: ${error}`);
      }
    }
    const result: BaseClearLogsResult = { cleared: cleared };
    return result;
  }
}
