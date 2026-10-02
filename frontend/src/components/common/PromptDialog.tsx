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
import { useCallback, useEffect, useState, type ReactNode } from 'react'
// F5：Enter/Escape 必须避让输入法 —— 组词中的回车 = 上屏候选词、Escape = 取消组词，
// 不是「确定/取消弹窗」（否则中文输入时弹窗会被半截输入误关/误提交）。
import { shouldIgnoreReactKeyEvent } from '../../state/shortcuts'

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
 * F1（UI-3）：后到的请求**排队**等待，而不是覆盖 `activeDialog`。
 * 覆盖会让先发起的 Promise 永久悬挂（await 它的调用方卡死），且被覆盖的请求永远拿不到用户决定。
 * 选队列而非「第二个请求立即以取消值返回」的理由：本模块的存在意义就是「确认/输入必须来自用户」，
 * 静默伪造「取消」会让调用方无法区分用户取消与系统取消（对删除类操作是一次伪造的否定决定）。
 */
const pendingDialogs: DialogState[] = []

/** F1：入队或直接展示（同一时刻只允许一个弹窗） */
function openDialog(d: DialogState): void {
  if (activeDialog) {
    pendingDialogs.push(d)
    return
  }
  activeDialog = d
  setterRef?.(d)
}

/**
 * F1：结算当前弹窗并推进队列。
 * 不变量：`activeDialog` **先**清空/前移，再 resolve —— 不留已 settle 的悬挂引用，
 * 且 Promise 的 await 续体（可能再次调用 ask*）一定排在新的活动项之后。
 */
function finishDialog(d: DialogState, result: string | null | boolean): void {
  if (activeDialog === d) {
    activeDialog = pendingDialogs.shift() ?? null
  } else {
    const i = pendingDialogs.indexOf(d)
    if (i >= 0) pendingDialogs.splice(i, 1)
  }
  setterRef?.(activeDialog)
  if (d.kind === 'prompt') d.resolve(result as string | null)
  else d.resolve(result as boolean)
}

/** 按「取消」结算一条请求（宿主已卸载时取不到用户决定，只能明确失败而不是永久挂起） */
function cancelDialog(d: DialogState): void {
  if (d.kind === 'prompt') d.resolve(null)
  else d.resolve(false)
}

/**
 * F1×R08 收口：结算并清空**全部**未决请求（前台 + 队列）。
 *
 * 与 R08 的分工：R08 只覆盖「宿主**从未**挂载」（`setterRef === null`）。但「宿主挂载过、
 * 弹窗还没答完就卸载」（App 分支切换 / 关闭工作区）此前没有任何结算路径 —— `setterRef`
 * 被清空、React 树已消失，前台与队列里的 Promise **永久悬挂**。这正是本工单要根除的那类
 * 静默卡死，故卸载时必须按「取消」明确结算，并打印可诊断日志（不静默丢弃）。
 */
function abortAllPendingDialogs(reason: string): void {
  const active = activeDialog
  const queued = pendingDialogs.splice(0)
  activeDialog = null
  if (!active && queued.length === 0) return
  console.error(
    `[PromptDialog] ${reason}，${queued.length + (active ? 1 : 0)} 个未决请求按「取消」结算`,
  )
  if (active) cancelDialog(active)
  for (const d of queued) cancelDialog(d)
}

/** 测试钩子：观察全局单例状态（active = 当前弹窗类型；queued = 排队数量） */
export function __promptDialogStateForTests(): { active: DialogState['kind'] | null; queued: number } {
  return { active: activeDialog?.kind ?? null, queued: pendingDialogs.length }
}

/** 测试钩子：清空模块级单例与队列（生产不使用；避免用例之间互相污染） */
export function __resetPromptDialogForTests(): void {
  activeDialog = null
  pendingDialogs.length = 0
}

/**
 * 打开输入弹窗（任意位置可调用，无需 hook）。
 * @returns Promise<string | null>：null = 取消
 */
export function askPrompt(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    if (!setterRef) {
      // R08（2026-10-02 独立审查）：宿主（PromptHost）未挂载时**必须明确失败**——
      // 此前 Promise 永不 settle，调用方 `await askPrompt(...)` 永久挂起，表现为
      // 「点了没反应」（Web 工作区选择页「打开已有工作区」实测）。这里按「取消」立即
      // 结算：调用方可以继续走 fallback，而不是静默卡死。
      console.error('[PromptDialog] PromptHost 未挂载，askPrompt 立即取消：', title)
      resolve(null)
      return
    }
    openDialog({ kind: 'prompt', title, defaultValue, resolve })
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
    if (!setterRef) {
      // R08：同 askPrompt —— 宿主未挂载时立即按「取消」结算，绝不返回永不 settle 的 Promise
      console.error('[PromptDialog] PromptHost 未挂载，askConfirm 立即取消：', message)
      resolve(false)
      return
    }
    openDialog({
      kind: 'confirm',
      message,
      confirmText: opts.confirmText ?? '确定',
      cancelText: opts.cancelText ?? '取消',
      danger: opts.danger ?? false,
      resolve,
    })
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

  // R08：宿主卸载后清空 setterRef，使「宿主未挂载」可被 ask* 可靠检测到
  // （否则 ref 会一直指向已卸载组件的 setState：调用无效 → Promise 永不 settle）。
  // F1 补 1：同时清空模块级 activeDialog / 队列 —— 否则重新挂载后，这个「幽灵活动项」
  //   会把新请求全部挤进队列（弹窗永不出现）。
  // F1 补 2：清空**之前**必须先把未决请求按「取消」结算（abortAllPendingDialogs）——
  //   静默清空 = 调用方 await 永久悬挂；这正是本工单要根除的缺陷。
  useEffect(
    () => () => {
      if (setterRef === setState) setterRef = null
      abortAllPendingDialogs('PromptHost 已卸载')
    },
    [],
  )

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
      if (s?.kind === 'prompt') finishDialog(s, result)
    },
    [state],
  )

  const closeConfirm = useCallback(
    (ok: boolean) => {
      const s = state
      if (s?.kind === 'confirm') finishDialog(s, ok)
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
                if (shouldIgnoreReactKeyEvent(e)) return
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
                if (shouldIgnoreReactKeyEvent(e)) return
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
            if (shouldIgnoreReactKeyEvent(e)) return
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
