/**
 * 权限 React Context 与 usePermission Hook。
 *
 * 提供：
 *  - 权限状态订阅（授权 / 拒绝 / 永久拒绝 / 不支持）
 *  - 申请动作
 *  - 前往系统设置（再次授权）
 *  - 从系统设置返回后自动重新校验状态（App 回到前台时）
 *
 * 对应 Skill 规则 11 的“用户授权 / 拒绝 / 再次授权 / 错误提示”在 UI 层的落地。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { permissionManager as defaultManager } from './permission-manager';
import type { PermissionManager } from './permission-manager';
import type {
  Permission,
  PermissionError,
  PermissionResult,
  PermissionStatus,
} from './permissions.types';

type PermissionManagerContextValue = {
  manager: PermissionManager;
};

const PermissionManagerContext = createContext<PermissionManagerContextValue>({
  manager: defaultManager,
});

export function PermissionManagerProvider({
  manager,
  children,
}: {
  manager?: PermissionManager;
  children: React.ReactNode;
}) {
  const value = useMemo<PermissionManagerContextValue>(
    () => ({ manager: manager ?? defaultManager }),
    [manager],
  );
  return (
    <PermissionManagerContext.Provider value={value}>{children}</PermissionManagerContext.Provider>
  );
}

export function usePermissionManager(): PermissionManager {
  return useContext(PermissionManagerContext).manager;
}

export type UsePermissionState = {
  status: PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
  error: PermissionError | undefined;
  loading: boolean;
  /** 申请权限（用户授权 / 拒绝 / 再次授权）。 */
  request: () => Promise<PermissionResult>;
  /** 跳转系统设置，用于永久拒绝后的再次授权。 */
  openSettings: () => Promise<boolean>;
  /** 主动重新校验当前权限状态。 */
  refresh: () => Promise<void>;
};

export function usePermission(permission: Permission): UsePermissionState {
  const { manager } = useContext(PermissionManagerContext);
  const [status, setStatus] = useState<PermissionStatus>('notDetermined');
  const [error, setError] = useState<PermissionError | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyResult = useCallback((result: PermissionResult) => {
    if (!mountedRef.current) {
      return;
    }
    setStatus(result.status);
    setError(result.error);
  }, []);

  const refresh = useCallback(async () => {
    const result = await manager.check(permission);
    applyResult(result);
  }, [manager, permission, applyResult]);

  const request = useCallback(async () => {
    setLoading(true);
    try {
      const result = await manager.request(permission);
      applyResult(result);
      return result;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [manager, permission, applyResult]);

  const openSettings = useCallback(async () => {
    const opened = await manager.openSettings();
    if (opened) {
      // 从系统设置返回后会触发 AppState 变化，这里再兜底刷新一次。
      await refresh();
    }
    return opened;
  }, [manager, refresh]);

  // 首次挂载即同步一次状态（不弹窗）。
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // 从系统设置 / 后台返回时重新校验，支撑“再次授权”。
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        refresh().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  return useMemo<UsePermissionState>(
    () => ({
      status,
      granted: status === 'granted',
      canAskAgain: status === 'denied',
      error,
      loading,
      request,
      openSettings,
      refresh,
    }),
    [status, error, loading, request, openSettings, refresh],
  );
}
