/**
 * 权限门组件（UI 层）。
 *
 * 落实 Skill 规则 11 的四种必备提示：
 *  1. 用户授权：未决定时展示用途说明 + “去授权”
 *  2. 拒绝：被拒绝时展示说明 + “再次授权”
 *  3. 再次授权：被永久拒绝时引导“前往系统设置”
 *  4. 错误提示：不支持 / 未知错误时给出明确文案
 *
 * 仅当权限 granted 时渲染业务 children，避免业务代码散落权限判断。
 */
import React from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { usePermission } from '../permissions/PermissionProvider';
import type { Permission, PermissionRationale } from '../permissions/permissions.types';

type PermissionGateProps = {
  permission: Permission;
  /** 申请前的用途说明（授权 / 拒绝态复用）。 */
  rationale: PermissionRationale;
  /** 业务内容，仅授权后渲染。 */
  children: React.ReactNode;
  /** 永久拒绝态的标题，默认“权限被永久拒绝”。 */
  blockedTitle?: string;
  /** 永久拒绝态说明，默认引导前往设置。 */
  blockedMessage?: string;
  /** 用户拒绝且放弃授权时回调（如返回上一页）。 */
  onRejected?: () => void;
};

export function PermissionGate({
  permission,
  rationale,
  children,
  blockedTitle = '权限被永久拒绝',
  blockedMessage = '请前往系统设置开启权限后继续使用。',
  onRejected,
}: PermissionGateProps) {
  const { status, granted, canAskAgain, error, loading, request, openSettings } =
    usePermission(permission);

  if (granted) {
    return <>{children}</>;
  }

  const confirmText = canAskAgain
    ? rationale.confirmText ?? '再次授权'
    : rationale.confirmText ?? '去授权';
  const cancelText = rationale.cancelText ?? '暂不';

  const renderActions = () => {
    if (loading) {
      return <ActivityIndicator style={styles.spinner} />;
    }
    return (
      <View style={styles.actions}>
        {onRejected ? (
          <View style={styles.actionButton}>
            <Button title={cancelText} onPress={onRejected} />
          </View>
        ) : null}
        <View style={styles.actionButton}>
          <Button title={confirmText} onPress={request} />
        </View>
      </View>
    );
  };

  const renderBody = () => {
    if (status === 'blocked') {
      return (
        <>
          <Text style={styles.title}>{blockedTitle}</Text>
          <Text style={styles.message}>{blockedMessage}</Text>
          <View style={styles.actions}>
            {onRejected ? (
              <View style={styles.actionButton}>
                <Button title={cancelText} onPress={onRejected} />
              </View>
            ) : null}
            <View style={styles.actionButton}>
              <Button title="前往设置" onPress={openSettings} />
            </View>
          </View>
        </>
      );
    }

    if (status === 'unavailable') {
      return (
        <>
          <Text style={styles.title}>功能不可用</Text>
          <Text style={styles.message}>{error?.message ?? '当前设备不支持该能力'}</Text>
        </>
      );
    }

    return (
      <>
        <Text style={styles.title}>{rationale.title}</Text>
        <Text style={styles.message}>{rationale.message}</Text>
        {error ? <Text style={styles.error}>{error.message}</Text> : null}
        {renderActions()}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>{renderBody()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f5f5f7',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111111',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#555555',
    lineHeight: 21,
    marginBottom: 16,
  },
  error: {
    fontSize: 13,
    color: '#b00020',
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionButton: {
    marginLeft: 12,
  },
  spinner: {
    alignSelf: 'flex-end',
    marginVertical: 4,
  },
});
