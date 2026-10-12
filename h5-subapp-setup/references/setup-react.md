# React + Vite 子包搭建

## 1. 脚手架

```bash
npm create vite@latest h5-subapp -- --template react
cd h5-subapp
npm install
npm install react-router-dom@6
```

> 使用 `assets/react-template/` 可跳过：直接复制该目录即得可运行工程。
> React 与 Vue 同样满足基座要求；选 React 的优势是基座为 RN（React 家族），技术栈统一。

## 2. Vite 配置（file:// 关键）

`vite.config.js`：

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',            // 必须：相对路径，否则 file:// 下 /assets/ 404
  plugins: [react()],
  build: {
    assetsInlineLimit: 8192, // 小于 8KB 的图片/字体内联 base64
    outDir: 'dist',
  },
});
```

## 3. 路由：必须 hash 模式

`src/main.jsx`：

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';

const router = createHashRouter([
  { path: '/', element: <div>首页</div> },
  { path: '/about', element: <div>关于</div> },
]);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
```

> 必须 `createHashRouter`，不能用 `createBrowserRouter`（file:// 下白屏）。

## 4. 引入 Bridge（api.js）

`index.html`（`<head>` 内先于业务脚本）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>H5 子应用</title>
    <script src="./js/api.js"></script> <!-- 相对路径，必须随包分发 -->
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

页面里使用：

```js
const info = await window.RN.APP.GETINFO();
const dark = await window.RN.SYSTEM.GETDARKMODE();
const off = window.RN.ON('system.darkmodechange', ({ mode }) => applyTheme(mode));
```

## 5. 构建与产物检查

```bash
npm run build
grep -r 'src="/' dist/ ; grep -r 'href="/' dist/   # 应无输出
grep 'js/api.js' dist/index.html                   # 确认相对引入
```

## 6. 常见坑

- Vite 构建提示 `<script src="./js/api.js"> can't be bundled without type="module"` →
  **预期行为**，非 module 脚本原样保留到产物（`dist/js/api.js` 完整存在即正确），无需处理。
- `createBrowserRouter` 白屏 → 换 `createHashRouter`。
- `base` 忘了设 `'./'` → 样式/脚本 404。
- `js/api.js` 未放 `public/` → 产物缺失，`window.RN` undefined。
- React 产物比 Vue 大约 10KB gzip（~40KB vs ~30KB），对子包升级影响可忽略。
