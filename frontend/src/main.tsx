import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { setupCloseHandshake } from './desktop'
import { waitForRuntimeBase } from './state/runtimeWait'
import './index.css'
import App from './App'
import { applyTheme, loadSettings } from './settings'

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
 * Phase 7 M3.1：release（custom-protocol）下内嵌资源加载极快，React bundle 执行可能
 * 早于 WebView2 IPC 通道就绪，首次 invoke 会失败。且 Rust sidecar 冷启动/全量重建索引
 * 可能需 5–30s（P1-13），因此等待窗口对齐 30s：优先监听 Rust 注入的 `ke:runtime-ready`
 * 事件，事件没来则轮询 `get_runtime_info` 直到成功或超时，避免 4s 放弃后再也不恢复。
 * 不能依赖 UA 判断（Tauri 不修改 WebView2 UA）；非 Tauri 环境立即回退。
 */
async function resolveApiBase(): Promise<string | null> {
  const isTauriHost = typeof location !== 'undefined' && location.hostname === 'tauri.localhost'
  const hasInternals = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (!isTauriHost && !hasInternals) {
    return null
  }

  const probe = async (): Promise<string | null> => {
    if (!('__TAURI_INTERNALS__' in window)) return null
    try {
      const info = await invoke<RuntimeInfo>('get_runtime_info')
      return info.api_base
    } catch {
      return null
    }
  }

  // 事件驱动：Rust 在 sidecar 健康成功后 emit 'ke:runtime-ready'，payload 直接带出
  // { api_base, workspace, version, pid, port }。这里优先用事件里的 api_base 注入，
  // 事件没带/超时才回退到 probe（invoke get_runtime_info）与轮询。
  const waitForRuntimeEvent = (_name: string, timeoutMs: number) =>
    new Promise<string | null>((resolve) => {
      let unlistenFn: (() => void) | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (val: string | null) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        unlistenFn?.()
        resolve(val)
      }
      void import('@tauri-apps/api/event')
        .then(({ listen }) =>
          listen<{ api_base?: string }>('ke:runtime-ready', (e) => {
            const base = e.payload?.api_base
            if (base) finish(base)
          }),
        )
        .then((un) => {
          unlistenFn = () => void un()
        })
        .catch(() => finish(null))
      timer = setTimeout(() => finish(null), timeoutMs)
    })

  return waitForRuntimeBase({
    probe,
    timeoutMs: 30000,
    pollMs: 100,
    waitForEvent: waitForRuntimeEvent,
  })
}

async function bootstrap() {
  const apiBase = await resolveApiBase()
  if (apiBase) {
    window.__KE_API_BASE__ = apiBase
    console.info('[ke] 运行时注入 API 基址:', window.__KE_API_BASE__)
  }
  // handoff §8.3：渲染前应用主题，避免首屏闪烁（App 内启动 effect 幂等兜底）
  try {
    const settings = await loadSettings()
    applyTheme(settings.ui.theme, settings.ui.accentColor)
  } catch {
    /* 设置不可用：保持默认浅色 */
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  // P1-14 桌面关窗 flush 握手（仅桌面环境生效）
  void setupCloseHandshake()
}

void bootstrap()
