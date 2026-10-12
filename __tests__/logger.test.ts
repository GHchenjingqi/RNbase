/**
 * 日志脱敏单测（规则 27）：敏感字段/值不得出现在日志中。
 */
import { createLogger } from '../src/diagnostics/logger';

describe('createLogger redaction', () => {
  it('masks sensitive keys', () => {
    const lines: string[] = [];
    const { redact } = createLogger(l => lines.push(l));
    const out = redact({
      access_token: 'abcdef1234567890longtoken',
      user: { phone: '13800138000', name: '张三' },
    }) as Record<string, unknown>;
    expect(out.access_token).toBe('***');
    const user = out.user as Record<string, unknown>;
    expect(user.phone).not.toBe('13800138000');
    expect(user.name).toBe('张三');
  });

  it('masks phone numbers and ID cards in values', () => {
    const { redact } = createLogger();
    const phone = redact('13800138000') as string;
    expect(phone).not.toBe('13800138000');
    expect(phone).toContain('****');
    const id = redact('11010119900307651X') as string;
    expect(id).not.toBe('11010119900307651X');
  });

  it('does not emit raw sensitive values through redact', () => {
    const { redact } = createLogger();
    const v = redact({
      token: 'secrettokenvalue123456',
      name: '张三',
    }) as Record<string, unknown>;
    expect(v.token).toBe('***');
    expect(v.name).toBe('张三');
  });
});
