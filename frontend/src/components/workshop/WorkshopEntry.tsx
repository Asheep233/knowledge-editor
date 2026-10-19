/**
 * UI 工坊 P3-T23/T21：工坊入口（feature flag 控制）。
 *
 * - `enabled=false`（默认）时不渲染任何内容 → 既有 App/测试零影响；
 * - `enabled=true` 时显示「创意工坊」按钮，打开控制面面板；适配器默认走产品 Tauri 包命令，
 *   测试/嵌入可注入替身。
 */
import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'

import { createTauriPackAdapter } from '../../core/packs/tauriPackAdapter'
import { WorkshopPanel, startupRecoverActions, type WorkshopAdapter } from './WorkshopPanel'

export interface WorkshopEntryProps {
  enabled: boolean
  adapter?: WorkshopAdapter
}

interface StartupBadge {
  safeMode: boolean
  /** 非 clean 的启动恢复动作数（回滚/清理 journal 等） */
  actions: number
}

export function WorkshopEntry({ enabled, adapter }: WorkshopEntryProps) {
  const [open, setOpen] = useState(false)
  const [safeMode, setSafeMode] = useState(false)
  /** W07 C2-3：冷启动恢复结果角标（面板未打开也可见；无状态不显示、不误报） */
  const [startupBadge, setStartupBadge] = useState<StartupBadge | null>(null)
  // 适配器只创建一次（原实现每次 render 新建 → startupStatus 会被重复调用）
  const workshopAdapter = useMemo(() => adapter ?? createTauriPackAdapter(), [adapter])

  // W07 C2-3：挂载时**只读**读取启动恢复结果（复用 workshop_pack_startup_status；
  // Rust setup 的 workshop://recover-status 事件早于前端挂载会丢失，这里从持久状态文件补齐）。
  // 非 Tauri/旧构建/命令失败 → 静默降级（无角标、不误报）。
  useEffect(() => {
    if (!enabled) return
    const readStartupStatus = workshopAdapter.startupStatus
    if (!readStartupStatus) return
    let cancelled = false
    void readStartupStatus
      .call(workshopAdapter)
      .then((status) => {
        if (cancelled || !status?.found) return
        const actions = startupRecoverActions(status.results)
        if (!status.safeMode && actions.length === 0) return
        setStartupBadge({ safeMode: status.safeMode, actions: actions.length })
        // 冷启动 safeMode 事件可能已丢失 → 同步入口既有「safe mode」徽标
        if (status.safeMode) setSafeMode(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled, workshopAdapter])

  useEffect(() => {
    if (!enabled) return
    let unlisten: (() => void) | null = null
    void listen<{ safeMode?: boolean }>('workshop://recover-status', (event) => {
      setSafeMode(!!event.payload?.safeMode)
    })
      .then((fn) => {
        unlisten = fn
      })
      .catch(() => {
        /* 非 Tauri 环境（测试/浏览器）忽略 */
      })
    return () => unlisten?.()
  }, [enabled])
  if (!enabled) return null
  const startupBadgeText = startupBadge
    ? startupBadge.safeMode
      ? '启动恢复：存在无法自动恢复的包（safe mode）'
      : `启动恢复：已自动恢复 ${startupBadge.actions} 个包`
    : ''
  return (
    <>
      <button
        type="button"
        aria-label="打开创意工坊"
        className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
        onClick={() => setOpen(true)}
      >
        创意工坊
        {startupBadge && (
          <span
            role="status"
            data-testid="workshop-startup-badge"
            title={startupBadgeText}
            aria-label={startupBadgeText}
            className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800"
          >
            {startupBadge.safeMode ? '启动恢复告警' : `启动恢复 ${startupBadge.actions}`}
          </span>
        )}
        {safeMode && (
          <span role="status" className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">
            safe mode
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="创意工坊面板"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-[640px] flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-semibold">创意工坊</span>
              <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setOpen(false)}>
                关闭
              </button>
            </header>
            <WorkshopPanel adapter={workshopAdapter} />
          </div>
        </div>
      )}
    </>
  )
}
