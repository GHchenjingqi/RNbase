/**
 * 信任源三字段下发归一（apply-app-meta 的 normalizeTrustFields）单测。
 *
 * 这三项是容器的权限面：trustedDomains 决定哪些 origin 留在容器内、manifestUrl 决定
 * 从哪儿拉子包、trustedAppIds 决定谁的握手能接管。它们在 src/config 里只认 http(s) 且
 * 按 origin 比对，所以归一必须在这里做完并且做严：
 *  - 「未声明即清空」是这条最关键的行为（继承 = 切到 B 还信 A）；
 *  - 带 path 的 origin 必须当场拒，运行期只会静默放行失败，没人查得到是 version.json 写歪。
 */
const { normalizeTrustFields } = require('../../scripts/apply-app-meta.js');

// 负例数据，不是要注入的脚本：拆开写避免 no-script-url 把它当真实用法。
const SCRIPT_ORIGIN = 'java' + 'script:alert(1)';

/** fail() 走 process.exit(1)：拦住它，并记下退出码与打出来的错误。 */
function captureFail(run: () => unknown): { threwExit: boolean; message: string } {
  const errors: string[] = [];
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__exit__${code ?? 0}`);
  }) as never);
  const errSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.join(' '));
  });
  let threwExit = false;
  try {
    run();
  } catch (e) {
    threwExit = (e as Error).message.startsWith('__exit__');
  } finally {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { threwExit, message: errors.join('\n') };
}

describe('normalizeTrustFields', () => {
  it('未声明 = 清空，而不是保留上一份子应用的可信域', () => {
    expect(normalizeTrustFields({}, false)).toEqual({
      trustedDomains: [],
      manifestUrl: '',
      trustedAppIds: [],
    });
  });

  it('--reset 无论声明了什么一律清回中性（基座出厂谁也不信）', () => {
    const raw = {
      trustedDomains: ['https://h5.example.test'],
      manifestUrl: 'https://h5.example.test/manifest.json',
      trustedAppIds: ['demo'],
    };
    expect(normalizeTrustFields(raw, true)).toEqual({
      trustedDomains: [],
      manifestUrl: '',
      trustedAppIds: [],
    });
  });

  it('合法值原样收下，顺带 trim 与去空项', () => {
    const raw = {
      trustedDomains: [' https://a.example.test ', 'https://b.example.test:8443', '', '  '],
      manifestUrl: '  https://cdn.example.test/h5/manifest.json  ',
      trustedAppIds: ['one', ' two ', ''],
    };
    expect(normalizeTrustFields(raw, false)).toEqual({
      trustedDomains: ['https://a.example.test', 'https://b.example.test:8443'],
      manifestUrl: 'https://cdn.example.test/h5/manifest.json',
      trustedAppIds: ['one', 'two'],
    });
  });

  it('origin 里带 path/query/尾斜杠一律当场拒（写进白名单会变成放行不上的死条目）', () => {
    for (const bad of [
      'https://a.example.test/app/',
      'https://a.example.test?x=1',
      'https://a.example.test/',
      '//a.example.test',
      'a.example.test',
      SCRIPT_ORIGIN,
    ]) {
      const res = captureFail(() => normalizeTrustFields({ trustedDomains: [bad] }, false));
      expect(res.threwExit).toBe(true);
      expect(res.message).toContain('trustedDomains 项非法');
    }
  });

  it('manifestUrl 只认 http(s)，留空表示关闭增量更新', () => {
    expect(
      normalizeTrustFields({ manifestUrl: 'https://cdn.example.test/m.json' }, false).manifestUrl,
    ).toBe('https://cdn.example.test/m.json');
    for (const bad of ['ftp://cdn.example.test/m.json', 'data:text/html,x', '/relative/m.json']) {
      const res = captureFail(() => normalizeTrustFields({ manifestUrl: bad }, false));
      expect(res.threwExit).toBe(true);
      expect(res.message).toContain('manifestUrl 非法');
    }
  });

  it('类型不对就直接拒，不做「看起来像数组」的宽容处理', () => {
    for (const raw of [
      { trustedDomains: 'https://a.example.test' },
      { trustedAppIds: 'one' },
      { trustedDomains: null, trustedAppIds: [] },
    ]) {
      const res = captureFail(() => normalizeTrustFields(raw, false));
      expect(res.threwExit).toBe(true);
    }
  });

  it('非字符串项当场拒：静默丢掉的那一项本来是要放行的', () => {
    for (const raw of [
      { trustedAppIds: ['ok', { a: 1 }] },
      { trustedAppIds: ['ok', 42] },
      { trustedDomains: [null] },
      { trustedDomains: [['https://a.example.test']] },
    ]) {
      const res = captureFail(() => normalizeTrustFields(raw, false));
      expect(res.threwExit).toBe(true);
      expect(res.message).toContain('含非字符串项');
    }
    // 空串/纯空白是「没配」的合法写法，丢掉而不是报错
    expect(normalizeTrustFields({ trustedAppIds: ['ok', '', '  '] }, false).trustedAppIds).toEqual([
      'ok',
    ]);
  });
});
