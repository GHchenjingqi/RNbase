/**
 * AppErrorBoundary 单测：验证渲染期异常被捕获、降级 UI 渲染、崩溃上报、重试自愈。
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../src/diagnostics/crash-reporter', () => ({
  installGlobalErrorHandlers: jest.fn(() => false),
  reportCrash: jest.fn(),
}));

import { AppErrorBoundary } from '../src/components/AppErrorBoundary';
import { reportCrash } from '../src/diagnostics/crash-reporter';

class Boom extends React.Component {
  render(): React.ReactNode {
    throw new Error('boom-render');
  }
}

test('renders fallback UI and reports crash when child throws during render', () => {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    );
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('应用出现异常');
  expect(reportCrash).toHaveBeenCalled();
});

// React 在捕获错误时会多次调用子组件 render（dev 双调用），
// 故用布尔开关而非计数器判断抛错，避免双调用把「瞬态错误」误判为已恢复。
let shouldThrow = true;
function resetThrowFlag(): void {
  shouldThrow = false;
}

class Gated extends React.Component {
  render(): React.ReactNode {
    if (shouldThrow) {
      throw new Error('gated-fail');
    }
    return <Text>recovered</Text>;
  }
}

test('retry resets error state and re-renders recovered child', () => {
  shouldThrow = true;
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      <AppErrorBoundary onReset={resetThrowFlag}>
        <Gated />
      </AppErrorBoundary>
    );
  });
  // 首次渲染失败：降级 UI
  expect(JSON.stringify(tree!.toJSON())).toContain('应用出现异常');

  const retry = tree!.root.findByProps({ testID: 'error-boundary-retry' }) as unknown as {
    props: { onPress: () => void };
  };
  act(() => {
    retry.props.onPress();
  });
  // 重试后瞬态错误自愈：显示子节点内容
  expect(JSON.stringify(tree!.toJSON())).toContain('recovered');
});
