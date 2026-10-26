/**
 * 表驱动纯 RN 模块测试：Bridge 注册出来的 toast/dialog/orientation/statusBar/
 * keyboard/navigation/webView/device/battery 每一个 `module.action` 都跑三态——
 *   1) 缺必填参数  -> INVALID_PARAMS（H5 传错参不会被静默吞掉）
 *   2) 依赖未就绪  -> DEVICE_UNSUPPORTED（webView 模块：句柄没注入就拒，规则 16）
 *   3) 合法参数    -> 走通，或命中该平台本就该拒的闸门
 *
 * 方法清单同样由 server.listMethods() 反查 + 等值断言做漂移守卫：
 * 给这 9 个模块加动作却不进表，这里先红。
 *
 * 为什么要自己桩掉 Alert / ActionSheetIOS / ToastAndroid：
 * jest 环境里 Alert.alert 是个不会回调的 no-op（dialog.alert 因此永远挂住），
 * ActionSheetIOS 直接抛（原生模块不存在）。桩掉之后走通态才真的执行到 handler 的
 * resolve 分支，否则断言里那堆 UNKNOWN_ERROR 只是测试环境的产物，不是产品契约。
 */
import {
  ActionSheetIOS,
  Alert,
  Dimensions,
  Linking,
  Platform,
  StatusBar,
  ToastAndroid,
} from 'react-native';
import { createBridgeServer } from '../../src/bridge/index';
import { BridgeServer } from '../../src/bridge/bridge-server';
import { PermissionManager } from '../../src/permissions/permission-manager';
import { registerBatteryModule } from '../../src/bridge/modules/battery';
import { registerDeviceModule } from '../../src/bridge/modules/device';
import { getH5BarStyleOverride, setH5BarStyleListener } from '../../src/bridge/modules/statusbar';
import { setWebViewHandle } from '../../src/bridge/modules/webview-control';
import { BRIDGE_EVENTS } from '../../src/bridge/protocol';
import type { BridgeRequest } from '../../src/bridge/protocol';
import { APP_BUILD_NUMBER, APP_NAME, APP_PACKAGE, DOMAIN_WHITELIST } from '../../src/config';

/** 一张表 = 一个 Bridge 动作。 */
type Case = {
  module: string;
  action: string;
  /** 走通态的参数；缺省表示该动作不吃参数。 */
  params?: Record<string, unknown>;
  /** 该动作的必填字段名：单独删掉它必须报 INVALID_PARAMS。 */
  required?: string;
  /** 合法参数下的预期闸门码（缺省 = 成功）。 */
  gate?: 'DEVICE_UNSUPPORTED' | 'SECURITY_BLOCKED';
  /** 走通前需要先注入 WebView 句柄；这类行额外跑一次"句柄缺失"态。 */
  needsWebView?: boolean;
  /** 只在指定平台成立的行（平台闸门：iOS 无状态栏背景色、Android 无网络指示器）。 */
  platform?: 'ios' | 'android';
  /** 只跑"缺参"态的行：它只为必填校验存在，合法参数由同动作的其他行负责。 */
  invalidOnly?: boolean;
  /** 走通态预期的返回值子集（只写有意义的几条，成功本身已统一断言）。 */
  expectData?: Record<string, unknown>;
};

/**
 * 白名单内的地址必须从 config 现取，不能写死：DOMAIN_WHITELIST 的真源是
 * version.json 的 trustedDomains + ports.json 的 dev 端口，写死一个假域名的话
 * 它哪天从出厂白名单里去掉，这张表就整片红，而且红的理由是「测试自己的底稿过期」。
 */
const TRUSTED_ORIGIN = DOMAIN_WHITELIST[0];
if (!TRUSTED_ORIGIN) {
  throw new Error('DOMAIN_WHITELIST 为空，本表无法构造"白名单内地址"这一态');
}

const ASSET_URL = 'file:///android_asset/h5/index.html';
const TRUSTED_URL = `${TRUSTED_ORIGIN}/h5/index.html`;

