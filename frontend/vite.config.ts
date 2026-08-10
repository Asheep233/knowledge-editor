import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 注意: 不要在此文件顶层设置 ESBUILD_BINARY_PATH——esbuild 模块在加载本配置
// 之前已被 Vite 加载，环境变量来不及生效。esbuild 二进制重定向（改名副本）
// 统一由 scripts/ke-vite.mjs 在进程启动最早期处理。

// 缓存目录移出 node_modules: 本机沙箱保护 node_modules 目录，拦截其中的
// 目录 rename（Access is denied / ENOENT），导致依赖预构建 deps_temp -> deps
// 原子替换失败。workspace 下的目录 rename 不受限，故 cacheDir 指到此处。
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  cacheDir: '../workspace/.knowledgeeditor/vite-cache',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // 开发期代理到本地 backend sidecar（Tauri 内运行时直连同源服务）
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 输出目录使用 dist-build 而非 dist：本机虚拟化层在 dist 路径上残留
    // 幽灵文件（index-CDHoAOT-.js 等，可见不可删），tauri-build 扫描会将其
    // 列入资产清单导致 release 嵌入失败。新路径避开历史污染（见
    // CHANGELOG_DEV.md「release 嵌入 dist 幽灵文件」记录）。
    outDir: 'dist-build',
    sourcemap: false,
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
