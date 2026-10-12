# Vue3 + Vite 子包搭建

## 1. 脚手架

```bash
npm create vite@latest h5-subapp -- --template vue
cd h5-subapp
npm install
npm install vue-router@4
```

> 使用 `assets/vue-template/` 可跳过：直接复制该目录即得可运行工程。

## 2. Vite 配置（file:// 关键）

`vite.config.js`：

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: './',            // 必须：相对路径，否则 file:// 下 /assets/ 404
  plugins: [vue()],
  build: {
    assetsInlineLimit: 8192, // 小于 8KB 的图片/字体内联 base64
    outDir: 'dist',
  },
});
```

## 3. 路由：必须 hash 模式

`src/router.js`：

```js
import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(), // 必须 hash，不能用 createWebHistory
  routes: [
    { path: '/', component: () => import('./views/Home.vue') },
    { path: '/about', component: () => import('./views/About.vue') },
  ],
});
export default router;
```

## 4. 引入 Bridge（api.js）

`index.html`（放在 `<head>` 或 body 顶部，先于业务脚本）：

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
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

`js/api.js` 直接使用基座 `h5/js/api.js`（保证协议一致）；开发期无基座时用模板自带版即可。

页面里使用：

```js
// 读取设备能力
const info = await window.RN.APP.GETINFO();
const dark = await window.RN.SYSTEM.GETDARKMODE();

// 订阅系统事件
window.RN.ON('system.darkmodechange', ({ mode }) => applyTheme(mode));
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
- `createWebHistory` 白屏 → 换 `createWebHashHistory`。
- `base` 忘了设 `'./'` → CSS/JS 绝对根路径，样式丢失。
- `js/api.js` 未放进 `public/` → 产物缺失，`window.RN` undefined。
- Vite dev server 端口与基座 Metro dev server 冲突时改 `server.port`。
