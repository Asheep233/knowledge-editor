/**
 * 公式节点视图（v1.1.7 M2 修订）。
 * - 渲染态：KaTeX 渲染 LaTeX
 * - 编辑：向 EditorArea（编辑器根）发 MathEditRequest——全屏模态由编辑器根持有，
 *   保存事务从根组件发起（nodeview 为独立 React 根，直接触发 PM 更新会 #300 崩溃）
 * 同时服务行内 math 与块级 mathBlock 两个节点。
 */
import { useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Icon } from '../../icons'
// task-49：互转请求（常量定义在 convert.ts —— 避免给本模块新增导出，多个 verify 套件会 mock 本模块）
import { MATH_CONVERT_EVENT, type ConvertRequest } from '../../../editor/math/convert'

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

function requestConvert(req: ConvertRequest): void {
  window.dispatchEvent(new CustomEvent(MATH_CONVERT_EVENT, { detail: req }))
}

export default function MathNodeView({ node, getPos, deleteNode }: NodeViewProps) {
  const isBlock = node.type.name === 'mathBlock'
  const latex = (node.attrs.latex as string) ?? ''
  // task-49：⋮ 更多菜单开合（本组件只发请求，不碰 PM 事务）
  const [moreOpen, setMoreOpen] = useState(false)

  // v1.1.7：不再「空内容自动弹窗」——Ctrl+Z 撤销回空内容会误弹。
  // 新建插入由 editor/index.ts 的 openMathEditorById 显式派发编辑请求。

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
      {/* task-49：⋮ 更多（竖排）→ 行内 ⇄ 行间互转；只发请求，事务由 EditorArea 执行 */}
      <span
        className="ke-math-more-btn"
        contentEditable={false}
        role="button"
        tabIndex={0}
        title="更多（转换公式类型）"
        data-testid="math-more-btn"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        onClick={(e) => {
          e.preventDefault()
          setMoreOpen((v) => !v)
        }}
      >
        <Icon name="more-horizontal" className="size-3 rotate-90" />
      </span>
      {moreOpen ? (
        <>
          {/* 点击外部关闭 */}
          <span className="fixed inset-0 z-40" contentEditable={false} onClick={() => setMoreOpen(false)} />
          <span
            role="menu"
            data-testid="math-more-menu"
            contentEditable={false}
            className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-md border border-border bg-card py-1 shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="math-convert-block"
              disabled={isBlock}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-foreground/80 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              onClick={(e) => {
                e.preventDefault()
                setMoreOpen(false)
                if (!isBlock) {
                  requestConvert({
                    pos: getPos?.() ?? 0,
                    id: (node.attrs.id as string) ?? '',
                    isBlock,
                    to: 'block',
                  })
                }
              }}
            >
              转为行间公式
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="math-convert-inline"
              disabled={!isBlock}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-foreground/80 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              onClick={(e) => {
                e.preventDefault()
                setMoreOpen(false)
                if (isBlock) {
                  requestConvert({
                    pos: getPos?.() ?? 0,
                    id: (node.attrs.id as string) ?? '',
                    isBlock,
                    to: 'inline',
                  })
                }
              }}
            >
              转为行内公式
            </button>
          </span>
        </>
      ) : null}
    </NodeViewWrapper>
  )
}
