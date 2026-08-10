/**
 * 脚注上标节点视图（v0.6.4）。
 * 上标 [n] 默认只读展示；点击进入编辑态，可自主修改编号数字。
 * 修改只更新上标自身的 attrs.n（正文显示），不影响底部参考栏（footnotes
 * 节点的 items 列表）——底部条目保持原样。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'

/**
 * 解析上标编号：仅接受正整数；空串/非数字/非正整数返回 null。
 * 独立导出便于单元测试。
 */
export function parseFootnoteN(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

export default function FootnoteNodeView({ node, editor, getPos }: NodeViewProps) {
  const n = (node.attrs.n as number) || 0
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(n))
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 进入编辑态时聚焦输入框
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const parsed = parseFootnoteN(draft)
    if (parsed !== null && parsed !== n) {
      const pos = typeof getPos === 'function' ? getPos() : -1
      if (pos !== undefined && pos >= 0) {
        // 直接按节点位置更新 attrs，不依赖当前 selection
        // （用户点击上标时 selection 并不一定覆盖该节点）
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { n: parsed }))
      }
    }
    setDraft(String(parsed ?? n))
    setEditing(false)
  }

  return (
    <NodeViewWrapper
      as="sup"
      contentEditable={false}
      className="ke-footnote-ref"
      title="注释引用 [n]，点击可修改编号"
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              setDraft(String(n))
              setEditing(false)
            }
          }}
          className="ke-footnote-edit"
        />
      ) : (
        <span
          className="ke-footnote-num"
          onClick={(e) => {
            e.preventDefault()
            setDraft(String(n))
            setEditing(true)
          }}
        >
          [{n}]
        </span>
      )}
    </NodeViewWrapper>
  )
}
