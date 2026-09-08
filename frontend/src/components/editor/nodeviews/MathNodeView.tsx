/**
 * 公式节点视图（v1.1.7 M2 重构）。
 * - 渲染态：KaTeX 渲染 LaTeX（行内/块级共用，块级多居中样式）
 * - 编辑态：统一走**全屏公式模态**（MathEditorModal）——知乎式外圈透明 + 模板面板
 *   + Tab 补全/槽位；Esc=保存（空=删除）/完成
 * - 存储格式始终为 LaTeX（Document Model attr）
 * 同时服务行内 math 与块级 mathBlock 两个节点。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Icon } from '../../icons'
import MathEditorModal from '../MathEditorModal'

export default function MathNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const isBlock = node.type.name === 'mathBlock'
  const latex = (node.attrs.latex as string) ?? ''
  // 空公式默认进入编辑模态（插入即编；保存为空 → 删除节点，不留空公式）
  const [editing, setEditing] = useState(!latex.trim())

  useEffect(() => {
    if (!latex.trim()) setEditing(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // LaTeX -> HTML（KaTeX）
  let html = ''
  let renderFailed = false
  try {
    html = katex.renderToString(latex || '\\;', {
      displayMode: isBlock,
      throwOnError: false,
      output: 'html',
    })
  } catch {
    renderFailed = true
  }

  return (
    <>
      <NodeViewWrapper contentEditable={false} className={isBlock ? 'ke-math ke-math--block' : 'ke-math ke-math--inline'}>
        <span
          className="ke-math-render"
          title="双击编辑公式"
          onDoubleClick={(e) => {
            e.preventDefault()
            setEditing(true)
          }}
          dangerouslySetInnerHTML={{ __html: renderFailed ? latex : html }}
        />
        {/* 选中时的快捷编辑按钮（悬浮） */}
        <span
          className="ke-math-edit-btn"
          contentEditable={false}
          role="button"
          tabIndex={0}
          title="编辑公式"
          onClick={(e) => {
            e.preventDefault()
            setEditing(true)
          }}
        >
          <Icon name="edit" className="size-3" />
        </span>
        <span
          className="ke-math-del-btn"
          contentEditable={false}
          role="button"
          tabIndex={0}
          title="删除公式"
          onClick={(e) => {
            e.preventDefault()
            deleteNode()
          }}
        >
          <Icon name="close" className="size-3" />
        </span>
      </NodeViewWrapper>
      <MathEditorModal
        open={editing}
        initialValue={latex}
        isBlock={isBlock}
        onSave={(v) => {
          updateAttributes({ latex: v })
          setEditing(false)
        }}
        onDeleteEmpty={() => deleteNode()}
        onClose={() => setEditing(false)}
      />
    </>
  )
}
