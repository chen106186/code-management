import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 页面源码在 src/renderer，产物给 Tauri 打包（见 src-tauri/tauri.conf.json 的 frontendDist）
export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: resolve('out/renderer'),
    emptyOutDir: true,
    // WebView2 跟随 Edge 更新，可以直接用新语法
    target: 'es2022'
  }
})
