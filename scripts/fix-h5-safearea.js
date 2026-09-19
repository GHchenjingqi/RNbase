/**
 * 幂等地给 h5/index.html 注入"状态栏/导航栏重叠"安全区修复。
 *
 * 背景：Android 15+（targetSdk 35+）强制 edge-to-edge 后，
 *   1) RN 壳层在 WebView 加载前注入 window.RN_SAFE_AREA，并在 URL query 上拼 safeTop 等参数；
 *   2) 但打包 CSS 在 body 元素上定义了 --status-bar-height: env(safe-area-inset-top, 44px)，
 *      Android WebView 中 env() 恒为 0，会把注入值遮蔽（导航栏就近继承 body 的 0px）；
 *   3) 打包入口 JS 还会异步把 html 上的变量覆盖回 44px。
 * 因此必须在 index.html 头部注入：
 *   - :root 兜底变量 + .nut-navbar 全局让出状态栏规则（!important）；
 *   - 同步脚本：读 URL query / window.RN_SAFE_AREA，把真实值写入 html 与 body 的 inline 变量
 *     （inline 优先级最高，body 就近继承，导航栏/hero 等后代组件即可拿到真实状态栏高度）。
 *
 * 用法：node scripts/fix-h5-safearea.js
 * 幂等：已注入时直接跳过。
 */
const fs = require('fs');
const path = require('path');

const h5Index = path.join(__dirname, '..', 'h5', 'index.html');
const MARK = 'saferea-fix';

const STYLE = `
    <style data-${MARK}>
      :root { --status-bar-height: env(safe-area-inset-top, 0px); }
      .nut-navbar {
        box-sizing: border-box !important;
        /* 总高 = 组件声明的内容高度(--nutui-navbar-height) + 状态栏高度；
           组件未声明时兜底 NutUI 默认 44px。不再用 height:auto 覆盖，
           避免 QNavbar 等组件声明的 56px(Android) 被吞掉导致导航栏偏矮。 */
        height: calc(var(--nutui-navbar-height, 44px) + var(--status-bar-height)) !important;
        padding-top: var(--status-bar-height) !important;
      }
      .nut-navbar-safe-area-inset-top {
        padding-top: var(--status-bar-height) !important;
      }
    </style>`;

const SCRIPT = `
    <script data-${MARK}>
      (function () {
        // RN->H5 兜底：RN WebView 的 postMessage 在 document 上派发【不冒泡】的 MessageEvent，
        // 而 H5 api.js 只监听 window 的 message 事件，导致 Bridge 响应永远收不到（全部超时）。
        // 这里把 document 上收到的消息重派到 window，保证响应可达。
        // （api.js 已同时监听 document，本兜底保留以兼容未同步的旧 api.js。）
        if (typeof document !== 'undefined' && document.addEventListener) {
          document.addEventListener('message', function (evt) {
            try {
              if (evt && evt.data) {
                window.dispatchEvent(new MessageEvent('message', { data: evt.data }));
              }
            } catch (err) {}
          });
        }
        var top = 0;
        try {
          var m = location.search.match(/[?&]safeTop=(\\d+)/);
          if (m) top = parseInt(m[1], 10);
        } catch (e) {}
        try {
          var s = window.RN_SAFE_AREA;
          if (!top && s && Number(s.top) > 0) top = Number(s.top);
        } catch (e) {}
        function applyBody(v) {
          try {
            if (v > 0 && document.body) {
              document.body.style.setProperty('--status-bar-height', v + 'px');
            }
          } catch (e) {}
        }
        if (top > 0) {
          document.documentElement.style.setProperty('--status-bar-height', top + 'px');
          applyBody(top);
          document.addEventListener('DOMContentLoaded', function () { applyBody(top); });
        }
      })();

      // ---- 导航栏固定（基座 WebView 注入的 navFixedInjection 在部分 RN 版本会被截断，
      // ---- 此处构建期注入 H5，保证 .nut-navbar 固定顶部 + 等高占位始终生效）----
      (function () {
        try {
          var SEL = '.nut-navbar', ATTR = 'data-rn-nav-spacer';
          function scan() {
            var navs = document.querySelectorAll(SEL), i, el, cs, h, sp, prev;
            for (i = 0; i < navs.length; i++) {
              el = navs[i];
              if (el.__rnNavFixed) continue;
              cs = window.getComputedStyle(el);
              // 组件已自行 fixed（含 placeholder 场景）：跳过，避免重复占位
              if (cs.position === 'fixed') { el.__rnNavFixed = true; continue; }
              h = el.offsetHeight;
              if (!h) continue; // 尚未渲染/不可见，等下次 DOM 变化
              el.__rnNavFixed = true;
              el.style.position = 'fixed';
              el.style.top = '0';
              el.style.left = '0';
              el.style.width = '100%';
              el.style.zIndex = '999';
              sp = el.nextElementSibling;
              if (sp && sp.getAttribute && sp.getAttribute(ATTR)) {
                sp.style.height = h + 'px';
              } else {
                sp = document.createElement('div');
                sp.setAttribute(ATTR, '1');
                sp.style.height = h + 'px';
                el.parentNode.insertBefore(sp, el.nextSibling);
              }
            }
            // 清理孤儿占位：导航栏被 SPA 卸载后，其占位元素同步移除
            var orph = document.querySelectorAll('[' + ATTR + ']');
            for (i = 0; i < orph.length; i++) {
              sp = orph[i]; prev = sp.previousElementSibling;
              if (!prev || !prev.classList || !prev.classList.contains('nut-navbar')) {
                if (sp.parentNode) sp.parentNode.removeChild(sp);
              }
            }
          }
          if (window.MutationObserver) {
            new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
          }
          scan();
          document.addEventListener('DOMContentLoaded', scan);
          window.addEventListener('load', scan);
          var rt;
          window.addEventListener('resize', function () {
            clearTimeout(rt); rt = setTimeout(scan, 200);
          });
        } catch (e) {}
      })();
    </script>`;

if (!fs.existsSync(h5Index)) {
  console.error('[fix-h5-safearea] 未找到 h5/index.html:', h5Index);
  process.exit(1);
}

let html = fs.readFileSync(h5Index, 'utf8');
if (html.includes(`data-${MARK}`)) {
  // 注意：不能 process.exit(0)——gradle.js 会 require 本脚本，
  // 直接退出会把打包进程一并杀掉（gradlew 永远不会启动）。
  console.log('[fix-h5-safearea] 已注入，跳过');
  return;
}

// 1) viewport 补齐 viewport-fit=cover（iOS safe-area 所需，兼容保留）
if (!/viewport-fit=cover/.test(html)) {
  html = html.replace(/<meta\s+name="viewport"[\s\S]*?\/?>/i, m =>
    m.replace('user-scalable=no', 'user-scalable=no, viewport-fit=cover'),
  );
}

// 2) 在 </head> 前插入 style + 同步脚本
if (!html.includes('</head>')) {
  console.error('[fix-h5-safearea] 未找到 </head>，跳过');
  process.exit(1);
}
html = html.replace('</head>', `${STYLE}\n${SCRIPT}\n  </head>`);
fs.writeFileSync(h5Index, html, 'utf8');
console.log('[fix-h5-safearea] 注入完成:', h5Index);
