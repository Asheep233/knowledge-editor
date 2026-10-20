/**
 * task-74：微分斜体 `d` → 正体 `\mathrm{d}` 的**差异预览 + 勾选**对话框。
 *
 * 红线（主理人 2026-10-13 拍板）：
 *  - **绝不覆盖原件**：只调用 `createArticle` 新建 `<原名>-正体d.md`（重名顺延 ` (2)`）；
 *  - **不碰原文章**：不调用原文档的保存/flush，不 `getMarkdown()` 改写原文档；
 *    `markdown` / `doc` 由调用方以**只读入参**传入，本组件只读不写；
 *  - **正文与代码块不碰**：只遍历 `analyzeUprightD` 认出的 `math`/`mathBlock` 节点；
 *  - 定位失败（正文与文档不一致）时**不猜**：报错并中止，不写任何文件。
 *
 * 出口：`onSaved({ fileName, path, changed })` —— 新文件名与（后端返回的）路径；
 * 是否打开新文件由调用方决定（本组件不打开）。
 */
import { useCallback, useMemo, useState } from 'react'
import { createArticle as defaultCreateArticle } from '../../api/client'
import { Icon } from '../icons'
import {
  analyzeUprightD,
  applyUprightDToMarkdown,
  uprightDFileName,
  uprightDPlan,
  type MathDocNode,
} from '../../editor/upright-d'

export interface UprightDDialogProps {
  open: boolean
  /** 当前文章正文 Markdown（只读；与保存路径同源） */
  markdown: string
  /** 当前文档 JSON（只读；用于只认数学节点） */
  doc: MathDocNode
  /** 原文件名（含 `.md`） */
  fileName: string
  /** 同目录已有文件名（用于重名序号；缺省靠后端 409 顺延） */
  existingNames?: string[]
  /** 注入点（测试用）；缺省走 `api/client.createArticle` */
  createArticle?: (title: string, content: string) => Promise<{ path?: string; id?: string } | undefined>
  onClose: () => void
  onSaved?: (info: { fileName: string; path?: string; changed: number }) => void
}

const isConflict = (e: unknown): boolean => /(^|\D)409(\D|$)/.test(String((e as Error)?.message ?? e))

