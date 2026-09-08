/**
 * 公式节点视图（v1.1.7 M2 修订）。
 * - 渲染态：KaTeX 渲染 LaTeX
 * - 编辑：向 EditorArea（编辑器根）发 MathEditRequest——全屏模态由编辑器根持有，
 *   保存事务从根组件发起（nodeview 为独立 React 根，直接触发 PM 更新会 #300 崩溃）
 * 同时服务行内 math 与块级 mathBlock 两个节点。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Icon } from '../../icons'

export interface MathEditRequest {
  /** 公式节点在文档中的位置（兜底定位；主定位 = id） */
  pos: number
  nodeSize: number
  /** 节点 id（插入时生成；保存遍历 doc 按 id 定位——mount 期 getPos 可能过期） */
  id: string
  latex: string
  isBlock: boolean
}
export const MATH_EDIT_EVENT = 'ke:math-edit-request'

function requestEdit(req: MathEditRequest): void {
  window.dispatchEvent(new CustomEvent(MATH_EDIT_EVENT, { detail: req }))
}

export default function MathNodeView({ node, getPos, deleteNode }: NodeViewProps) {
  const isBlock = node.type.name === 'mathBlock'
  const latex = (node.attrs.latex as string) ?? ''

  useEffect(() => {
    // 空公式（新建/粘贴空）自动请求编辑
    if (!latex.trim() && getPos()) {
      requestEdit({ pos: getPos() || 0, nodeSize: node.nodeSize, id: (node.attrs.id as string) ?? '', latex, isBlock })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const openEdit = () => {
    const pos = getPos?.() ?? 0
    requestEdit({ pos, nodeSize: node.nodeSize, id: (node.attrs.id as string) ?? '', latex, isBlock })
  }

  return (
    <NodeViewWrapper contentEditable={false} className={isBlock ? 'ke-math ke-math--block' : 'ke-math ke-math--inline'}>
      <span
        className="ke-math-render"
        title="双击编辑公式"
        onDoubleClick={(e) => {
          e.preventDefault()
          openEdit()
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
          openEdit()
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
  )
}