const CASES: Case[] = [
  // ── toast：iOS 降级 Alert，Android 走 ToastAndroid，两种平台都要求走通 ──
  {
    module: 'toast',
    action: 'show',
    params: { message: '已保存', duration: 'long', gravity: 'top' },
  },

  // ── dialog ──
  {
    module: 'dialog',
    action: 'alert',
    params: { title: '提示', message: '内容', buttons: [{ text: '取消' }, { text: '确定' }] },
    expectData: { buttonIndex: 0 },
  },
  {
    module: 'dialog',
    action: 'actionSheet',
    required: 'options',
    params: { title: '选择' },
    invalidOnly: true,
  },
  {
    module: 'dialog',
    action: 'actionSheet',
    platform: 'ios',
    params: { title: '选择', options: ['拍照', '从相册选择', '取消'], cancelButtonIndex: 2 },
    expectData: { buttonIndex: 0 },
  },
  {
    module: 'dialog',
    action: 'actionSheet',
    platform: 'android',
    params: { title: '选择', options: ['拍照', '取消'] },
    expectData: { buttonIndex: 0 },
  },

  // ── orientation：查询走通，锁定两态都拒（RN 核心没有这个能力） ──
  { module: 'orientation', action: 'getOrientation', expectData: { orientation: 'portrait' } },
  { module: 'orientation', action: 'getPlatform' },
  { module: 'orientation', action: 'getScreenSize' },
  {
    module: 'orientation',
    action: 'lockTo',
    required: 'orientation',
    params: { orientation: 'landscape' },
    gate: 'DEVICE_UNSUPPORTED',
  },
  { module: 'orientation', action: 'unlockAll', gate: 'DEVICE_UNSUPPORTED' },

  // ── statusBar：setBarStyle 会写"H5 接管"标记，其余按平台分闸门 ──
  { module: 'statusBar', action: 'setBarStyle', params: { style: 'light-content' } },
  { module: 'statusBar', action: 'setHidden', params: { hidden: true, animation: 'fade' } },
  {
    module: 'statusBar',
    action: 'setBackgroundColor',
    required: 'color',
    params: { color: '#112233' },
    invalidOnly: true,
  },
  {
    module: 'statusBar',
    action: 'setBackgroundColor',
    platform: 'android',
    params: { color: '#112233' },
  },
  {
    module: 'statusBar',
    action: 'setBackgroundColor',
    platform: 'ios',
    params: { color: '#112233' },
    gate: 'DEVICE_UNSUPPORTED',
  },
  {
    module: 'statusBar',
    action: 'setNetworkActivityIndicatorVisible',
    platform: 'ios',
    params: { visible: true },
  },
  {
    module: 'statusBar',
    action: 'setNetworkActivityIndicatorVisible',
    platform: 'android',
    params: { visible: true },
    gate: 'DEVICE_UNSUPPORTED',
  },
  { module: 'statusBar', action: 'getHeight' },

  // ── keyboard：三个动作只碰 Keyboard 与本地状态 ──
  { module: 'keyboard', action: 'dismiss' },
  { module: 'keyboard', action: 'getHeight', expectData: { height: 0 } },
  { module: 'keyboard', action: 'isVisible', expectData: { visible: false } },

  // ── navigation：全都有必填字段，缺一个都不能默默去开别的东西 ──
  { module: 'navigation', action: 'openUrl', required: 'url', params: { url: TRUSTED_URL } },
  {
    module: 'navigation',
    action: 'canOpenUrl',
    required: 'url',
    params: { url: TRUSTED_URL },
    expectData: { supported: true },
  },
  {
    module: 'navigation',
    action: 'call',
    required: 'phoneNumber',
    params: { phoneNumber: '10086' },
  },
  {
    module: 'navigation',
    action: 'sms',
    required: 'phoneNumber',
    params: { phoneNumber: '10086', body: '你好' },
  },
  {
    module: 'navigation',
    action: 'email',
    required: 'to',
    params: { to: ['a@b.c'], subject: 's', body: 'b' },
  },
  { module: 'navigation', action: 'getInitialUrl', expectData: { url: null } },

  // ── webView：句柄缺失 -> 拒；句柄就位 -> 转交 controller ──
  { module: 'webView', action: 'reload', needsWebView: true },
  { module: 'webView', action: 'goBack', needsWebView: true },
  { module: 'webView', action: 'goForward', needsWebView: true },
  { module: 'webView', action: 'stopLoading', needsWebView: true },
  {
    module: 'webView',
    action: 'injectJavaScript',
    required: 'script',
    needsWebView: true,
    params: { script: 'void 0' },
  },
  {
    module: 'webView',
    action: 'loadUrl',
    required: 'url',
    needsWebView: true,
    params: { url: TRUSTED_URL },
  },
  // 内置包体路径同样放行（H5 离线入口），证明闸门不只认 http 白名单
  { module: 'webView', action: 'loadUrl', needsWebView: true, params: { url: ASSET_URL } },
  // 白名单外必须被导航策略拒掉：否则 loadUrl 等于绕过导航拦截把容器开出去
  {
    module: 'webView',
    action: 'loadUrl',
    params: { url: 'https://evil.example.com/' },
    gate: 'SECURITY_BLOCKED',
  },

  // ── device：纯 RN / version.json 拿得到的直接回，只有真缺原生实现的才报 DEVICE_UNSUPPORTED ──
  // getAppName/getBundleId/getBuildNumber 以前恒报 DEVICE_UNSUPPORTED，原因不在能力缺失，
  // 而是 src/bridge/index.ts 注册时没传 adapters；接线与已知原生缺口由
  // device-battery-wiring.test.ts 守住。
  { module: 'device', action: 'getVersion' },
  { module: 'device', action: 'getPlatform' },
  { module: 'device', action: 'getChannel', expectData: { channel: 'default' } },
  { module: 'device', action: 'getUniqueId', gate: 'DEVICE_UNSUPPORTED' },
  { module: 'device', action: 'getBuildNumber', expectData: { buildNumber: APP_BUILD_NUMBER } },
  { module: 'device', action: 'getFirstInstallTime', gate: 'DEVICE_UNSUPPORTED' },
  { module: 'device', action: 'getLastUpdateTime', gate: 'DEVICE_UNSUPPORTED' },
  { module: 'device', action: 'getAppName', expectData: { appName: APP_NAME } },
  { module: 'device', action: 'getBundleId', expectData: { bundleId: APP_PACKAGE } },

  // ── battery：纯 RN 拿不到，三个动作全依赖原生 adapter ──
  { module: 'battery', action: 'getInfo', gate: 'DEVICE_UNSUPPORTED' },
  { module: 'battery', action: 'getLevel', gate: 'DEVICE_UNSUPPORTED' },
  { module: 'battery', action: 'isCharging', gate: 'DEVICE_UNSUPPORTED' },
];

