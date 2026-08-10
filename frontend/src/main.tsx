import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import App from './App'

interface RuntimeInfo {
  api_base: string
  workspace: string
  version: string
}

/**
 * 桌面版启动引导（Phase 7 M2）：React 挂载前调用 Rust `get_runtime_info`，
 * 将实际 API 基址（如 http://127.0.0.1:8000）写入 `window.__KE_API_BASE__`，
 * client.ts 的 request/upload/export 等据此拼接绝对地址。
 * Web 开发（浏览器直连 Vite）与测试环境无 Tauri 运行时，不注入，回退相对路径（Vite 代理）。
 *
 * Phase 7 M3.1：release（custom-protocol）下内嵌资源加载极快，React bundle 执行
 * 可能早于 WebView2 IPC 通道就绪，首次 invoke 会失败导致误判「后端未连接」。
 * 因此将 invoke 纳入等待循环重试（10 次 × 400ms）。注意不能依赖 UA 判断（Tauri
 * 不修改 WebView2 UA）；桌面 release 页面 hostname 恒为 tauri.localhost，非 Tauri
 * 环境（Web/测试）立即回退，不做无谓等待。
 */
async function resolveApiBase(): Promise<string | null> {
  const isTauriHost = typeof location !== 'undefined' && location.hostname === 'tauri.localhost'
  const hasInternals = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (!isTauriHost && !hasInternals) {
    // 纯 Web / 测试环境：无 Tauri IPC，立即回退相对路径（Vite 代理）
    return null
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    if ('__TAURI_INTERNALS__' in window) {
      try {
        const info = await invoke<RuntimeInfo>('get_runtime_info')
        return info.api_base.replace(/\/+$/, '')
      } catch (e) {
        if (attempt === 9) {
          console.warn('[ke] 获取运行时信息失败，回退相对路径（Vite 代理）:', e)
        }
      }
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

async function bootstrap() {
  const apiBase = await resolveApiBase()
  if (apiBase) {
    window.__KE_API_BASE__ = apiBase
    console.info('[ke] 运行时注入 API 基址:', window.__KE_API_BASE__)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
