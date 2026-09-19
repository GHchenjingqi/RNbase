/**
 * 设备日志文件存取（RN 侧），用于排查/导出按日期分包的日志。
 *
 * 底层为原生日志模块 ERPLog（写入 <filesDir>/logs/device-YYYY-MM-DD.log）。
 * 原生模块未接入时返回结构化错误 DEVICE_UNSUPPORTED。
 */
import { NativeModules } from 'react-native';

export type DeviceLogFileInfo = {
  /** 文件名，形如 device-2026-09-02.log */
  name: string;
  /** 日志日期，形如 2026-09-02 */
  date: string;
  /** 文件字节数 */
  size: number;
  /** 文件绝对路径（可用于 adb pull / 分享） */
  path: string;
};

type ERPLogNative = {
  getLogDir: () => Promise<string>;
  listLogs: () => Promise<DeviceLogFileInfo[]>;
  readLog: (name: string) => Promise<string>;
  clearLogs: () => Promise<{ cleared: number }>;
};

function getNative(): ERPLogNative | null {
  return ((NativeModules as Record<string, unknown>).ERPLog as ERPLogNative | undefined) ?? null;
}

function unsupported(): Promise<never> {
  return Promise.reject({
    code: 'DEVICE_UNSUPPORTED',
    message: '原生日志模块 ERPLog 未接入',
  });
}

export const deviceLogStore = {
  /** 返回日志目录绝对路径（App 私有目录 <filesDir>/logs）。 */
  getLogDir(): Promise<string> {
    const native = getNative();
    return native ? native.getLogDir() : unsupported();
  },

  /** 列出所有日志文件（按修改时间倒序）。 */
  listLogs(): Promise<DeviceLogFileInfo[]> {
    const native = getNative();
    return native ? native.listLogs() : unsupported();
  },

  /** 读取指定日志文件内容。 */
  readLog(name: string): Promise<string> {
    const native = getNative();
    return native ? native.readLog(name) : unsupported();
  },

  /** 清空所有日志文件，返回删除数量。 */
  clearLogs(): Promise<{ cleared: number }> {
    const native = getNative();
    return native ? native.clearLogs() : unsupported();
  },
};
