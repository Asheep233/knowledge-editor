/**
 * UI 工坊 P3-T23（控制面 UI 骨架）：包管理/安装预览确认/回滚/修复。
 *
 * 设计：本组件只负责**渲染与收集用户操作**；包操作通过注入的 `WorkshopAdapter` 执行
 * （产品实现 = Tauri Rust 包命令；测试 = 内存替身）。所有安装都必须先走预览 + 显式确认
 * （安全门禁在 Core `PendingInstallGate`，本组件不提供绕过入口）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { TrustTier } from '../../core/packs/trustPolicy'
import type { ProductHostBackend } from '../../core/packs/productHostAdapter'
import { WorkshopGuestFrame } from './WorkshopGuestFrame'

export interface InstalledPackView {
  id: string
  name: string
  version: string
  active: boolean
  previous?: string | null
  capabilities: string[]
  /** 信任等级（来自 TrustStore 持久化；缺省 community） */
  tier?: TrustTier
  /** 签名状态（产品验证后填入；缺省 unknown） */
  signature?: 'valid' | 'missing' | 'invalid'
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
  source: 'local-file' | 'downloaded' | 'builtin' | 'zip-file'
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

export interface RecoverAllView {
  checked: number
  safeMode: boolean
  results?: unknown
}

/** W07 C：启动恢复单包结果（Rust `recover_all` result 子集；字段缺失时容错展示）。 */
export interface StartupRecoverResultView {
  id?: string
  recovered?: boolean
  action?: string
  state?: unknown
  error?: string | null
}

/**
 * W07 C1-4/C2-2/C3-5：启动时 recover 结果（Rust `workshop_pack_startup_status` 只读命令）。
 * 面板打开时读取一次，展示自动回滚/清理/safeMode 结果（此前只有手动「检查/修复全部包」后才可见）。
 */
export interface StartupRecoverView {
  found: boolean
  checked: number
  safeMode: boolean
  results: StartupRecoverResultView[]
  generatedAt?: string | null
}

/** 已知恢复动作 → 中文说明（未知动作原样展示，不臆造语义）。 */
const RECOVER_ACTION_LABEL: Record<string, string> = {
  'rollback-corrupt-active': '已回滚到上一版本',
  'cleanup-journal': '已清理中断安装残留',
  'corrupt-no-fallback': '损坏且无可用回退（需手动处理）',
  clean: '无需恢复',
}

/** W07 C：从启动恢复结果中筛出「真实恢复动作」（clean/缺失不算，避免无状态误报）。 */
export function startupRecoverActions(results: StartupRecoverResultView[] | undefined): StartupRecoverResultView[] {
  if (!Array.isArray(results)) return []
  return results.filter(
    (r) =>
      !!r &&
      (r.recovered === true || (typeof r.action === 'string' && r.action.length > 0 && r.action !== 'clean')),
  )
}

