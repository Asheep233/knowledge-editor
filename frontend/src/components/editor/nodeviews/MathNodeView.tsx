/**
 * 公式节点视图（UX 优化 2）。
 * - 非编辑态：KaTeX 渲染 LaTeX（保留原本公式与渲染效果）
 * - 编辑态（默认「源码模式」）：上方 LaTeX 源码输入框 + 下方 KaTeX 实时渲染
 * - 编辑态可一键切换「可视化模式」：MathLive <math-field> 所见即所得
 * - 存储格式始终为 LaTeX（Document Model attr）
 * 同时服务行内 math 与块级 mathBlock 两个节点。
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState, type CSSProperties, type FocusEventHandler, type FormEventHandler, type KeyboardEventHandler, type Ref } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import 'mathlive'
import 'mathlive/fonts.css'
import type { MathfieldElement } from 'mathlive'
import { Icon } from '../../icons'

/** <math-field> 自定义元素（MathLive）的 JSX 类型声明（React 19 模块内 namespace） */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': {
        defaultValue?: string
        class?: string
        style?: CSSProperties
        ref?: Ref<MathfieldElement>
        onInput?: FormEventHandler<MathfieldElement>
        onKeyDown?: KeyboardEventHandler<MathfieldElement>
        onBlur?: FocusEventHandler<MathfieldElement>
      }
    }
  }
}

type EditMode = 'latex' | 'mathlive'

export default function MathNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const isBlock = node.type.name === 'mathBlock'
  const latex = (node.attrs.latex as string) ?? ''
  // 空公式默认进入编辑态（源码模式）
  const [editing, setEditing] = useState(!latex.trim())
  const [mode, setMode] = useState<EditMode>('latex')
  const fieldRef = useRef<MathfieldElement | null>(null)

  // 编辑态：拦截 NodeView 内部「非交互区」（预览、编辑器背景等）的 mousedown/click。
  // 原因：点击公式节点内部会触发 ProseMirror 的 selectClickedNode → NodeSelection + view.focus()，
  // 焦点从输入框被抢走后选区被重置（表现为输入框内文字全选）。
  // wrapper 位于编辑器 DOM 内部，事件先到 wrapper 再冒泡到 ProseMirror，因此在此处拦截有效；
  // 交互控件（textarea / math-field / 按钮 / input / select）放行，不影响正常输入与点击。
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!editing) return
    const el = wrapperRef.current
    if (!el) return
    const guard = (e: MouseEvent) => {
      // composedPath 可跨 shadow DOM（math-field 内部），缺失时回退到 e.target
      const path = (e.composedPath?.() ?? [e.target]).map((n) => n as HTMLElement)
      const interactive = path.some((n) => /^(TEXTAREA|INPUT|SELECT|BUTTON|MATH-FIELD)$/i.test(n.tagName ?? ''))
      if (interactive) return
      e.preventDefault()
      e.stopPropagation()
    }
    el.addEventListener('mousedown', guard)
    el.addEventListener('click', guard)
    return () => {
      el.removeEventListener('mousedown', guard)
      el.removeEventListener('click', guard)
    }
  }, [editing])

  // 进入编辑态：把当前 LaTeX 载入 math-field（若切到可视化模式）
  useEffect(() => {
    if (editing && mode === 'mathlive' && fieldRef.current) {
      fieldRef.current.value = latex
      try {
        fieldRef.current.focus()
      } catch {
        /* math-field 可能尚未 ready，忽略 */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mode])

  // 源码模式：聚焦 LaTeX 输入框，光标置于末尾（避免浏览器/选区把全文选中）
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (editing && mode === 'latex' && textareaRef.current) {
      const el = textareaRef.current
      el.focus()
      try {
        el.setSelectionRange(el.value.length, el.value.length)
      } catch {
        /* ignore */
      }
    }
  }, [editing, mode])

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

  if (editing) {
    return (
      <NodeViewWrapper
        ref={wrapperRef}
        contentEditable={false}
        className={isBlock ? 'ke-math ke-math--block' : 'ke-math ke-math--inline'}
      >
        {mode === 'latex' ? (
          /* 源码模式：上方 LaTeX 输入 + 下方实时渲染 */
          <div className="ke-math-editor">
            <textarea
              ref={textareaRef}
              className="ke-math-latex-input"
              value={latex}
              spellCheck={false}
              placeholder="输入 LaTeX 公式，例如 E=mc^2"
              rows={isBlock ? 3 : 1}
              onChange={(e) => {
                updateAttributes({ latex: e.target.value })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                }
              }}
            />
            <div className="ke-math-preview">
              <span className="ke-math-preview-label">渲染预览</span>
              <span
                className="ke-math-preview-body"
                dangerouslySetInnerHTML={{ __html: renderFailed ? (latex || '（无效公式）') : html }}
              />
            </div>
          </div>
        ) : (
          /* 可视化模式：MathLive 所见即所得 */
          <div className="ke-math-editor">
            <math-field
              ref={(el) => {
                fieldRef.current = el
              }}
              defaultValue={latex}
              class="ke-math-field"
              style={{ width: '100%' }}
              onInput={(e) => {
                const v = (e.target as MathfieldElement).value
                updateAttributes({ latex: v })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                }
              }}
              onBlur={() => setEditing(false)}
            />
          </div>
        )}
        <div className="ke-math-hint">
          {mode === 'latex' ? (
            <button
              type="button"
              className="ke-math-tool"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMode('mathlive')}
            >
              可视化编辑
            </button>
          ) : (
            <button
              type="button"
              className="ke-math-tool"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMode('latex')}
            >
              LaTeX 源码
            </button>
          )}
          <button
            type="button"
            className="ke-math-exit"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(false)}
          >
            完成
          </button>
          <button
            type="button"
            className="ke-math-del-inline"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => deleteNode()}
          >
            删除
          </button>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      contentEditable={false}
      className={isBlock ? 'ke-math ke-math--block' : 'ke-math ke-math--inline'}
    >
      <span
        className="ke-math-render"
        title="双击编辑公式"
        dangerouslySetInnerHTML={{ __html: renderFailed ? latex : html }}
        onDoubleClick={(e) => {
          e.preventDefault()
          setEditing(true)
        }}
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
  )
}
