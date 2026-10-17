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

  const changedCount = selected.length
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-label="微分 d 转正体预览">
      <div
        className="flex max-h-[80vh] w-[min(760px,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        data-ke-upright-panel
      >
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-[15px] font-medium">
            <Icon name="sigma" className="h-4 w-4" />
            微分 d 转正体（\mathrm{'{'}d{'}'}）
          </div>
          <button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-accent" onClick={onClose} aria-label="关闭">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2 text-[13px]">
          <span data-ke-upright-summary>
            将修改 <b>{changedCount}</b> 处 / 跳过 <b>{analysis.skips.length}</b> 处
          </span>
          <span className="text-muted-foreground">（共 {analysis.mathNodes} 个公式节点）</span>
          <span className="ml-auto flex gap-2">
            <button type="button" className="rounded px-2 py-0.5 text-accent hover:bg-accent" onClick={() => toggleAll(true)}>
              全选
            </button>
            <button type="button" className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent" onClick={() => toggleAll(false)}>
              全不选
            </button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
          {analysis.hits.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">没有发现「微分场景」的斜体 d（d 后紧跟字母或命令）。</p>
          ) : (
            <ul className="space-y-1">
              {analysis.hits.map((h) => {
                const checked = !unchecked.has(h.id)
                return (
                  <li key={h.id} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-accent">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggle(h.id)}
                      aria-label={`第 ${h.id} 处`}
                      data-ke-upright-hit={h.id}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12px] text-muted-foreground">
                        {h.nodeType === 'mathBlock' ? '块级公式' : '行内公式'} · {h.reason}
                      </div>
                      <div className="truncate font-mono text-[12px]" data-ke-upright-before={h.id}>
                        {h.before}
                      </div>
                      <div className="truncate font-mono text-[12px] text-emerald-700" data-ke-upright-after={h.id}>
                        {h.after}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {analysis.skips.length > 0 && (
            <details className="mt-2 rounded border border-border px-2 py-1">
              <summary className="cursor-pointer text-[12px] text-muted-foreground">跳过的 {analysis.skips.length} 处（变量 / 孤立 d，保持斜体）</summary>
              <ul className="mt-1 space-y-0.5">
                {analysis.skips.map((s) => (
                  <li key={s.id} className="truncate font-mono text-[12px] text-muted-foreground" data-ke-upright-skip={s.id}>
                    {s.before}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {done && (
          <p className="border-t border-border px-4 py-2 text-[12px] text-emerald-700" data-ke-upright-done>
            {done}
          </p>
        )}

        {error && (
          <p className="border-t border-border px-4 py-2 text-[12px] text-red-600" data-ke-upright-error>
            {error}
          </p>
        )}

        <footer className="flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-3 text-[13px]">
          <span className="truncate text-muted-foreground">
            另存为 <span className="font-mono" data-ke-upright-target>{uprightDFileName(fileName, existingNames)}</span>
            （原件不改动）
          </span>
          <span className="flex gap-2">
            <button type="button" className="rounded border border-border px-3 py-1 hover:bg-accent" onClick={onClose}>
              取消
            </button>
            {done ? (
              <button
                type="button"
                className="rounded px-3 py-1 font-medium text-primary-foreground"
                style={{ backgroundColor: 'var(--primary)' }}
                onClick={onClose}
                data-ke-upright-close
              >
                关闭
              </button>
            ) : (
              <button
                type="button"
                className="rounded px-3 py-1 font-medium text-primary-foreground disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)' }}
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