export interface WorkshopAdapter {
  listInstalled(): Promise<InstalledPackView[]>
  /** 用户选择本地包后返回预览（产品实现：扫描 manifest → 预览，不安装）。 */
  stageFromFile(): Promise<InstallPreviewView | null>
  confirmInstall(token: string): Promise<void>
  cancelPreview(token: string): boolean
  rollback(packId: string): Promise<void>
  recover(packId: string): Promise<RecoverResultView>
  /** 全部包启动恢复（产品壳 workshop_pack_recover_all；可选能力） */
  recoverAll?(): Promise<RecoverAllView>
  /** W07 C：读取启动恢复结果（产品壳 workshop_pack_startup_status，只读；可选能力） */
  startupStatus?(): Promise<StartupRecoverView>
  /** 卸载包（可选能力） */
  uninstall?(packId: string): Promise<void>
  /** 信任等级读取/授予/撤销（可选能力；产品=T24 TrustStore） */
  tierOf?(packId: string): Promise<TrustTier>
  grantTrust?(packId: string, tier: TrustTier): Promise<void>
  revokeTrust?(packId: string): Promise<void>
  /** A7：创建产品 guest 宿主后端（可选能力；有则允许启用/停用 guest） */
  createGuestBackend?(): ProductHostBackend
  /** W01：选择 ZIP 离线包并预览（可选能力） */
  stageFromZip?(): Promise<InstallPreviewView | null>
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
  const [recoverStatus, setRecoverStatus] = useState<RecoverAllView | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null)
  /** W07 C：启动恢复结果（只读读取；无动作/无文件 → null，不误报） */
  const [startupStatus, setStartupStatus] = useState<StartupRecoverView | null>(null)
  const [startupNoticeDismissed, setStartupNoticeDismissed] = useState(false)
  const startupLoadedRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const list = await adapter.listInstalled()
      if (adapter.tierOf) {
        await Promise.all(
          list.map(async (pack) => {
            try {
              pack.tier = await adapter.tierOf!(pack.id)
            } catch {
              pack.tier = 'community'
            }
          }),
        )
      }
      setPacks(list)
      setError(null)
    } catch (e) {
      setError(`加载已安装包失败：${String((e as Error)?.message ?? e)}`)
    }
  }, [adapter])

  useEffect(() => {
    if (autoLoad) void refresh()
  }, [autoLoad, refresh])

  // W07 C1-4/C2-2/C3-5：面板打开时**只读**读取启动恢复结果（绝不调 recover_all）。
  // Rust setup 的 `workshop://recover-status` 事件早于前端挂载会丢失 → 从持久状态文件补齐；
  // 有真实恢复动作或 safeMode 才展示 notice，并预置 recoverStatus 让既有 safeMode 横幅立即显示。
  useEffect(() => {
    if (!autoLoad || startupLoadedRef.current) return
    const readStartupStatus = adapter.startupStatus
    if (!readStartupStatus) return
    startupLoadedRef.current = true
    let cancelled = false
    void readStartupStatus
      .call(adapter)
      .then((status) => {
        if (cancelled || !status?.found) return
        const actions = startupRecoverActions(status.results)
        if (!status.safeMode && actions.length === 0) return
        setStartupStatus(status)
        setRecoverStatus({ checked: status.checked, safeMode: status.safeMode, results: status.results })
      })
      .catch(() => undefined) // 旧构建/命令缺失 → 静默（不误报、不阻塞面板）
    return () => {
      cancelled = true
    }
  }, [adapter, autoLoad])

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

  const onChooseZip = () =>
    run(async () => {
      if (!adapter.stageFromZip) return
      setMessage(null)
      const staged = await adapter.stageFromZip()
      setPreview(staged)
      if (!staged) setMessage('未选择 ZIP 包')
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

  const onRecoverAll = () =>
    run(async () => {
      if (!adapter.recoverAll) return
      const status = await adapter.recoverAll()
      setRecoverStatus(status)
      setMessage(`已检查 ${status.checked} 个包${status.safeMode ? '（存在无法自动恢复的包）' : ''}`)
      await refresh()
    })

  const onUninstall = (packId: string) =>
    run(async () => {
      if (!adapter.uninstall) return
      setConfirmUninstall(null)
      await adapter.uninstall(packId)
      setMessage(`已卸载 ${packId}`)
      await refresh()
    })

  const onGrantTrust = (packId: string, tier: TrustTier) =>
    run(async () => {
      if (!adapter.grantTrust) return
      await adapter.grantTrust(packId, tier)
      setMessage(`已将 ${packId} 设为 ${tier}`)
      await refresh()
    })

  const onRevokeTrust = (packId: string) =>
    run(async () => {
      if (!adapter.revokeTrust) return
      await adapter.revokeTrust(packId)
      setMessage(`已撤销 ${packId} 的信任（community）`)
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
        <div className="flex gap-2">
          {adapter.recoverAll && (
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
              disabled={busy}
              onClick={() => void onRecoverAll()}
            >
              检查/修复全部包
            </button>
          )}
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={busy}
            onClick={onChoose}
          >
            选择包并预览…
          </button>
          {adapter.stageFromZip && (
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
              disabled={busy}
              onClick={() => void onChooseZip()}
            >
              选择 ZIP 离线包…
            </button>
          )}
        </div>
      </header>

      {startupStatus && !startupNoticeDismissed && (
        <div
          data-testid="startup-recover-notice"
          role="status"
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">
                {startupStatus.safeMode
                  ? '启动恢复：存在无法自动恢复的包（safe mode）'
                  : `启动恢复：已自动恢复 ${startupRecoverActions(startupStatus.results).length} 个包`}
              </div>
              {startupRecoverActions(startupStatus.results).length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {startupRecoverActions(startupStatus.results).map((result, index) => (
                    <li key={`${result.id ?? 'pack'}-${result.action ?? 'action'}-${index}`}>
                      {result.id ?? '未知包'}：
                      {RECOVER_ACTION_LABEL[result.action ?? ''] ?? result.action ?? '已处理'}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1 opacity-70">
                共检查 {startupStatus.checked} 个包
                {startupStatus.generatedAt ? ` · ${startupStatus.generatedAt}` : ''}
              </div>
            </div>
            <button
              type="button"
              aria-label="关闭启动恢复提示"
              className="shrink-0 rounded border border-amber-300 px-2 py-0.5"
              onClick={() => setStartupNoticeDismissed(true)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
      {recoverStatus?.safeMode && (
        <div role="alert" className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          有包无法自动恢复（safe mode）：请检查版本完整性/回滚或重新安装。
        </div>
      )}
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
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <span role="status" className="rounded bg-slate-100 px-1.5 py-0.5">
                        信任：{pack.tier ?? 'community'}
                      </span>
                      {pack.signature && (
                        <span className={`rounded px-1.5 py-0.5 ${pack.signature === 'valid' ? 'bg-emerald-100 text-emerald-800' : pack.signature === 'invalid' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                          签名：{pack.signature}
                        </span>
                      )}
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
                    {adapter.grantTrust && (
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs disabled:opacity-40"
                        disabled={busy || pack.tier === 'trusted' || pack.tier === 'builtin'}
                        onClick={() => void onGrantTrust(pack.id, 'trusted')}
                      >
                        授予信任
                      </button>
                    )}
                    {adapter.revokeTrust && (
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs disabled:opacity-40"
                        disabled={busy || (pack.tier ?? 'community') === 'community'}
                        onClick={() => void onRevokeTrust(pack.id)}
                      >
                        撤销信任
                      </button>
                    )}
                    {adapter.createGuestBackend && pack.active && (
                      <WorkshopGuestFrame
                        packId={pack.id}
                        version={pack.version}
                        tier={pack.tier ?? 'community'}
                        backend={adapter.createGuestBackend()}
                      />
                    )}
                    {adapter.uninstall && (
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs text-red-600 disabled:opacity-40"
                        disabled={busy}
                        onClick={() => setConfirmUninstall(pack.id)}
                      >
                        卸载
                      </button>
                    )}
                  </div>
                </div>
                {confirmUninstall === pack.id && (
                  <div role="alertdialog" aria-label={`确认卸载 ${pack.id}`} className="mt-2 flex items-center gap-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                    <span>确定卸载 {pack.id}？该包版本目录会被删除。</span>
                    <button type="button" className="rounded border px-2 py-0.5" disabled={busy} onClick={() => void onUninstall(pack.id)}>
                      确认卸载
                    </button>
                    <button type="button" className="rounded border px-2 py-0.5" onClick={() => setConfirmUninstall(null)}>
                      取消
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
