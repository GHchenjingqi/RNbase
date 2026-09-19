/**
 * 统一权限类型定义（对应 Skill 规则 11 / 50）。
 *
 * H5 不直接判断 Android/iOS 权限 API，统一通过 Bridge 暴露的
 * `Native.permission.request(...)` 语义在 RN 侧落地。
 * 这里定义的是 RN 侧权限层使用的领域类型。
 */

export type Permission =
  | 'camera' // 相机
  | 'photo' // 相册
  | 'location' // 定位
  | 'locationWhenInUse' // 定位（仅使用时）
  | 'notification' // 通知
  | 'file' // 文件
  | 'microphone'; // 麦克风（隐私相关）

/**
 * 统一权限状态机（与 Skill 规则 20 的“首次授权 / 拒绝 / 永久拒绝”对应）：
 *
 * unavailable     设备 / 平台不支持该能力
 * notDetermined   尚未向用户申请过（iOS 初始态）
 * denied          用户拒绝，仍可再次申请（再次授权）
 * blocked         用户永久拒绝，只能引导前往系统设置（再次授权）
 * granted         已授权
 */
export type PermissionStatus = 'unavailable' | 'notDetermined' | 'denied' | 'blocked' | 'granted';

/**
 * 结构化错误码，对齐 Skill 规则 15 的 Bridge 错误码规范。
 * 业务侧不允许依赖原生平台错误文本，必须基于 code 处理。
 */
export type PermissionErrorCode =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_BLOCKED'
  | 'PERMISSION_UNAVAILABLE'
  | 'PERMISSION_UNSUPPORTED'
  | 'PERMISSION_REQUEST_CANCELLED'
  | 'PERMISSION_UNKNOWN_ERROR';

export type PermissionError = {
  code: PermissionErrorCode;
  message: string;
  permission: Permission;
};

export type PermissionResult = {
  permission: Permission;
  status: PermissionStatus;
  granted: boolean;
  /** 是否还能再次向用户弹窗申请；blocked 时为 false，必须前往系统设置。 */
  canAskAgain: boolean;
  error?: PermissionError;
};

export type PermissionRationale = {
  title: string;
  message: string;
  /** 申请按钮文案，默认“去授权”。 */
  confirmText?: string;
  /** 拒绝按钮文案，默认“暂不”。 */
  cancelText?: string;
};