const RN_MODULES = [...new Set(CASES.map(c => c.module))].sort();

const keyOf = (module: string, action: string) => `${module}.${action}`;

function req(module: string, action: string, params?: unknown): BridgeRequest {
  return {
    type: 'request',
    id: `${keyOf(module, action)}_${Math.random().toString(36).slice(2)}`,
    version: '1.0.0',
    module: module as BridgeRequest['module'],
    action,
    params,
  };
}

/** 记下 RN 原生 API 的入参，用来断言参数确实转交出去了。 */
const rec = {
  alert: jest.fn(),
  toastWithGravity: jest.fn(),
  toastShow: jest.fn(),
  statusBarSetBackgroundColor: jest.fn(),
  statusBarSetNetworkActivityIndicatorVisible: jest.fn(),
};

/**
 * 换掉 RN 对象上的方法并返回还原函数。
 * 不用 jest.spyOn：react-native 的 index 是带懒 get 的 ESM 命名空间，
 * spyOn 在 Alert 上会踩 ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING。
 */
function replace(target: object, name: string, value: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
  return () => {
    if (previous) Object.defineProperty(target, name, previous);
    else delete (target as Record<string, unknown>)[name];
  };
}

let restores: (() => void)[] = [];

beforeEach(() => {
  restores = [];
  // Alert 桩成"立刻点第一个按钮"，同时记录入参
  restores.push(
    replace(
      Alert,
      'alert',
      (title?: string, message?: string, buttons?: { onPress?: () => void }[]) => {
        rec.alert({ title, message });
        buttons?.[0]?.onPress?.();
      },
    ),
  );
  restores.push(
    replace(ActionSheetIOS, 'showActionSheetWithOptions', (_o: unknown, cb: (i: number) => void) =>
      cb(0),
    ),
  );
  restores.push(replace(ToastAndroid, 'showWithGravity', rec.toastWithGravity));
  restores.push(replace(ToastAndroid, 'show', rec.toastShow));
  restores.push(replace(StatusBar, 'setBackgroundColor', rec.statusBarSetBackgroundColor));
  restores.push(
    replace(
      StatusBar,
      'setNetworkActivityIndicatorVisible',
      rec.statusBarSetNetworkActivityIndicatorVisible,
    ),
  );
});

