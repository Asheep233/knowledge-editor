/**
 * 应用内输入弹窗（替换 window.prompt）。
 *
 * 背景：WebView2 的 window.prompt 原生对话框用户输入不可靠（输入值不返回，
 * `if (!name) return` 静默退出）——v1.1.1「新建文件夹」入口因此"点了没反应"。
 * 本组件提供 Promise 式 ask() + 自绘模态（输入框/确定/取消/Enter/Escape），
 * 供新建文档/文件夹、重命名、移动目标、链接地址、工作区路径等输入点统一使用。
 */
import { useCallback, useState, type ReactNode } from 'react'

interface PromptState {
  title: string
  defaultValue?: string
  resolve: (v: string | null) => void
}

let activePrompt: PromptState | null = null
let setterRef: ((s: PromptState | null) => void) | null = null

/**
 * 打开输入弹窗（任意位置可调用，无需 hook）。
 * @returns Promise<string | null>：null = 取消
 */
export function askPrompt(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    activePrompt = { title, defaultValue, resolve }
    setterRef?.(activePrompt)
  })
}

/** 建议在组件内使用的 hook（返回同一 ask 函数）。 */
export function usePrompt() {
  return askPrompt
}

export function PromptHost() {
  const [state, setState] = useState<PromptState | null>(null)
  const [value, setValue] = useState('')
  setterRef = setState

  // 每次打开重置输入值（默认值预填而非占位——修「上次输入内容残留」；
  // 调用方传默认值的语义 = 预填文本）
  const [lastState, setLastState] = useState<PromptState | null>(null)
  if (state !== lastState) {
    setLastState(state)
    if (state) setValue(state.defaultValue ?? '')
  }

  const close = useCallback((result: string | null) => {
    const s = state
    setState(null)
    s?.resolve(result)
  }, [state])

  if (!state) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" role="dialog" aria-modal>
      <div className="w-[420px] max-w-[90vw] rounded-xl border border-border bg-popover p-5 shadow-lg">
        <div className="mb-3 text-[14px] font-semibold text-foreground">{state.title}</div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close(value || null)
            else if (e.key === 'Escape') close(null)
          }}
          className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => close(null)}
            className="h-8 rounded-md border border-border bg-background px-3 text-[13px] text-foreground/80 transition-colors hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => close(value || null)}
            className="h-8 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-all hover:brightness-95"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

/** 应用根挂载：渲染弹窗宿主（App 顶层放置一次）。 */
export function PromptRoot({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PromptHost />
    </>
  )
}
