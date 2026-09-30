import { defineConfig } from 'vite';

// base './' 使产物使用相对路径,便于部署到 Cloudflare Pages 任意子路径
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1024,
  },
});
