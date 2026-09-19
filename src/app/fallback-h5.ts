/**
 * 离线兜底 H5（规则 5/26）：当没有可用本地 H5 版本时，WebView 加载此内置页面，
 * 保证 App 始终可启动，并演示通过 Bridge 调用 Native 能力（此处请求相机权限）。
 */
export const FALLBACK_H5_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>ERP Mobile</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; color: #111; }
    h2 { margin-top: 0; }
    #status { color: #555; min-height: 24px; margin: 12px 0; }
    button { padding: 10px 16px; border: 0; border-radius: 8px; background: #1677ff; color: #fff; font-size: 15px; }
  </style>
</head>
<body>
  <h2>ERP Mobile</h2>
  <p>这是内置兜底页面（离线可用）。</p>
  <p id="status">就绪</p>
  <button id="permBtn">请求相机权限</button>
  <script>
    function call(module, action, params) {
      var id = 'h5_' + Date.now();
      var req = { type: 'request', id: id, version: '1.0', module: module, action: action, params: params };
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(req));
      } else {
        document.getElementById('status').textContent = '不在 RN WebView 中';
      }
    }
    window.addEventListener('message', function (e) {
      try {
        var res = JSON.parse(e.data);
        document.getElementById('status').textContent = '结果: ' + JSON.stringify(res);
      } catch (err) {
        document.getElementById('status').textContent = '消息解析失败';
      }
    });
    document.getElementById('permBtn').onclick = function () {
      document.getElementById('status').textContent = '请求中...';
      call('permission', 'request', { permission: 'camera' });
    };
  </script>
</body>
</html>`;
