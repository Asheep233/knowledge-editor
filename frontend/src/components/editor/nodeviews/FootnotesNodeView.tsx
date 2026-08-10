/**
 * 脚注列表节点视图（Phase 3：Footnote 系统优化）。
 * 参考栏不再是「## 参考」标题检测，而是 Document Model 中的独立块级节点
 * （footnotes），Markdown 使用唯一标记区域：
 *
 * <!-- ke-footnotes:start -->
 * <!-- ke-footnote-item: {"id":"..","n":1,"text":".."} -->
 * <!-- ke-footnotes:end -->
 *
 * 特性：
 * - 正文中出现「## 参考」标题不影响脚注
 * - 多次打开不会重复生成（区域是唯一表示）
 * - 脚注内容就地编辑（contentEditable），支持删除条目
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useRef } from 'react'
import type { FootnoteItem } from '../../../editor/extensions/FootnotesExtension'

export default function FootnotesNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const items = (node.attrs.items as FootnoteItem[]) ?? []
  const refs = useRef<Array<HTMLDivElement | null>>([])

  const commit = (idx: number) => {
    const el = refs.current[idx]
    if (!el) return
    const v = el.innerText ?? ''
    if (v === items[idx]?.text) return
    const next = items.map((it, i) => (i === idx ? { ...it, text: v } : it))
    updateAttributes({ items: next })
  }

  const remove = (idx: number) => {
    updateAttributes({ items: items.filter((_, i) => i !== idx) })
  }

  return (
    <NodeViewWrapper
      contentEditable={false}
      className="ke-footnotes my-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
      data-ke-footnotes="true"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
          脚注
        </span>
        <span className="text-[11px] text-gray-400">点击条目可编辑内容</span>
      </div>
      {items.length === 0 ? (
        <div className="py-1 text-[12px] text-gray-400">暂无脚注条目</div>
      ) : (
        <ol className="space-y-1">
          {items.map((it, idx) => (
            <li key={it.id} className="group flex items-start gap-2 text-[13px] leading-relaxed text-gray-700">
              <span className="mt-0.5 shrink-0 select-none font-mono text-[11px] text-gray-400">[{it.n}]</span>
              <div
                ref={(el) => {
                  refs.current[idx] = el
                }}
                contentEditable
                suppressContentEditableWarning
                className="min-w-0 flex-1 whitespace-pre-wrap outline-none focus:ring-0"
                onBlur={() => commit(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    commit(idx)
                    ;(e.target as HTMLElement).blur()
                  }
                }}
              >
                {it.text}
              </div>
              <button
                type="button"
                title="删除该脚注"
                className="mt-0.5 shrink-0 text-xs text-gray-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault()
                  remove(idx)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          title="删除整个脚注区域"
          className="text-[11px] text-gray-400 hover:text-rose-500"
          onClick={(e) => {
            e.preventDefault()
            deleteNode()
          }}
        >
          删除区域
        </button>
      </div>
    </NodeViewWrapper>
  )
}
