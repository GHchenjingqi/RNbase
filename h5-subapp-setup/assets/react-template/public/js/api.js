/**
 * =====================================================================
 * 设备能力 API 中间件（H5 侧统一调用入口）
 * =====================================================================
 * 调用范式：RN.<模块大写>.<方法大写>(params) -> Promise<data>
 *    例：RN.APP.GETINFO()
 *        RN.CAMERA.TAKEPHOTO()
 *        RN.PERMISSION.REQUEST({ permission: 'camera' })
 *        RN.NETWORK.GETSTATUS()
 *
 * 命名约定：
 *   - RN              —— 接口类名（顶层门面，挂载在 window.RN）
 *   - CAMERA / APP…   —— 外设/业务模块名（大写，对应 RN 侧 Bridge module）
 *   - TAKEPHOTO…      —— 具体方法（大写，对应 RN 侧 Bridge action 小驼峰）
 *
 * 底层传输：
 *   - RN WebView 内：window.ReactNativeWebView.postMessage 与 RN Bridge 通信，
 *     协议与项目 src/bridge/protocol.ts 完全一致（request / response / event）。
 *   - 普通浏览器内：自动降级为内置 Mock（便于脱离 App 调试页面布局）。
 *
 * 使用方式：H5 页面 <head> 引入本文件后直接调用，例如：
 *   <script src="./js/api.js"></script>
 *   <script>
 *     RN.READY({ h5Version: '1.0.0' }).then(...)
 *     RN.CAMERA.TAKEPHOTO().then((res) => console.log(res.uri))
 *   </script>
 *
 * 详细文档见项目根目录 DEVICE_CAPABILITIES.md。
 * =====================================================================
 */