afterEach(() => {
  restores.forEach(r => r());
  restores = [];
  setWebViewHandle(null);
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true, writable: true });
});

/** WebView controller 句柄的测试形状：每个方法都是 jest.fn，好断言"转交"确实发生。 */
type SpyHandle = {
  reload: jest.Mock;
  goBack: jest.Mock;
  goForward: jest.Mock;
  loadUrl: jest.Mock;
  stopLoading: jest.Mock;
  injectJavaScript: jest.Mock;
  postMessage: jest.Mock;
};

function webviewHandle(): SpyHandle {
  return {
    reload: jest.fn(),
    goBack: jest.fn(),
    goForward: jest.fn(),
    loadUrl: jest.fn(),
    stopLoading: jest.fn(),
    injectJavaScript: jest.fn(),
    postMessage: jest.fn(),
  };
}

/**
 * 注入句柄。WebViewHandle 是"方法可选"的形状，测试桩只是它的一个子集，
 * 转型集中在这一处；要模拟"缺方法"的句柄请直接用 setWebViewHandle({...} as never)。
 */
function useWebViewHandle(handle = webviewHandle()): SpyHandle {
  setWebViewHandle(handle as never);
  return handle;
}

/** 截住 Linking.openURL，用来断言拼出来的 URL 原样交了出去。 */
function captureOpenURL(): jest.Mock {
  const openURL = jest.fn(async (..._args: unknown[]): Promise<void> => undefined);
  restores.push(replace(Linking, 'openURL', openURL));
  return openURL;
}

const baselineServer = createBridgeServer(new PermissionManager());

describe('纯 RN 模块表驱动：清单完整性', () => {
  it('表覆盖了这 9 个模块注册出来的全部动作（新增动作必须先进表）', () => {
    const registered = baselineServer
      .listMethods()
      .filter(m => RN_MODULES.includes(m.split('.')[0]))
      .sort();
    const table = [...new Set(CASES.map(c => keyOf(c.module, c.action)))].sort();
    expect(table).toEqual(registered);
  });

  it('表里没有多余的动作（改名/删除要同步收行）', () => {
    for (const c of CASES) {
      expect(baselineServer.has(c.module as BridgeRequest['module'], c.action)).toBe(true);
    }
  });
});

