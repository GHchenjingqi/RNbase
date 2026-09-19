import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// base:'./' 是 file:// 加载的关键：产物全部相对路径，禁止绝对根路径
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    assetsInlineLimit: 8192,
    outDir: 'dist',
  },
});
