import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { APPEARANCE_CONTRACT, EXAMPLE_APPEARANCE, validateAppearance } from '../../appearance/model'
import {
  applyAppearance,
  cancelAppearancePreview,
  exportAppearance,
  exportAppearanceBackup,
  getAppearanceState,
  getAppearanceStatus,
  getPreviewAppearance,
  previewAppearance,
  resetAppearance,
  rollbackAppearance,
} from '../../appearance/controller'

const BUTTON = 'rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50'
const PREVIEW_BUTTON: CSSProperties = {
  border: '1px solid #6b7280', borderRadius: 6, padding: '6px 12px',
  backgroundColor: '#ffffff', color: '#111827', font: 'inherit', cursor: 'pointer',
}

/** The draft is deliberately independent from controller events, including preview expiry. */
export default function AppearanceSection() {
  const [state, setState] = useState(getAppearanceState)
  const [status, setStatus] = useState(getAppearanceStatus)
  const [draft, setDraft] = useState(() => {
    const current = getAppearanceState().current
    return current ? JSON.stringify(current, null, 2) : ''
  })
  const [errors, setErrors] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewButtonRef = useRef<HTMLButtonElement>(null)
  const wasPreviewing = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const sync = () => {
      setState(getAppearanceState())
      setStatus(getAppearanceStatus())
      setNow(Date.now())
    }
    window.addEventListener('ke:appearance-changed', sync)
    sync()
    return () => {
      alive.current = false
      window.removeEventListener('ke:appearance-changed', sync)
      cancelAppearancePreview()
    }
  }, [])

  useEffect(() => {
    if (status.mode !== 'preview') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status.mode, status.previewExpiresAt])

  useEffect(() => {
    if (wasPreviewing.current && status.mode !== 'preview') previewButtonRef.current?.focus()
    wasPreviewing.current = status.mode === 'preview'
  }, [status.mode])

  const refresh = () => {
    setState(getAppearanceState())
    setStatus(getAppearanceStatus())
    setNow(Date.now())
  }

  const reportError = (error: unknown) => {
    setErrors([error instanceof Error ? error.message : String(error)])
    setFeedback('')
  }

  const check = () => {
    const result = validateAppearance(draft)
    setErrors(result.ok ? [] : result.errors)
    setFeedback(result.ok ? `校验通过：${result.package.name}（${result.package.version}）` : '')
    return result
  }

  const run = async (action: () => void | Promise<unknown>, message: string) => {
    setBusy(true)
    setErrors([])
    setFeedback('')
    try {
      await action()
      if (alive.current) {
        refresh()
        setFeedback(message)
      }
    } catch (error) {
      if (alive.current) reportError(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const preview = () => {
    const result = check()
    if (!result.ok) return
    void run(() => { previewAppearance(result.package, 30_000) }, '正在预览；30 秒后自动恢复，应用后保存。')
  }

  const apply = () => {
    const result = check()
    if (!result.ok) return
    void run(() => applyAppearance(result.package), '外观已应用并保存。')
  }

  const keepPreview = () => {
    // An SDK caller may have replaced the preview after the settings draft was written.
    const pkg = getPreviewAppearance()
    if (!pkg) {
      refresh()
      return
    }
    void run(() => applyAppearance(pkg), '外观已应用并保存。')
  }

  const cancelPreview = () => {
    cancelAppearancePreview()
    refresh()
    setErrors([])
    setFeedback('已取消预览，恢复已保存的外观。')
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    setErrors([])
    setFeedback('')
    if (file.size > APPEARANCE_CONTRACT.maxBytes) {
      setErrors([`外观文件不能超过 ${APPEARANCE_CONTRACT.maxBytes / 1024} KB。`])
      return
    }
    setBusy(true)
    try {
      const source = await file.text()
      if (!alive.current) return
      setDraft(source)
      const result = validateAppearance(source)
      setErrors(result.ok ? [] : result.errors)
      if (result.ok) setFeedback(`已载入 ${file.name}；可先预览再应用。`)
    } catch (error) {
      if (alive.current) reportError(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const download = (backup: boolean) => {
    setErrors([])
    try {
      const json = backup ? exportAppearanceBackup() : exportAppearance()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      const anchor = document.createElement('a')
      const id = state.current?.id.replace(/[^a-zA-Z0-9_-]/g, '-') || 'default'
      anchor.href = url
      anchor.download = backup ? 'knowledge-editor-appearance-backup.json' : `appearance-${id}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setFeedback(backup || status.mode === 'fallback'
        ? '已导出原始配置，可交给 agent 提取或修复外观包。'
        : '已导出外观 JSON，可交给 agent 修改后导入。')
    } catch (error) {
      reportError(error)
    }
  }

  const remaining = Math.max(0, Math.ceil(((status.previewExpiresAt ?? now) - now) / 1000))
  const currentLabel = state.current ? `${state.current.name} · ${state.current.version}` : '内置默认外观'

  return (
    <div className="mt-4 rounded-lg border border-border bg-card" data-testid="appearance-section">
      <div className="border-b border-border px-4 py-3.5">
        <h3 className="text-[14px] font-medium text-foreground">自定义 UI 外观</h3>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
          通过外观包调整颜色、字体、控件圆角、侧栏宽度及左右布局。文档内容与编辑、搜索等已有功能不受影响。
          将外观 JSON 交给 agent 修改，再导入这里即可使用。
        </p>
        <p className="mt-2 text-[12px] text-foreground" data-testid="appearance-current">
          当前：{status.mode === 'fallback' ? '内置默认外观（原配置已保留）' : currentLabel}
        </p>
        {status.mode === 'preview' && createPortal(
          <section aria-label="外观预览确认" data-testid="appearance-preview-bar" data-ke-toolbar="" style={{
            position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10_000,
            width: 'min(680px, calc(100vw - 24px))', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
            boxSizing: 'border-box', border: '1px solid #6b7280', borderRadius: 10, padding: 16,
            backgroundColor: '#ffffff', color: '#111827', boxShadow: '0 8px 32px #00000033',
            fontFamily: 'system-ui, sans-serif', fontSize: 13, lineHeight: 1.5,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <p style={{ margin: 0 }}>
                <strong>正在预览外观</strong><br />
                {remaining} 秒后自动恢复；保留后保存并返回设置。
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" disabled={busy} style={{ ...PREVIEW_BUTTON, opacity: busy ? 0.5 : 1 }}
                  onClick={cancelPreview}>取消预览</button>
                <button type="button" autoFocus disabled={busy} onClick={keepPreview}
                  style={{ ...PREVIEW_BUTTON, backgroundColor: '#111827', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>
                  {busy ? '正在保存…' : '保留此外观'}
                </button>
              </div>
            </div>
            {errors.length > 0 && (
              <ul role="alert" style={{ margin: '8px 0 0', paddingLeft: 20, color: '#b91c1c' }}>
                {errors.map((error, index) => <li key={index}>{error}</li>)}
              </ul>
            )}
          </section>, document.body,
        )}
        {status.mode === 'fallback' && (
          <p role="alert" className="mt-2 text-[12px] leading-5 text-rose-600" data-testid="appearance-fallback">
            当前未启用自定义外观，已使用默认外观。{status.reason ? `原因：${status.reason}。` : ''}
            原始配置已保留，可导出备份交给 agent 更新后重新导入。
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={busy || status.mode === 'default'}
            style={{ color: '#111827', backgroundColor: '#ffffff', borderColor: '#6b7280' }}
            onClick={() => { void run(resetAppearance, '已恢复默认外观，可回滚到上一个外观。') }}>恢复默认</button>
          <button type="button" className={BUTTON} disabled={busy || (!state.current && !state.previous)}
            onClick={() => { void run(rollbackAppearance, '已回滚到上一个外观。') }}>回滚上一个</button>
          <button type="button" className={BUTTON} disabled={busy || (!state.current && status.mode !== 'fallback')} onClick={() => download(false)}>
            {status.mode === 'fallback' ? '导出原始 JSON' : '导出外观 JSON'}
          </button>
          <button type="button" className={BUTTON} disabled={busy} onClick={() => download(true)}>导出原始备份</button>
        </div>
      </div>

      <div className="px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="appearance-json" className="text-[13px] font-medium text-foreground">外观包 JSON</label>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".json,application/json" aria-label="导入外观 JSON 文件"
              className="hidden" disabled={busy} onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                void importFile(file)
              }} />
            <button type="button" className={BUTTON} disabled={busy} onClick={() => fileRef.current?.click()}>导入 JSON 文件</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => {
              setDraft(JSON.stringify(EXAMPLE_APPEARANCE, null, 2))
              setErrors([])
              setFeedback('示例已载入，可修改后预览。')
            }}>载入示例</button>
          </div>
        </div>
        <textarea id="appearance-json" value={draft} disabled={busy} spellCheck={false}
          aria-describedby="appearance-json-help" aria-invalid={errors.length > 0}
          className="mt-2 min-h-48 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-[12px] leading-5 text-foreground outline-none focus:ring-2 focus:ring-ring"
          placeholder="粘贴 agent 生成的外观 JSON，或载入示例。"
          onChange={(event) => {
            setDraft(event.target.value)
            setErrors([])
            setFeedback('')
          }} />
        <p id="appearance-json-help" className="mt-1 text-[11px] leading-5 text-muted-foreground">
          仅支持外观包格式（接口版本 {APPEARANCE_CONTRACT.appearanceApi}，最大 {APPEARANCE_CONTRACT.maxBytes / 1024} KB）。
          更新时自动检查兼容性；不兼容则恢复默认并保留原配置。备份用于保留原始配置，导入时请使用外观包 JSON。
        </p>
        {errors.length > 0 && (
          <ul role="alert" className="mt-2 list-inside list-disc text-[12px] leading-5 text-rose-600">
            {errors.map((error, index) => <li key={index}>{error}</li>)}
          </ul>
        )}
        {feedback && <p role="status" className="mt-2 text-[12px] leading-5 text-muted-foreground">{feedback}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={busy || !draft.trim()} onClick={check}>校验</button>
          <button ref={previewButtonRef} type="button" className={BUTTON} disabled={busy || !draft.trim()} onClick={preview}>预览 30 秒</button>
          <button type="button" disabled={busy || !draft.trim()} onClick={apply}
            className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? '处理中…' : '应用外观'}
          </button>
        </div>
      </div>
    </div>
  )
}