export default function UprightDDialog({
  open,
  markdown,
  doc,
  fileName,
  existingNames = [],
  createArticle = defaultCreateArticle,
  onClose,
  onSaved,
}: UprightDDialogProps) {
  const analysis = useMemo(() => (open ? analyzeUprightD(doc) : { hits: [], skips: [], mathNodes: 0, nodesWithHits: 0 }), [open, doc])
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 另存成功后的提示（提示后**不自动打开**新文件、不改动当前文档） */
  const [done, setDone] = useState('')

  const selected = useMemo(
    () => analysis.hits.filter((h) => !unchecked.has(h.id)).map((h) => h.id),
    [analysis.hits, unchecked],
  )

  const toggle = useCallback((id: string) => {
    setUnchecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (check: boolean) => setUnchecked(check ? new Set() : new Set(analysis.hits.map((h) => h.id))),
    [analysis.hits],
  )

  const save = useCallback(async () => {
    if (busy) return
    setError('')
    if (selected.length === 0) {
      setError('没有勾选任何改动（取消全部勾选后无需另存）。')
      return
    }
    const plan = uprightDPlan(doc, selected)
    const { markdown: nextMarkdown, unmatched } = applyUprightDToMarkdown(markdown, plan)
    if (unmatched.length > 0) {
      // 正文与文档不一致 → 绝不猜、绝不写盘
      setError(`有 ${unmatched.length} 处在当前正文里定位失败，已中止（未写任何文件）。请先保存或重新打开该文章。`)
      return
    }
    setBusy(true)
    const taken = [...existingNames]
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const target = uprightDFileName(fileName, taken)
        try {
          const meta = await createArticle(target.replace(/\.md$/i, ''), nextMarkdown)
          const path = meta?.path ?? meta?.id
          setDone(`已另存：${path ?? target}（原件未改动）`)
          onSaved?.({
            fileName: target,
            path,
            changed: plan.reduce((sum, p) => sum + p.changed, 0),
          })
          return
        } catch (e) {
          if (isConflict(e)) {
            taken.push(target) // 重名：顺延序号再试
            continue
          }
          setError(`另存失败：${(e as Error)?.message ?? String(e)}`)
          return
        }
      }
      setError('重名尝试次数过多，已中止（未写任何文件）。')
    } finally {
      setBusy(false)
    }
  }, [busy, selected, doc, markdown, fileName, existingNames, createArticle, onSaved])

  if (!open) return null

  // ── Focus 视觉（task-2）：遮罩 --scrim / 卡片 --card + 24 圆角 + 柔和阴影 /
  //    差异行用 success·danger soft 语义色；功能与 data-* 契约保持不变。
  const overlay = 'fixed inset-0 z-50 flex items-center justify-center p-4'
  const overlayStyle = { background: 'var(--scrim)' }
  const closeBtn =
    'grid size-8 shrink-0 place-items-center rounded-control text-text-3 transition-colors hover:bg-[var(--surface-2)] hover:text-foreground'
  const btnBase =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-control px-3.5 text-[13px] font-medium transition-colors'
  const btnSecondary = `${btnBase} border border-border bg-card text-foreground hover:bg-[var(--surface-2)]`
  const btnPrimary = `${btnBase} bg-primary text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-45`

  const changedCount = selected.length
  return (
    <div className={overlay} style={overlayStyle} role="dialog" aria-modal="true" aria-label="微分 d 转正体预览">
      <div
        className="flex max-h-[84vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-dialog border border-border bg-card shadow-xl"
        data-ke-upright-panel
      >
        <header className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control bg-primary-soft text-accent-foreground">
            <Icon name="sigma" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold leading-snug tracking-[-0.02em] text-foreground">微分 d 转正体</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-2">
              将斜体微分 d 替换为正体 <span className="font-mono text-text-3">{'\\mathrm{d}'}</span>，另存为新文件，原件不改动。
            </p>
          </div>
          <button type="button" aria-label="关闭" className={closeBtn} onClick={onClose}>
            <Icon name="close" className="size-4" />
          </button>
        </header>

        <div className="flex items-center gap-3 border-b border-border bg-card px-6 py-2.5 text-[13px]">
          <span data-ke-upright-summary className="text-foreground">
            将修改 <b className="font-semibold text-accent-foreground">{changedCount}</b> 处 / 跳过{' '}
            <b className="font-semibold text-text-2">{analysis.skips.length}</b> 处
          </span>
          <span className="text-[12px] text-text-3">（共 {analysis.mathNodes} 个公式节点）</span>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="rounded-control px-2 py-0.5 text-[12.5px] font-medium text-accent-foreground transition-colors hover:bg-[var(--surface-2)]"
              onClick={() => toggleAll(true)}
            >
              全选
            </button>
            <button
              type="button"
              className="rounded-control px-2 py-0.5 text-[12.5px] text-text-2 transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
              onClick={() => toggleAll(false)}
            >
              全不选
            </button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {analysis.hits.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-text-3">没有发现「微分场景」的斜体 d（d 后紧跟字母或命令）。</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {analysis.hits.map((h) => {
                const checked = !unchecked.has(h.id)
                return (
                  <li
                    key={h.id}
                    className={[
                      'flex items-start gap-3 rounded-menu border px-3 py-2.5 transition-colors',
                      checked
                        ? 'border-border bg-[var(--surface-2)]'
                        : 'border-transparent bg-transparent opacity-70',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--primary)]"
                      checked={checked}
                      onChange={() => toggle(h.id)}
                      aria-label={`第 ${h.id} 处`}
                      data-ke-upright-hit={h.id}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12px] text-text-3">
                        <span className="rounded-full border border-border bg-card px-2 py-px text-[11.5px]">
                          {h.nodeType === 'mathBlock' ? '块级公式' : '行内公式'}
                        </span>
                        <span className="truncate">{h.reason}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
                        <span
                          className="max-w-full truncate rounded-[6px] bg-[var(--danger-soft)] px-1.5 py-0.5 text-danger"
                          data-ke-upright-before={h.id}
                        >
                          {h.before}
                        </span>
                        <span className="text-text-3">→</span>
                        <span
                          className="max-w-full truncate rounded-[6px] bg-[var(--success-soft)] px-1.5 py-0.5 text-success"
                          data-ke-upright-after={h.id}
                        >
                          {h.after}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {analysis.skips.length > 0 && (
            <details className="mt-3 rounded-menu border border-border bg-card px-3 py-2">
              <summary className="cursor-pointer text-[12px] text-text-2">
                跳过的 {analysis.skips.length} 处（变量 / 孤立 d，保持斜体）
              </summary>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {analysis.skips.map((s) => (
                  <li
                    key={s.id}
                    className="truncate font-mono text-[12px] text-text-3"
                    data-ke-upright-skip={s.id}
                  >
                    {s.before}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {done && (
          <p
            className="border-t border-border bg-[var(--success-soft)] px-6 py-2 text-[12.5px] text-success"
            data-ke-upright-done
          >
            {done}
          </p>
        )}

        {error && (
          <p
            className="border-t border-border bg-[var(--danger-soft)] px-6 py-2 text-[12.5px] text-danger"
            data-ke-upright-error
          >
            {error}
          </p>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-3.5 text-[13px]">
          <span className="min-w-0 truncate text-text-3">
            另存为 <span className="font-mono" data-ke-upright-target>{uprightDFileName(fileName, existingNames)}</span>
            （原件不改动）
          </span>
          <span className="flex shrink-0 gap-2">
            <button type="button" className={btnSecondary} onClick={onClose}>
              取消
            </button>
            {done ? (
              <button type="button" className={btnPrimary} onClick={onClose} data-ke-upright-close>
                关闭
              </button>
            ) : (
              <button
                type="button"
                className={btnPrimary}
                onClick={save}
                disabled={busy || selected.length === 0}
                data-ke-upright-save
              >
                {busy ? '正在另存…' : '另存为新文件'}
              </button>
            )}
          </span>
        </footer>
      </div>
    </div>
  )
}