(function (global) {
  'use strict';

  // ---- 幂等：已存在则跳过（防重复引入 / 防重复注入） ----
  if (global.RN) {
    return;
  }

  // 与 src/config/index.ts 保持一致
  var BRIDGE_VERSION = '1.0.0';
  var BRIDGE_PROTOCOL_VERSION = '1.0';
  var TIMEOUT_MS = 30000;
  /** 握手等待超时（方案 §17：默认 15s，超时返回 BRIDGE_REQUEST_TIMEOUT）。 */
  var READY_TIMEOUT_MS = 15000;
  /** 未 ready 时的请求队列上限（方案 §18：满则返回 BRIDGE_QUEUE_FULL）。 */
  var MAX_PENDING_REQUESTS = 100;
  /** H5 Bridge SDK 版本（区别于协议版本/桥实现版本）。 */
  var SDK_VERSION = '1.1.0';

  /**
   * H5 子应用标识：默认 base_h5，可由宿主在 api.js 之前注入 window.__H5_APP_ID__ 覆盖
   * （多 H5 子应用打包时各应用声明自己的 appId）。
   */
  var APP_ID = (global.__H5_APP_ID__) || 'base_h5';
  /** H5 版本：默认 'dev'，构建期由宿主注入 window.__H5_VERSION__。 */
  var H5_VERSION = (global.__H5_VERSION__) || 'dev';

  // ===================================================================
  // 1. 环境检测
  // ===================================================================
  function getRnWebView() {
    var rn = global.ReactNativeWebView;
    return rn && typeof rn.postMessage === 'function' ? rn : null;
  }

  function isInRn() {
    return !!getRnWebView();
  }

  // ===================================================================
  // 2. BridgeClient：请求 / 响应 / 事件（与 src/bridge/client 对齐）
  // ===================================================================
  function BridgeClient(rn) {
    this.rn = rn;
    this.pending = Object.create(null);
    this.eventHandlers = Object.create(null);
    this.seq = 0;
    this.capabilities = null;
    /** 握手回执的能力列表（数组，方案 §14）；与 getCapabilities 的 features 对象缓存分开存放。 */
    this.readyCaps = null;
    /** 连接状态机（方案 §10/§16）：disconnected -> connecting -> connected -> ready */
    this.state = 'disconnected';
    /** 未 ready 时排队待发的请求（ready 后按序 flush）。 */
    this.queue = [];
    /** waitUntilReady 的等待者列表。 */
    this.readyWaiters = [];
    this._bind();
  }

  // ---- 连接状态机（方案 §16 ConnectionManager）----
  var STATE_TRANSITIONS = {
    disconnected: ['connecting', 'ready'],
    connecting: ['connected', 'ready'],
    connected: ['ready', 'disconnected'],
    ready: ['disconnected'],
  };

  function canTransition(from, to) {
    var allowed = STATE_TRANSITIONS[from];
    return !!allowed && allowed.indexOf(to) !== -1;
  }

  BridgeClient.prototype._setState = function (to) {
    if (this.state === to) {
      return false;
    }
    if (!canTransition(this.state, to)) {
      return false;
    }
    this.state = to;
    return true;
  };

  BridgeClient.prototype.markConnecting = function () {
    this._setState('connecting');
  };

  /** 握手完成：幂等；触发时 flush 队列并唤醒 waitUntilReady。 */
  BridgeClient.prototype.markReady = function (payload) {
    if (this.state === 'ready') {
      return;
    }
    this.state = 'ready';
    if (payload && payload.capabilities) {
      // 能力列表（数组）单独存放，不覆盖 getCapabilities 的 features 对象缓存
      this.readyCaps = payload.capabilities;
    }
    // flush 待发队列（按入队顺序逐个发送，各自仍带超时）
    var q = this.queue;
    this.queue = [];
    for (var i = 0; i < q.length; i++) {
      var item = q[i];
      if (item.timer) {
        clearTimeout(item.timer);
      }
      this._send(item.module, item.action, item.params).then(item.resolve, item.reject);
    }
    // 唤醒 waitUntilReady 等待者
    var ws = this.readyWaiters;
    this.readyWaiters = [];
    for (var j = 0; j < ws.length; j++) {
      try { ws[j](); } catch (e) {}
    }
  };

  BridgeClient.prototype.markDisconnected = function () {
    this.state = 'disconnected';
    this.readyCaps = null;
  };

  BridgeClient.prototype.isReady = function () {
    return this.state === 'ready';
  };

  /** 等待握手完成（方案 §17）。超时 reject { code: 'BRIDGE_REQUEST_TIMEOUT' }。 */
  BridgeClient.prototype.waitUntilReady = function (timeoutMs) {
    var self = this;
    var ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : READY_TIMEOUT_MS;
    if (this.state === 'ready') {
      return Promise.resolve(this.capabilities);
    }
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        var idx = self.readyWaiters.indexOf(onReady);
        if (idx >= 0) { self.readyWaiters.splice(idx, 1); }
        reject({ code: 'BRIDGE_REQUEST_TIMEOUT', message: 'Bridge 握手等待超时' });
      }, ms);
      function onReady() {
        clearTimeout(timer);
        resolve(self.readyCaps);
      }
      self.readyWaiters.push(onReady);
    });
  };

  BridgeClient.prototype.queueSize = function () {
    return this.queue.length;
  };

  /** 订阅 RN → H5 的 message 事件（RN 注入的字符串）。
   *  兼容两端派发目标：
   *   - Android：react-native-webview 通过 document.dispatchEvent(new MessageEvent('message', ...)) 派发；
   *   - iOS：通过 window 的 message 事件派发。
   *  两端都监听，避免 Android 上收不到响应导致 Bridge 调用全部超时。 */
  BridgeClient.prototype._bind = function () {
    var self = this;
    var onMessage = function (event) {
      var raw = event && event.data;
      if (typeof raw !== 'string') {
        return;
      }
      self._handle(raw);
    };
    global.addEventListener('message', onMessage);
    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('message', onMessage);
    }
  };

  BridgeClient.prototype._handle = function (raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') {
      return;
    }

    // ---- 事件消息（RN → H5）----
    if (msg.type === 'event') {
      // 握手完成事件（RN 在 app.ready 处理成功后推送）：先置 ready（幂等），再通知订阅者
      if (msg.event === 'bridge.ready') {
        this.markReady(msg.data || {});
      }
      var handlers = this.eventHandlers[msg.event];
      if (handlers) {
        var arr = handlers.slice();
        for (var i = 0; i < arr.length; i++) {
          try {
            arr[i](msg.data);
          } catch (e) {
            // 单个 handler 异常不影响其他订阅者
          }
        }
      }
      return;
    }

    // ---- 响应消息 ----
    if (msg.type !== 'response' || typeof msg.id !== 'string') {
      return;
    }
    var pending = this.pending[msg.id];
    if (!pending) {
      return;
    }
    delete this.pending[msg.id];
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    if (msg.success) {
      pending.resolve(msg.data);
    } else {
      var err = msg.error && typeof msg.error === 'object' ? msg.error : { code: 'UNKNOWN_ERROR', message: '未知错误' };
      pending.reject(err);
    }
  };

  /**
   * 发起一次 Bridge 调用。module/action 为 RN 侧小驼峰名。
   * 未握手完成（state !== 'ready'）时：
   *   - 握手自身（app.ready）豁免，直接发送（避免死锁）；
   *   - 其余请求进入 pending 队列，ready 后按序 flush（方案 §18，上限 MAX_PENDING_REQUESTS）。
   */
  BridgeClient.prototype.request = function (module, action, params) {
    var isHandshake = module === 'app' && action === 'ready';
    if (!isHandshake && this.state !== 'ready') {
      var self = this;
      if (this.queue.length >= MAX_PENDING_REQUESTS) {
        return Promise.reject({ code: 'BRIDGE_QUEUE_FULL', message: 'Bridge 请求队列已满' });
      }
      return new Promise(function (resolve, reject) {
        var item = { module: module, action: action, params: params, resolve: resolve, reject: reject };
        // 排队兜底：若迟迟无法握手，排队请求也按超时失败，避免无限挂起
        item.timer = setTimeout(function () {
          var idx = self.queue.indexOf(item);
          if (idx >= 0) {
            self.queue.splice(idx, 1);
          }
          reject({ code: 'TIMEOUT', message: 'Bridge 排队等待超时' });
        }, TIMEOUT_MS);
        self.queue.push(item);
      });
    }
    return this._send(module, action, params);
  };

  BridgeClient.prototype._send = function (module, action, params) {
    var self = this;
    var id = 'req_' + ++this.seq + '_' + Date.now();
    var req = {
      type: 'request',
      id: id,
      version: BRIDGE_VERSION,
      module: module,
      action: action,
      params: params,
      timestamp: Date.now(),
    };
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete self.pending[id];
        reject({ code: 'TIMEOUT', message: 'Bridge 调用超时' });
      }, TIMEOUT_MS);
      self.pending[id] = { resolve: resolve, reject: reject, timer: timer };
      try {
        self.rn.postMessage(JSON.stringify(req));
      } catch (e) {
        clearTimeout(timer);
        delete self.pending[id];
        reject({ code: 'NATIVE_ERROR', message: '发送 Bridge 消息失败' });
      }
    });
  };

  /** 订阅 RN → H5 事件，返回取消订阅函数。 */
  BridgeClient.prototype.on = function (event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
    var self = this;
    return function () {
      self.off(event, handler);
    };
  };

  BridgeClient.prototype.off = function (event, handler) {
    var arr = this.eventHandlers[event];
    if (!arr) {
      return;
    }
    var idx = arr.indexOf(handler);
    if (idx >= 0) {
      arr.splice(idx, 1);
    }
    if (arr.length === 0) {
      delete this.eventHandlers[event];
    }
  };

  BridgeClient.prototype.once = function (event, handler) {
    var self = this;
    function wrapper(data) {
      self.off(event, wrapper);
      handler(data);
    }
    return self.on(event, wrapper);
  };

  /** 获取设备能力清单（首次调用拉取并缓存）。 */
  BridgeClient.prototype.getCapabilities = function () {
    var self = this;
    if (this.capabilities) {
      return Promise.resolve(this.capabilities);
    }
    return this.request('app', 'getCapabilities')
      .then(function (res) {
        var f = (res && res.features) || {};
        self.capabilities = f;
        return f;
      })
      .catch(function () {
        self.capabilities = {};
        return self.capabilities;
      });
  };

  BridgeClient.prototype.supports = function (feature) {
    return this.getCapabilities().then(function (caps) {
      return caps[feature] === true;
    });
  };

  // ===================================================================
  // 3. 浏览器 Mock（脱离 App 调试布局用；设备相关方法返回不可用）
  // ===================================================================
  function createBrowserClient() {
    var client = {
      request: function (module, action, params) {
        var mocks = {
          'app.getInfo': { appVersion: '1.0', bridgeVersion: BRIDGE_VERSION, platform: 'web' },
          'app.getVersion': { appVersion: '1.0', bridgeVersion: BRIDGE_VERSION, platform: 'web' },
          'app.getCapabilities': {
            bridgeVersion: BRIDGE_VERSION,
            platform: 'web',
            features: { camera: false, scanner: false, location: false, filePicker: false, share: false, nfc: false },
          },
          'app.ready': { ok: true },
          'app.lifecycle': { ok: true },
          // AUTH：浏览器环境从 localStorage 动态读取登录态（与 H5 子项目 base_h5: 命名空间一致），
          // 登录后 H5 侧存入 base_h5:token / base_h5:userInfo，Mock 动态读取保证 RN.AUTH.GETTOKEN()/GETUSER() 与 H5 登录态同步
          'auth.getToken': function () {
            var token = null;
            try { token = global.localStorage.getItem('base_h5:token'); } catch (e) {}
            return { token: token };
          },
          'auth.getUser': function () {
            var user = null;
            try {
              var raw = global.localStorage.getItem('base_h5:userInfo');
              if (raw) {
                var parsed = JSON.parse(raw);
                user = parsed.user || null;
              }
            } catch (e) {}
            return { user: user };
          },
          'auth.logout': function () {
            try {
              global.localStorage.removeItem('base_h5:token');
              global.localStorage.removeItem('base_h5:userInfo');
              global.localStorage.removeItem('base_h5:tenantId');
            } catch (e) {}
            return { ok: true };
          },
          'network.getStatus': { connected: true, type: 'wifi' },
          // SYSTEM 静态兜底（浏览器布局调试用；设备相关方法仍 DEVICE_UNSUPPORTED）
          'system.getDarkMode': { mode: 'light' },
          'system.getLanguage': (function () {
            var lang = (typeof navigator !== 'undefined' && navigator.language) || 'zh-CN';
            return { language: lang.split(/[-_]/)[0] || 'zh', locale: lang };
          })(),
                    'system.getStatusBarHeight': { statusBarHeight: 0 },
          'system.getPlatform': { os: 'web' },
          'system.getScreenInfo': (function () {
            return {
              width: typeof window !== 'undefined' ? window.innerWidth : 0,
              height: typeof window !== 'undefined' ? window.innerHeight : 0,
              scale: typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1,
              fontScale: 1,
            };
          })(),
          'system.getAccessibility': {
            screenReader: false,
            reduceMotion: false,
            boldText: false,
            invertColors: false,
          },
          'system.getInfo': (function () {
            var lang = (typeof navigator !== 'undefined' && navigator.language) || 'zh-CN';
            return {
              os: 'web',
              systemVersion: 'browser',
              darkMode: 'light',
              language: lang.split(/[-_]/)[0] || 'zh',
              locale: lang,
              screen: {
                width: typeof window !== 'undefined' ? window.innerWidth : 0,
                height: typeof window !== 'undefined' ? window.innerHeight : 0,
                scale: typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1,
                fontScale: 1,
              },
              accessibility: {
                screenReader: false,
                reduceMotion: false,
                boldText: false,
                invertColors: false,
              },
            };
          })(),
          // LOG 浏览器 Mock：直接返回成功，不写文件（开发调试用）
          'log.info': { ok: true },
          'log.error': { ok: true },
          'log.warn': { ok: true },
          'log.debug': { ok: true },
        };
        var key = module + '.' + action;
        if (mocks[key]) {
          // 支持函数类型的动态 Mock（如 auth.getToken 需实时读取 localStorage）
          var val = typeof mocks[key] === 'function' ? mocks[key](params) : mocks[key];
          return Promise.resolve(val);
        }
        return Promise.reject({ code: 'DEVICE_UNSUPPORTED', message: '浏览器环境不支持该设备能力: ' + key });
      },
      on: function () { return function () {}; },
      off: function () {},
      once: function () {},
      // 浏览器 Mock 恒为 ready（所有能力即时可用，不排队、不等待握手）
      state: 'ready',
      markConnecting: function () {},
      markReady: function () {},
      markDisconnected: function () {},
      isReady: function () { return true; },
      waitUntilReady: function () {
        return Promise.resolve({ camera: false, scanner: false, location: false, filePicker: false, share: false, nfc: false });
      },
      queueSize: function () { return 0; },
      getCapabilities: function () {
        return Promise.resolve({ camera: false, scanner: false, location: false, filePicker: false, share: false, nfc: false });
      },
      supports: function () { return Promise.resolve(false); },
    };
    return client;
  }

  // ===================================================================
  // 4. 模块注册表：RN.<模块>.<方法>  ->  RN Bridge module.action
  //    仅收录 RN 侧 src/bridge/index.ts 已注册的方法。
  // ===================================================================
  var MODULES = {
    APP: {
      GETINFO: 'getInfo',
      GETVERSION: 'getVersion',
      GETCAPABILITIES: 'getCapabilities',
      READY: 'ready',
      LIFECYCLE: 'lifecycle',
    },
    AUTH: {
      GETTOKEN: 'getToken',
      GETUSER: 'getUser',
      LOGOUT: 'logout',
    },
    NETWORK: {
      GETSTATUS: 'getStatus',
    },
    CAMERA: {
      TAKEPHOTO: 'takePhoto',
    },
    SCANNER: {
      SCAN: 'scan',
    },
    MEDIA: {
      PICKIMAGE: 'pickImage',
      SAVEIMAGE: 'saveImage',
    },
    FILE: {
      PICK: 'pick',
      PICKIMAGE: 'pickImage',
      READASBASE64: 'readAsBase64',
      DOWNLOAD: 'download',
      OPEN: 'open',
    },
    LOCATION: {
      GETCURRENTPOSITION: 'getCurrentPosition',
    },
    SYSTEM: {
      VIBRATE: 'vibrate',
      COPY: 'copy',
      SHARE: 'share',
      GETDARKMODE: 'getDarkMode',
      GETLANGUAGE: 'getLanguage',
      GETSCREENINFO: 'getScreenInfo',
      GETSTATUSBARHEIGHT: 'getStatusBarHeight',
      GETPLATFORM: 'getPlatform',
      GETACCESSIBILITY: 'getAccessibility',
      GETINFO: 'getInfo',
      GETDEVICEINFO: 'getDeviceInfo',
      GETBATTERY: 'getBattery',
    },
    NOTIFICATION: {
      GETTOKEN: 'getToken',
      SETBADGE: 'setBadge',
      PLAYSOUND: 'playSound',
      SENDNOTIFICATION: 'sendNotification',
    },
    PERMISSION: {
      REQUEST: 'request',
      CHECK: 'check',
      OPENSETTINGS: 'openSettings',
    },
    LOG: {
      INFO: 'info',
      ERROR: 'error',
      WARN: 'warn',
      DEBUG: 'debug',
    },
  };

  // ===================================================================
  // 5. 组装门面 window.RN
  // ===================================================================
  var client = isInRn() ? new BridgeClient(getRnWebView()) : createBrowserClient();

  var RN = {};

  // 每个模块生成对象：RN.CAMERA.TAKEPHOTO(params) -> Promise
  Object.keys(MODULES).forEach(function (moduleUpper) {
    var actions = MODULES[moduleUpper];
    var moduleObj = {};
    Object.keys(actions).forEach(function (actionUpper) {
      var moduleLower = moduleUpper.toLowerCase();
      var actionLower = actions[actionUpper];
      moduleObj[actionUpper] = function (params) {
        return client.request(moduleLower, actionLower, params);
      };
    });
    RN[moduleUpper] = moduleObj;
  });

  // 顶层工具方法
  /**
   * 启动握手（方案 §9/§14）：告知 RN H5 就绪，并等待握手回执。
   * 双路径（幂等）：
   *   - 响应路径：app.ready 的 response 携带 state:'READY' + capabilities；
   *   - 事件路径：订阅 bridge.ready 事件（RN 推送兜底）。
   * 任一先到即 markReady；已 ready 后再次调用直接返回当前回执。
   */
  RN.READY = function (info) {
    client.markConnecting();
    var off = null;
    if (client.on) {
      off = client.on('bridge.ready', function (payload) {
        client.markReady(payload || {});
        if (off) { off(); }
      });
    }
    return client.request('app', 'ready', Object.assign(
      {
        h5Version: H5_VERSION,
        appId: APP_ID,
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      },
      info || {},
    )).then(function (res) {
      if (res && res.state === 'READY') {
        client.markReady(res);
      }
      return res;
    });
  };

  /** 当前连接状态：disconnected / connecting / connected / ready。 */
  RN.STATE = function () {
    return client.state;
  };

  /** 是否握手完成。 */
  RN.ISREADY = function () {
    return client.isReady();
  };

  /** 等待握手完成（默认 15s，超时 reject BRIDGE_REQUEST_TIMEOUT）。 */
  RN.WAITUNTILREADY = function (timeoutMs) {
    return client.waitUntilReady(timeoutMs);
  };

  /** 待发队列长度（未 ready 时排队的请求数）。 */
  RN.QUEUESIZE = function () {
    return client.queueSize();
  };

  /** 能力检测别名（方案 §19 hasCapability）。 */
  RN.HASCAPABILITY = function (feature) {
    return client.supports(feature);
  };

  /** 当前 Bridge 协议版本。 */
  RN.VERSION = BRIDGE_VERSION;

  /** H5 Bridge SDK 版本（区别于协议版本/桥实现版本，方案 §21）。 */
  RN.SDK_VERSION = SDK_VERSION;

  /** 协议版本（消息格式版本，方案 §21）。 */
  RN.PROTOCOL_VERSION = BRIDGE_PROTOCOL_VERSION;

  /** 当前 H5 子应用标识（构建期注入，方案 §20）。 */
  RN.APP_ID = APP_ID;

  /** 订阅 RN → H5 事件，返回取消订阅函数。 */
  RN.ON = function (event, handler) {
    return client.on(event, handler);
  };

  /** 取消事件订阅。 */
  RN.OFF = function (event, handler) {
    client.off(event, handler);
  };

  /** 一次性事件订阅。 */
  RN.ONCE = function (event, handler) {
    return client.once(event, handler);
  };

  /** 获取能力清单：{ camera, scanner, location, filePicker, share, nfc }。 */
  RN.GETCAPABILITIES = function () {
    return client.getCapabilities();
  };

  /** 检测某能力是否可用，返回 Promise<boolean>。 */
  RN.SUPPORTS = function (feature) {
    return client.supports(feature);
  };

  /** 运行环境：'rn'（RN WebView）/ 'browser'。 */
  RN.ENV = isInRn() ? 'rn' : 'browser';

  /**
   * 当前平台（同步读取，无需异步调用）。
   * - RN 环境：基座加载前注入 window.RN_PLATFORM（原生 Platform.OS 值，android/ios/...）
   * - 浏览器环境：'web'
   * 异步等效 API：RN.SYSTEM.GETPLATFORM() -> { os }
   */
  RN.PLATFORM = (isInRn() && global.RN_PLATFORM) || 'web';

  /** 统一错误码常量（与 src/bridge/protocol.ts BridgeErrorCode 对齐）。 */
  RN.ERRORS = {
    BRIDGE_NOT_READY: 'BRIDGE_NOT_READY',
    BRIDGE_VERSION_NOT_SUPPORTED: 'BRIDGE_VERSION_NOT_SUPPORTED',
    METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
    INVALID_PARAMS: 'INVALID_PARAMS',
    TIMEOUT: 'TIMEOUT',
    BRIDGE_QUEUE_FULL: 'BRIDGE_QUEUE_FULL',
    BRIDGE_REQUEST_TIMEOUT: 'BRIDGE_REQUEST_TIMEOUT',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    PERMISSION_BLOCKED: 'PERMISSION_BLOCKED',
    PERMISSION_UNAVAILABLE: 'PERMISSION_UNAVAILABLE',
    USER_CANCELLED: 'USER_CANCELLED',
    DEVICE_UNSUPPORTED: 'DEVICE_UNSUPPORTED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    NATIVE_ERROR: 'NATIVE_ERROR',
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',
    FILE_TOO_LARGE: 'FILE_TOO_LARGE',
    SECURITY_BLOCKED: 'SECURITY_BLOCKED',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  };

  global.RN = RN;

  // ---- 自动握手：页面加载即发起（业务零改造）----
  // 存量业务不调用 RN.READY 也能握手：未 ready 时请求先排队，握手完成后自动 flush。
  // 浏览器环境（Mock）不需要握手。
  if (isInRn()) {
    try {
      RN.READY().catch(function () {});
    } catch (e) {}
  }

  // ---- 页面生命周期与连接状态机（方案 §10 reload 时序）----
  // 普通 reload：本文件重新执行，client 为新实例（state=disconnected），无需处理；
  // bfcache 恢复（pageshow.persisted）：页面 JS 不重跑，需重置状态并自动重握手。
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('pagehide', function () {
      client.markDisconnected();
    });
    global.addEventListener('pageshow', function (evt) {
      if (evt && evt.persisted) {
        client.markDisconnected();
        // 静默自动重握手，业务无感（失败不抛错，队列兜底）
        try {
          RN.READY().catch(function () {});
        } catch (e) {}
      }
    });
  }
})(typeof window !== 'undefined' ? window : this);
