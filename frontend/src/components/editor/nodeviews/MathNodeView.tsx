/**
 * 公式节点视图（v1.1.7 M2 修订）。
 * - 渲染态：KaTeX 渲染 LaTeX
 * - 编辑：向 EditorArea（编辑器根）发 MathEditRequest——全屏模态由编辑器根持有，
 *   保存事务从根组件发起（nodeview 为独立 React 根，直接触发 PM 更新会 #300 崩溃）
 * 同时服务行内 math 与块级 mathBlock 两个节点。
 *
 * task-52（用户实测两条 UI bug）：
 * A 行末公式 hover 漂移 —— ✏️/🗑/⋮ 收进绝对定位容器 `.ke-math-tools`（见 index.css）；
 * B `2.` 右侧「看不见的块」 —— ⋮ 菜单的「点击外部关闭」遮罩改为 pointer-events:none，
 *   点击穿透到正文，关闭动作由下面的 document 捕获监听处理。
 */
import { useEffect, useRef, useState } from 'react'
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

  // task-52 Bug B：遮罩不再吃点击，改为「捕获阶段点文档任意处」关闭菜单。
  // 只认「菜单打开后」的指针事件，且不吞事件（不 stopPropagation / 不 preventDefault）：
  // 用户点正文时光标照常落下，菜单同时关闭。
  // 注意：mousedown 在**捕获阶段**触发，早于按钮 click —— 必须排除「菜单自身/按钮」上的
  // 按下（否则点「转为行间公式」会先把菜单关掉，onClick 永远不执行）。
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!moreOpen) return
    const close = (e: Event): void => {
      const t = e.target
      if (t instanceof Node && wrapRef.current?.contains(t)) return
      setMoreOpen(false)
    }
    document.addEventListener('mousedown', close, true)
    document.addEventListener('touchstart', close, true)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('touchstart', close, true)
    }
  }, [moreOpen])

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
    <NodeViewWrapper
      ref={wrapRef}
      contentEditable={false}
      className={isBlock ? 'ke-math ke-math--block' : 'ke-math ke-math--inline'}
    >
      <span
        className="ke-math-render"
        title="双击编辑公式"
        onDoubleClick={(e) => {
          e.preventDefault()
          openEdit()
        }}
        dangerouslySetInnerHTML={{ __html: renderFailed ? latex : html }}
      />
      {/* 选中/悬浮时的快捷按钮 —— task-52：三个按钮必须统一收进
          **绝对定位**容器 .ke-math-tools（见 index.css）。
          它们此前直接平铺在公式里，是行内元素：hover 显示时给节点加了约 72px
          宽度 → 行末公式放不下 → 回流换到下一行（用户实测「hover 即漂移」）。
          容器脱离文档流后，hover / 选中 / 菜单展开**只切容器可见性**，
          公式自身占位宽高恒定。 */}
      <span className="ke-math-tools" data-ke-math-tools="" contentEditable={false}>
        <span
          className="ke-math-edit-btn"
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
      </span>
      {moreOpen ? (
        <>
          {/* 点击外部关闭。
              task-52 Bug B：这块遮罩覆盖整个视口（1280×900，z-40），若参与命中测试就会
              把**整篇正文**变成“看不见的块”——用户实测「`2.` 右侧有看不见的块，光标放不进去」
              正是它（Chromium 实测：菜单打开时 elementFromPoint(正文) 命中
              `span.fixed.inset-0.z-40`）。故遮罩改为 `pointer-events:none`：
              点击穿透到正文，关闭动作由下面的 document 捕获监听统一处理。 */}
          <span className="ke-math-more-overlay" contentEditable={false} />
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