describe.each(['ios', 'android'])('纯 RN 模块表驱动（Platform.OS=%s）', os => {
  const rows = CASES.filter(c => !c.platform || c.platform === os);

  beforeEach(() => {
    // 平台闸门靠改 Platform.OS 触发：这些 handler 全是运行时读，注册时不读
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
  });

  describe('缺必填参数 -> INVALID_PARAMS', () => {
    test.each(rows.filter(c => c.required))(
      '$module.$action 缺 $required',
      async ({ module, action, required, params }) => {
        const missing = { ...(params ?? {}) };
        delete missing[required as string];
        useWebViewHandle();
        const res = await baselineServer.handle(req(module, action, missing));
        expect(res.success).toBe(false);
        expect(res.error?.code).toBe('INVALID_PARAMS');
      },
    );
  });

  describe('WebView 句柄缺失 -> DEVICE_UNSUPPORTED', () => {
    test.each(rows.filter(c => c.needsWebView && !c.gate))(
      '$module.$action',
      async ({ module, action, params }) => {
        setWebViewHandle(null);
        const res = await baselineServer.handle(req(module, action, params));
        expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
        expect(res.error?.message).toContain('WebView 未就绪');
      },
    );
  });

  describe('合法参数 -> 走通或命中平台闸门', () => {
    test.each(rows.filter(c => !c.invalidOnly))(
      '$module.$action',
      async ({ module, action, params, gate, needsWebView, expectData }) => {
        setWebViewHandle(needsWebView ? (webviewHandle() as never) : null);
        const res = await baselineServer.handle(req(module, action, params));
        if (gate) {
          expect(res.success).toBe(false);
          expect(res.error?.code).toBe(gate);
          return;
        }
        expect(res.error).toBeNull();
        expect(res.success).toBe(true);
        if (expectData) expect(res.data).toMatchObject(expectData);
      },
    );
  });

  describe('转交给原生 API 的参数', () => {
    it('toast.show 把文案与时长档位交给 ToastAndroid（Android）/ Alert（iOS）', async () => {
      await baselineServer.handle(req('toast', 'show', { message: '同步完成', duration: 'long' }));
      if (os === 'android') {
        expect(rec.toastWithGravity).toHaveBeenCalledWith(
          '同步完成',
          ToastAndroid.LONG,
          ToastAndroid.BOTTOM,
        );
      } else {
        expect(rec.alert).toHaveBeenCalledWith({ title: '', message: '同步完成' });
      }
    });

    it('dialog.alert 不给按钮时补默认「确定」并回它的下标', async () => {
      const res = await baselineServer.handle(req('dialog', 'alert', { title: 't' }));
      expect(res.data).toEqual({ buttonIndex: 0 });
      expect(rec.alert).toHaveBeenCalledWith({ title: 't', message: undefined });
    });

    it('dialog.alert 被系统关掉（onDismiss）时回 -1，而不是报错', async () => {
      restores.push(
        replace(
          Alert,
          'alert',
          (_t?: string, _m?: string, _b?: unknown, opts?: { onDismiss?: () => void }) =>
            opts?.onDismiss?.(),
        ),
      );
      const res = await baselineServer.handle(req('dialog', 'alert', { title: 't' }));
      expect(res.data).toEqual({ buttonIndex: -1 });
    });

    it('statusBar 的两个平台专属方法各自落到 StatusBar 上', async () => {
      if (os === 'android') {
        const res = await baselineServer.handle(
          req('statusBar', 'setBackgroundColor', { color: '#112233' }),
        );
        expect(res.success).toBe(true);
        expect(rec.statusBarSetBackgroundColor).toHaveBeenCalledWith('#112233', true);
      } else {
        const res = await baselineServer.handle(
          req('statusBar', 'setNetworkActivityIndicatorVisible', { visible: true }),
        );
        expect(res.success).toBe(true);
        expect(rec.statusBarSetNetworkActivityIndicatorVisible).toHaveBeenCalledWith(true);
      }
    });

    it('navigation.email 拼出 mailto（收件人/抄送/主题都进 URL）', async () => {
      const openUrl = captureOpenURL();
      const res = await baselineServer.handle(
        req('navigation', 'email', {
          to: ['a@b.c', 'd@e.f'],
          cc: ['c@d.e'],
          subject: '晨会',
          body: 'x y',
        }),
      );
      expect(res.success).toBe(true);
      const url = String(openUrl.mock.calls[0]?.[0]);
      expect(url).toContain('mailto:a@b.c,d@e.f?');
      expect(url).toContain('cc=c%40d.e');
      expect(url).toContain('subject=%E6%99%A8%E4%BC%9A');
    });

    it('navigation.call / sms 走 tel: 与带 body 的 sms:，且按平台换分隔符', async () => {
      const openUrl = captureOpenURL();
      await baselineServer.handle(req('navigation', 'call', { phoneNumber: '10086' }));
      await baselineServer.handle(req('navigation', 'sms', { phoneNumber: '10086', body: '你好' }));
      expect(openUrl.mock.calls[0]?.[0]).toBe('tel:10086');
      const smsUrl = String(openUrl.mock.calls[1]?.[0]);
      expect(smsUrl).toMatch(/^sms:10086[?&]body=%E4%BD%A0%E5%A5%BD$/);
    });

    it('webView 走通时把调用原样转交给 controller', async () => {
      const handle = useWebViewHandle();
      await baselineServer.handle(req('webView', 'reload'));
      await baselineServer.handle(req('webView', 'goBack'));
      await baselineServer.handle(req('webView', 'goForward'));
      await baselineServer.handle(req('webView', 'stopLoading'));
      await baselineServer.handle(req('webView', 'loadUrl', { url: TRUSTED_URL }));
      await baselineServer.handle(req('webView', 'injectJavaScript', { script: 'window.__x=1' }));
      expect(handle.reload).toHaveBeenCalledTimes(1);
      expect(handle.goBack).toHaveBeenCalledTimes(1);
      expect(handle.goForward).toHaveBeenCalledTimes(1);
      expect(handle.stopLoading).toHaveBeenCalledTimes(1);
      expect(handle.loadUrl).toHaveBeenCalledWith(TRUSTED_URL);
      expect(handle.injectJavaScript).toHaveBeenCalledWith('window.__x=1');
    });
  });
});

