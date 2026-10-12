/**
 * Phase 3：Bridge 事件总线单元测试（规范 §62）。
 */
import { BridgeEventBus } from '../../src/bridge/event-bus';

describe('BridgeEventBus', () => {
  let bus: BridgeEventBus;

  beforeEach(() => {
    bus = new BridgeEventBus();
  });

  test('on 订阅事件，emit 时触发 handler', () => {
    const handler = jest.fn();
    bus.on('network.changed', handler);
    bus.emit('network.changed', { type: 'wifi' });
    expect(handler).toHaveBeenCalledWith({ type: 'wifi' });
  });

  test('off 取消订阅后不再触发', () => {
    const handler = jest.fn();
    bus.on('test.event', handler);
    bus.off('test.event', handler);
    bus.emit('test.event', { data: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  test('on 返回 unsubscribe 函数', () => {
    const handler = jest.fn();
    const unsubscribe = bus.on('test.event', handler);
    unsubscribe();
    bus.emit('test.event', {});
    expect(handler).not.toHaveBeenCalled();
  });

  test('once 只触发一次', () => {
    const handler = jest.fn();
    bus.once('test.event', handler);
    bus.emit('test.event', { n: 1 });
    bus.emit('test.event', { n: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ n: 1 });
  });

  test('多个订阅者都能收到事件', () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    bus.on('test.event', h1);
    bus.on('test.event', h2);
    bus.emit('test.event', { data: 'x' });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  test('单个 handler 异常不影响其他订阅者', () => {
    const badHandler = jest.fn(() => {
      throw new Error('boom');
    });
    const goodHandler = jest.fn();
    bus.on('test.event', badHandler);
    bus.on('test.event', goodHandler);
    expect(() => bus.emit('test.event', {})).not.toThrow();
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  test('setGlobalListener 能收到所有事件', () => {
    const listener = jest.fn();
    bus.setGlobalListener(listener);
    bus.emit('network.changed', { type: 'wifi' });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'event',
        event: 'network.changed',
        data: { type: 'wifi' },
      }),
    );
  });

  test('clearGlobalListener 后不再收到事件', () => {
    const listener = jest.fn();
    bus.setGlobalListener(listener);
    bus.clearGlobalListener();
    bus.emit('test.event', {});
    expect(listener).not.toHaveBeenCalled();
  });

  test('clear 清除所有订阅者', () => {
    bus.on('event1', jest.fn());
    bus.on('event2', jest.fn());
    expect(bus.eventNames().length).toBe(2);
    bus.clear();
    expect(bus.eventNames().length).toBe(0);
  });

  test('listenerCount 返回正确数量', () => {
    bus.on('test.event', jest.fn());
    bus.on('test.event', jest.fn());
    expect(bus.listenerCount('test.event')).toBe(2);
    expect(bus.listenerCount('nonexistent')).toBe(0);
  });

  test('emit 不带 data 时 data 为 null', () => {
    const handler = jest.fn();
    bus.on('test.event', handler);
    bus.emit('test.event');
    expect(handler).toHaveBeenCalledWith(null);
  });
});
