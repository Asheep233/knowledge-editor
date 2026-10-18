/**
 * UI 工坊 P3-T23/T21：工坊入口（feature flag 控制）。
 *
 * - `enabled=false`（默认）时不渲染任何内容 → 既有 App/测试零影响；
 * - `enabled=true` 时显示「创意工坊」按钮，打开控制面面板；适配器默认走产品 Tauri 包命令，
 *   测试/嵌入可注入替身。
 */
import { useState } from 'react'

import { createTauriPackAdapter } from '../../core/packs/tauriPackAdapter'
import { WorkshopPanel, type WorkshopAdapter } from './WorkshopPanel'

export interface WorkshopEntryProps {
  enabled: boolean
  adapter?: WorkshopAdapter
}

export function WorkshopEntry({ enabled, adapter }: WorkshopEntryProps) {
  const [open, setOpen] = useState(false)
  if (!enabled) return null
  const workshopAdapter = adapter ?? createTauriPackAdapter()
  return (
    <>
      <button
        type="button"
        aria-label="打开创意工坊"
        className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
        onClick={() => setOpen(true)}
      >
        创意工坊
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