describe('纯 RN 模块表驱动：跨平台共有的边界', () => {
  it('statusBar.setBarStyle 记下 H5 接管并通知组合根（否则重渲染会被系统值冲回）', async () => {
    const seen: string[] = [];
    setH5BarStyleListener(style => seen.push(style));
    try {
      await baselineServer.handle(req('statusBar', 'setBarStyle', { style: 'dark-content' }));
      expect(seen).toEqual(['dark-content']);
      expect(getH5BarStyleOverride()).toBe('dark-content');
      // 不传 style 落回 default，同样要通知
      await baselineServer.handle(req('statusBar', 'setBarStyle', {}));
      expect(getH5BarStyleOverride()).toBe('default');
    } finally {
      setH5BarStyleListener(null);
    }
  });

  it('navigation.openUrl：系统打不开该 URL 时报 DEVICE_UNSUPPORTED，不去硬开', async () => {
    restores.push(replace(Linking, 'canOpenURL', async () => false));
    const res = await baselineServer.handle(req('navigation', 'openUrl', { url: 'weird://x' }));
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
    expect(res.error?.message).toContain('weird://x');
  });

  it('webView：controller 缺方法时报"未实现"，而不是静默成功', async () => {
    setWebViewHandle({ reload: jest.fn() } as never);
    const back = await baselineServer.handle(req('webView', 'goBack'));
    expect(back.error?.code).toBe('DEVICE_UNSUPPORTED');
    expect(back.error?.message).toContain('goBack 未实现');
    const forward = await baselineServer.handle(req('webView', 'goForward'));
    expect(forward.error?.message).toContain('goForward 未实现');
    const stop = await baselineServer.handle(req('webView', 'stopLoading'));
    expect(stop.error?.message).toContain('stopLoading 未实现');
    const load = await baselineServer.handle(req('webView', 'loadUrl', { url: TRUSTED_URL }));
    expect(load.error?.message).toContain('loadUrl 未实现');
    // reload 是唯一在场的动作，用来证明"缺方法才拒"而不是整模块拒
    expect((await baselineServer.handle(req('webView', 'reload'))).success).toBe(true);
  });

  it('webView.injectJavaScript：没有注入通道时降级成 postMessage 指令', async () => {
    const postMessage = jest.fn();
    setWebViewHandle({ reload: jest.fn(), postMessage } as never);
    const res = await baselineServer.handle(
      req('webView', 'injectJavaScript', { script: 'alert(1)' }),
    );
    expect(res.success).toBe(true);
    expect(JSON.parse(String(postMessage.mock.calls[0]?.[0]))).toEqual({
      type: '__inject_js__',
      script: 'alert(1)',
    });
  });

  it('webView.injectJavaScript：两个通道都没有时报未实现', async () => {
    setWebViewHandle({ reload: jest.fn() } as never);
    const res = await baselineServer.handle(req('webView', 'injectJavaScript', { script: 'x' }));
    expect(res.error?.code).toBe('DEVICE_UNSUPPORTED');
    expect(res.error?.message).toContain('injectJavaScript 未实现');
  });

  it('webView.loadUrl：只有空白的 URL 也走不进导航决策（按 empty_url 拒，不是放行）', async () => {
    useWebViewHandle();
    const res = await baselineServer.handle(req('webView', 'loadUrl', { url: '   ' }));
    expect(res.error?.code).toBe('SECURITY_BLOCKED');
    expect(res.error?.message).toContain('empty_url');
  });

  it('device.getPlatform 透出当前平台与系统版本（H5 靠它分平台渲染）', async () => {
    const res = await baselineServer.handle(req('device', 'getPlatform'));
    expect(res.data).toMatchObject({ os: Platform.OS });
    expect(typeof (res.data as { version: string }).version).toBe('string');
  });

  it('orientation：横屏尺寸算出 landscape，物理像素按 scale 取整', async () => {
    const wide = { width: 2668, height: 1500, scale: 2 };
    restores.push(replace(Dimensions, 'get', () => wide));
    const orientation = await baselineServer.handle(req('orientation', 'getOrientation'));
    expect(orientation.data).toEqual({ orientation: 'landscape' });
    const size = await baselineServer.handle(req('orientation', 'getScreenSize'));
    expect(size.data).toEqual({ width: 5336, height: 3000, scale: 2, orientation: 'landscape' });
  });

  it('keyboard 事件把高度写进桥侧状态并广播给 H5（返回键先收键盘的依据）', async () => {
    // installKeyboardListeners 只在首次注册时装（模块级幂等标记），基座服务器早就把它用掉了，
    // 所以要 resetModules 换一套全新的 RN + keyboard 模块再注册。
    // jest 下 Keyboard 没有 emit，改为截获 addListener 的回调直接触发。
    jest.resetModules();
    // 注意用 require 而不是 await import：react-native 入口在 jest 下走 import() 会踩
    // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING（本仓源码不会）。
    type FreshRN = {
      Keyboard: {
        addListener: (t: string, cb: (e: unknown) => void) => { remove: () => void };
        dismiss: () => void;
      };
      Platform: { OS: string };
    };
    const rn = require('react-native') as unknown as FreshRN;
    const captured: [string, (e: { endCoordinates?: { height: number } }) => void][] = [];
    Object.defineProperty(rn.Keyboard, 'addListener', {
      value: (type: string, cb: (e: unknown) => void) => {
        captured.push([type, cb as (e: { endCoordinates?: { height: number } }) => void]);
        return { remove: jest.fn() };
      },
      writable: true,
      configurable: true,
    });
    const keyboard =
      require('../../src/bridge/modules/keyboard') as typeof import('../../src/bridge/modules/keyboard');
    const bus =
      require('../../src/bridge/event-bus') as typeof import('../../src/bridge/event-bus');
    const bridgeServer =
      require('../../src/bridge/bridge-server') as typeof import('../../src/bridge/bridge-server');
    const server = new bridgeServer.BridgeServer({});
    keyboard.registerKeyboardModule(server);
    const events: unknown[] = [];
    const off = bus.bridgeEventBus.on(BRIDGE_EVENTS.KEYBOARD_CHANGE, d => events.push(d));
    const dismiss = jest.fn();
    Object.defineProperty(rn.Keyboard, 'dismiss', {
      value: dismiss,
      writable: true,
      configurable: true,
    });
    try {
      expect(captured.map(([t]) => t)).toEqual([
        rn.Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
        rn.Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      ]);
      expect(keyboard.isKeyboardVisible()).toBe(false);
      captured[0]?.[1]({ endCoordinates: { height: 336.4 } });
      expect(keyboard.isKeyboardVisible()).toBe(true);
      expect((await server.handle(req('keyboard', 'getHeight'))).data).toEqual({ height: 336 });
      expect((await server.handle(req('keyboard', 'isVisible'))).data).toEqual({ visible: true });
      expect((await server.handle(req('keyboard', 'dismiss'))).success).toBe(true);
      expect(dismiss).toHaveBeenCalledTimes(1);
      captured[1]?.[1]({});
      expect(keyboard.isKeyboardVisible()).toBe(false);
      expect(events).toEqual([
        { height: 336, visible: true },
        { height: 0, visible: false },
      ]);
      // 事件不带 endCoordinates 时不能把 NaN 写进状态
      captured[0]?.[1]({});
      expect((await server.handle(req('keyboard', 'getHeight'))).data).toEqual({ height: 0 });
    } finally {
      off();
      jest.resetModules();
    }
  });
});

