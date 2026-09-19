import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base:'./' 是 file:// 加载的关键：产物全部相对路径，禁止绝对根路径
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    assetsInlineLimit: 8192,
    outDir: 'dist',
  },
});
