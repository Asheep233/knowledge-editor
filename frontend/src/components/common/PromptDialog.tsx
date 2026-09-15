/**
 * 应用内对话框（替换 window.prompt 与 window.confirm）。
 *
 * 背景 1（prompt）：WebView2 的 `window.prompt` 是**原生**实现，用户输入不可靠
 *   （输入值不返回 → `if (!name) return` 静默退出）——v1.1.1「新建文件夹」因此"点了没反应"。
 * 背景 2（confirm，2026-09-15 实测查明）：Tauri v2 **把 `window.confirm` 替换成了 async 函数**
 *   ```js
 *   window.confirm = async function(i){ return await invoke("plugin:dialog|confirm", {...}) }
 *   ```
 *   于是它**恒返回 Promise（truthy）**，而本仓库 17 处写法是
 *   `if (!window.confirm(...)) return` —— 判定永为假 → **确认全部被静默绕过**：
 *   删文档/删文件夹/彻底删除/清空回收站/丢弃未保存修改**都不问就执行**。
 *   叠加 `capabilities/default.json` 的 `dialog:default` **不含 `allow-confirm`**
 *   （实测只授予 allow-message / allow-save / allow-open）→ 返回 rejected Promise，
 *   **仍是 truthy**，同样被绕过。
 *   → 结论：**不能依赖原生 confirm，也不该依赖 ACL**；统一改自绘。
 *
 * 本模块提供 Promise 式 `askPrompt` / `askConfirm` + 自绘模态（输入框或确认文案、
 * 确定/取消、Enter/Escape）。**确定性可测**，且不受 WebView2/Tauri 原生对话框行为影响。
 *
 * ⚠️ 调用方必须 `await`（参见 `frontend/src/components/common/no-native-dialog.test.ts`
 * 的回归守卫：源码中再用 `window.confirm` 会直接测试失败）。
 */
import { useCallback, useState, type ReactNode } from 'react'

interface PromptState {
  title: string
  defaultValue?: string
  resolve: (v: string | null) => void
}

interface ConfirmState {
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
  resolve: (ok: boolean) => void
}

type DialogState =
  | ({ kind: 'prompt' } & PromptState)
  | ({ kind: 'confirm' } & ConfirmState)

let activeDialog: DialogState | null = null
let setterRef: ((s: DialogState | null) => void) | null = null

/**
 * 打开输入弹窗（任意位置可调用，无需 hook）。
 * @returns Promise<string | null>：null = 取消
 */
export function askPrompt(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    activeDialog = { kind: 'prompt', title, defaultValue, resolve }
    setterRef?.(activeDialog)
  })
}

export interface AskConfirmOptions {
  /** 确定按钮文案（默认「确定」，删除类建议传「删除」） */
  confirmText?: string
  cancelText?: string
  /** 危险操作：确定按钮用警示色，且**初始焦点落在「取消」**（防误触回车） */
  danger?: boolean
}

/**
 * 打开确认弹窗（替代 `window.confirm`）。
 * @returns Promise<boolean>：true = 用户确认，false = 取消/Escape/关闭
 */
export function askConfirm(message: string, opts: AskConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    activeDialog = {
      kind: 'confirm',
      message,
      confirmText: opts.confirmText ?? '确定',
      cancelText: opts.cancelText ?? '取消',
      danger: opts.danger ?? false,
      resolve,
    }
    setterRef?.(activeDialog)
  })
}

/** 建议在组件内使用的 hook（返回同一 ask 函数）。 */
export function usePrompt() {
  return askPrompt
}

export function PromptHost() {
  const [state, setState] = useState<DialogState | null>(null)
  const [value, setValue] = useState('')
  setterRef = setState

  // 每次打开重置输入值（默认值预填而非占位——修「上次输入内容残留」；
  // 调用方传默认值的语义 = 预填文本）
  const [lastState, setLastState] = useState<DialogState | null>(null)
  if (state !== lastState) {
    setLastState(state)
    if (state?.kind === 'prompt') setValue(state.defaultValue ?? '')
  }

  const closePrompt = useCallback(
    (result: string | null) => {
      const s = state
      setState(null)
      if (s?.kind === 'prompt') s.resolve(result)
    },
    [state],
  )

  const closeConfirm = useCallback(
    (ok: boolean) => {
      const s = state
      setState(null)
      if (s?.kind === 'confirm') s.resolve(ok)
    },
    [state],
  )

  if (!state) return null

  const overlay = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/40'

  if (state.kind === 'confirm') {
    return (
      <div className={overlay} role="dialog" aria-modal="true" aria-label={state.message}>
        <div className="w-[420px] max-w-[90vw] rounded-xl border border-border bg-popover p-5 shadow-lg">
          <div className="mb-4 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            {state.message}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              autoFocus={state.danger}
              onClick={() => closeConfirm(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeConfirm(false)
              }}
              className="h-8 rounded-md border border-border bg-background px-3 text-[13px] text-foreground/80 transition-colors hover:bg-muted"
            >
              {state.cancelText}
            </button>
            <button
              type="button"
              autoFocus={!state.danger}
              onClick={() => closeConfirm(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') closeConfirm(true)
                else if (e.key === 'Escape') closeConfirm(false)
              }}
              className={
                state.danger
                  ? 'h-8 rounded-md bg-rose-600 px-3 text-[13px] font-medium text-white transition-all hover:brightness-95'
                  : 'h-8 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-all hover:brightness-95'
              }
            >
              {state.confirmText}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={overlay} role="dialog" aria-modal="true">
      <div className="w-[420px] max-w-[90vw] rounded-xl border border-border bg-popover p-5 shadow-lg">
        <div className="mb-3 text-[14px] font-semibold text-foreground">{state.title}</div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') closePrompt(value || null)
            else if (e.key === 'Escape') closePrompt(null)
          }}
          className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => closePrompt(null)}
            className="h-8 rounded-md border border-border bg-background px-3 text-[13px] text-foreground/80 transition-colors hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => closePrompt(value || null)}
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
