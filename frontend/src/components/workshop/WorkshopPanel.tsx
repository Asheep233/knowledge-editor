/**
 * UI 工坊 P3-T23（控制面 UI 骨架）：包管理/安装预览确认/回滚/修复。
 *
 * 设计：本组件只负责**渲染与收集用户操作**；包操作通过注入的 `WorkshopAdapter` 执行
 * （产品实现 = Tauri Rust 包命令；测试 = 内存替身）。所有安装都必须先走预览 + 显式确认
 * （安全门禁在 Core `PendingInstallGate`，本组件不提供绕过入口）。
 */
import { useCallback, useEffect, useState } from 'react'

export interface InstalledPackView {
  id: string
  name: string
  version: string
  active: boolean
  previous?: string | null
  capabilities: string[]
}

export interface CapabilityView {
  capability: string
  risk: 'low' | 'medium' | 'high'
  summary: string
}

export interface InstallPreviewView {
  token: string
  packId: string
  name: string
  version: string
  apiVersion: number
  source: 'local-file' | 'downloaded' | 'builtin'
  signature: 'valid' | 'missing' | 'invalid'
  capabilities: CapabilityView[]
  warnings: string[]
  blocked: boolean
  blockReason?: string
}

export interface RecoverResultView {
  recovered: boolean
  action: string
}

export interface WorkshopAdapter {
  listInstalled(): Promise<InstalledPackView[]>
  /** 用户选择本地包后返回预览（产品实现：扫描 manifest → 预览，不安装）。 */
  stageFromFile(): Promise<InstallPreviewView | null>
  confirmInstall(token: string): Promise<void>
  cancelPreview(token: string): boolean
  rollback(packId: string): Promise<void>
  recover(packId: string): Promise<RecoverResultView>
}

export interface WorkshopPanelProps {
  adapter: WorkshopAdapter
  /** 测试/嵌入时可关闭自动加载 */
  autoLoad?: boolean
}

const RISK_STYLE: Record<CapabilityView['risk'], string> = {
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-red-100 text-red-700',
}

export function WorkshopPanel({ adapter, autoLoad = true }: WorkshopPanelProps) {
  const [packs, setPacks] = useState<InstalledPackView[]>([])
  const [preview, setPreview] = useState<InstallPreviewView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setPacks(await adapter.listInstalled())
      setError(null)
    } catch (e) {
      setError(`加载已安装包失败：${String((e as Error)?.message ?? e)}`)
    }
  }, [adapter])

  useEffect(() => {
    if (autoLoad) void refresh()
  }, [autoLoad, refresh])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const onChoose = () =>
    run(async () => {
      setMessage(null)
      const staged = await adapter.stageFromFile()
      setPreview(staged)
      if (!staged) setMessage('未选择包')
    })

  const onConfirm = () =>
    run(async () => {
      if (!preview) return
      await adapter.confirmInstall(preview.token)
      setPreview(null)
      setMessage(`已安装 ${preview.name} ${preview.version}`)
      await refresh()
    })

  const onCancel = () => {
    if (!preview) return
    adapter.cancelPreview(preview.token)
    setPreview(null)
    setMessage('已取消安装')
  }

  const onRollback = (packId: string) =>
    run(async () => {
      await adapter.rollback(packId)
      setMessage(`已回滚 ${packId}`)
      await refresh()
    })

  const onRecover = (packId: string) =>
    run(async () => {
      const result = await adapter.recover(packId)
      setMessage(result.recovered ? `已恢复（${result.action}）` : `无需恢复（${result.action}）`)
      await refresh()
    })

  return (
    <section aria-label="创意工坊" className="flex flex-col gap-4 overflow-y-auto p-4 text-sm">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">创意工坊</h2>
          <p className="text-xs text-slate-500">安装前会展示包身份与能力影响，需显式确认</p>
        </div>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
          disabled={busy}
          onClick={onChoose}
        >
          选择包并预览…
        </button>
      </header>

      {message && (
        <div role="status" className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {preview && (
        <div aria-label="安装预览" className="rounded border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-semibold">安装预览</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">包</dt>
            <dd>{preview.packId}</dd>
            <dt className="text-slate-500">名称/版本</dt>
            <dd>
              {preview.name} {preview.version}
            </dd>
            <dt className="text-slate-500">来源</dt>
            <dd>{preview.source}</dd>
            <dt className="text-slate-500">签名</dt>
            <dd>{preview.signature}</dd>
          </dl>
          <div className="mt-2">
            <div className="text-xs text-slate-500">声明能力与影响</div>
            <ul className="mt-1 flex flex-col gap-1">
              {preview.capabilities.map((cap) => (
                <li key={cap.capability} className="flex items-center gap-2 text-xs">
                  <span className={`rounded px-1.5 py-0.5 ${RISK_STYLE[cap.risk]}`}>{cap.risk}</span>
                  <span className="font-mono">{cap.capability}</span>
                  <span className="text-slate-500">{cap.summary}</span>
                </li>
              ))}
            </ul>
          </div>
          {preview.warnings.length > 0 && (
            <ul aria-label="安装警告" className="mt-2 list-disc pl-5 text-xs text-amber-800">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {preview.blocked && (
            <div role="alert" className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
              {preview.blockReason ?? '该包被阻止安装'}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40"
              disabled={busy || preview.blocked}
              onClick={onConfirm}
            >
              确认安装
            </button>
            <button type="button" className="rounded border px-3 py-1.5 text-xs" disabled={busy} onClick={onCancel}>
              取消
            </button>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">已安装包</h3>
        {packs.length === 0 ? (
          <p className="text-xs text-slate-500">尚未安装任何包</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {packs.map((pack) => (
              <li key={pack.id} className="rounded border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      {pack.name} <span className="font-mono text-xs text-slate-500">{pack.id}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      版本 {pack.version}
                      {pack.previous ? `（可回滚到 ${pack.previous}）` : ''} · {pack.active ? '已激活' : '未激活'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs disabled:opacity-40"
                      disabled={busy || !pack.active || pack.version === pack.previous}
                      onClick={() => void onRollback(pack.id)}
                    >
                      回滚
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void onRecover(pack.id)}
                    >
                      修复/恢复
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