describe('device / battery：adapter 就位时的取值分支', () => {
  // 生产组合根目前没给这两组模块注入 adapter（所以表里全走 DEVICE_UNSUPPORTED），
  // 但模块自己的契约是"给了就用"：这里按 register* 的入参形状直接注册，锁死映射，
  // 等哪天像 capability 那样接线时这 10 条分支已经有测试兜着。
  const server = new BridgeServer({});
  registerDeviceModule(server, {
    getUniqueId: async () => 'uid-1',
    getBuildNumber: async () => '128',
    getChannel: async () => 'huawei',
    getFirstInstallTime: async () => 1700000000000,
    getLastUpdateTime: async () => 1700000001000,
    getAppName: async () => '示例App',
    getBundleId: async () => 'com.qux.app',
  });
  registerBatteryModule(server, {
    getBatteryInfo: async () => ({ level: 66, isCharging: true, temperature: 31 }),
  });

  const DEVICE_PRESENT: [string, Record<string, unknown>][] = [
    ['getUniqueId', { uniqueId: 'uid-1' }],
    ['getBuildNumber', { buildNumber: '128' }],
    ['getChannel', { channel: 'huawei' }],
    ['getFirstInstallTime', { firstInstallTime: 1700000000000 }],
    ['getLastUpdateTime', { lastUpdateTime: 1700000001000 }],
    ['getAppName', { appName: '示例App' }],
    ['getBundleId', { bundleId: 'com.qux.app' }],
  ];

  const BATTERY_PRESENT: [string, Record<string, unknown>][] = [
    ['getInfo', { level: 66, isCharging: true, temperature: 31 }],
    ['getLevel', { level: 66 }],
    ['isCharging', { isCharging: true }],
  ];

  test.each(DEVICE_PRESENT)('device.%s', async (action, expectData) => {
    const res = await server.handle(req('device', action));
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject(expectData);
  });

  test.each(BATTERY_PRESENT)('battery.%s', async (action, expectData) => {
    const res = await server.handle(req('battery', action));
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject(expectData);
  });

  it('adapter 抛错时收口成 UNKNOWN_ERROR，不把原生信息原样给 H5', async () => {
    const broken = new BridgeServer({});
    registerDeviceModule(broken, {
      getUniqueId: async () => {
        throw new Error('keystore path /data/internal/x');
      },
    });
    const res = await broken.handle(req('device', 'getUniqueId'));
    expect(res.error?.code).toBe('UNKNOWN_ERROR');
    expect(JSON.stringify(res.error ?? '')).not.toMatch('/data/internal');
  });

  it('battery adapter 抛错同样收口', async () => {
    const broken = new BridgeServer({});
    registerBatteryModule(broken, {
      getBatteryInfo: async () => {
        throw new Error('battery service died /data/internal/y');
      },
    });
    const res = await broken.handle(req('battery', 'getLevel'));
    expect(res.error?.code).toBe('UNKNOWN_ERROR');
    expect(JSON.stringify(res.error ?? '')).not.toMatch('/data/internal');
  });
});
