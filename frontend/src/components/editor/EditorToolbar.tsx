/**
 * 编辑器工具栏（UX 优化 3/4）：
 * - 每个按钮为「图标（上）+ 文字（下）」两行结构
 * - 「标题」为单个按钮，点击弹出下拉选择 正文 / 标题1~6
 * - 「列表」为单个按钮，点击弹出下拉选择 无序 / 有序 / 取消
 */
import { useCurrentEditor, useEditorState, type Editor } from '@tiptap/react'
import { type MarkdownExtensionStorage } from '@tiptap/markdown'
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getModule, listModules, uploadAttachment, type ModuleInfo } from '../../api/client'
import { newId } from '../../editor/ke'
import { attachmentNode } from '../../editor/upload'

interface Btn {
  icon: ReactNode
  label: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function ToolbarButton({ b }: { b: Btn }) {
  return (
    <button
      type="button"
      title={b.title}
      disabled={b.disabled}
      onClick={b.onClick}
      className={[
        'flex h-10 min-w-[52px] flex-col items-center justify-center gap-[3px] rounded-md px-1.5 transition-colors',
        b.active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800',
        b.disabled ? 'cursor-not-allowed opacity-40' : '',
      ].join(' ')}
    >
      <span className="text-[15px] leading-none">{b.icon}</span>
      <span
        className={[
          'max-w-full truncate text-[10px] leading-none',
          b.active ? 'font-medium' : 'text-gray-500',
        ].join(' ')}
      >
        {b.label}
      </span>
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-8 w-px shrink-0 bg-gray-200" />
}

/** 下拉菜单容器：
 * 面板通过 portal 渲染到 document.body（fixed 定位），
 * 避免被工具栏 overflow-x-auto 容器裁剪（UX 优化 4 修正）；
 * 点击外部 / 滚动 / 窗口大小变化时自动关闭。
 */
function Dropdown({
  open,
  onClose,
  trigger,
  children,
}: {
  open: boolean
  onClose: () => void
  trigger: ReactNode
  children: ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)

  // 打开时按触发按钮当前屏幕位置计算面板坐标
  useEffect(() => {
    if (!open) return
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width })
  }, [open])

  // 外部点击、滚动、窗口变化时关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [open, onClose])

  return (
    <div ref={wrapRef} className="relative">
      {trigger}
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-50 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
              style={{ top: pos.top, left: pos.left, minWidth: Math.max(pos.minWidth, 140) }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'block w-full px-3 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-100',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** 表格行列网格选择器：鼠标滑动选中 1~8 行 × 1~8 列，点击插入对应尺寸表格 */
function TableSizePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const MAX = 8
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  const rows = hover ? hover.r + 1 : 1
  const cols = hover ? hover.c + 1 : 1
  return (
    <div className="px-3 py-2" onMouseLeave={() => setHover(null)}>
      <div className="mb-1.5 text-[11px] text-gray-500">{rows} 行 × {cols} 列</div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${MAX}, 13px)` }}>
        {Array.from({ length: MAX }).map((_, r) =>
          Array.from({ length: MAX }).map((_, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onPick(r + 1, c + 1)}
              className={[
                'h-[13px] w-[13px] rounded-[2px] transition-colors',
                hover && r <= hover.r && c <= hover.c ? 'bg-blue-500' : 'bg-gray-200 hover:bg-gray-300',
              ].join(' ')}
            />
          )),
        )}
      </div>
    </div>
  )
}

/** 脚注插入样式（Phase 7）：block=灰底脚注区域（原样式）；plain=纯 Markdown 文本 */
type FootnoteStyle = 'block' | 'plain'

/** 脚注样式选择卡片 */
function StyleCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean
  onClick: () => void
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-1 rounded-lg border px-3 py-2 text-left transition-colors',
        active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300',
      ].join(' ')}
    >
      <div className={['text-[13px] font-medium', active ? 'text-blue-700' : 'text-gray-800'].join(' ')}>
        {title}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-gray-500">{desc}</div>
    </button>
  )
}

/** 注释内容输入弹窗（portal 到 body，避免被裁剪）；样式选择会被记住（localStorage） */
function FootnoteDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (text: string, style: FootnoteStyle) => void
}) {
  const [text, setText] = useState('')
  const [style, setStyle] = useState<FootnoteStyle>(() =>
    localStorage.getItem('ke.footnoteStyle') === 'plain' ? 'plain' : 'block',
  )
  useEffect(() => {
    if (open) {
      setText('')
      setStyle(localStorage.getItem('ke.footnoteStyle') === 'plain' ? 'plain' : 'block')
    }
  }, [open])
  if (!open) return null

  const confirm = () => {
    localStorage.setItem('ke.footnoteStyle', style)
    onConfirm(text, style)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={onClose}
    >
      <div
        className="w-[440px] rounded-xl bg-white p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-sm font-semibold text-gray-800">添加注释</div>
        <div className="mb-2 text-[11px] text-gray-500">选择插入样式（选择会被记住）</div>
        <div className="mb-2 flex gap-2">
          <StyleCard
            active={style === 'block'}
            onClick={() => setStyle('block')}
            title="脚注区域（原样式）"
            desc="正文插入上标 [n]，文末自动生成灰底「脚注」信息块，条目可就地编辑"
          />
          <StyleCard
            active={style === 'plain'}
            onClick={() => setStyle('plain')}
            title="纯 Markdown"
            desc="正文同样插入上标 [n]；文末 # 参考 与 [n]内容 为普通段落，无连接、可自由编辑"
          />
        </div>
        <div className="mb-2 text-[11px] text-gray-500">
          {style === 'plain'
            ? '正文插入上标 [n]；文末追加 # 参考 与 [n]内容（普通段落，可自由编辑，无上标连接）。'
            : '正文将插入右上角上标 [n]，并在文末脚注区域（独立 footnotes 节点）自动生成对应条目。'}
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入注释内容…"
          className="h-24 w-full resize-none rounded-md border border-gray-200 p-2 text-[13px] leading-relaxed text-gray-900 caret-blue-600 outline-none placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              confirm()
            }
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-[13px] text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700"
          >
            插入注释
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 插入公式节点（行内/块级），空公式由 NodeView 自动进入编辑态。
 * 注意：插入后不 setNodeSelection —— 选中节点会触发 ProseMirror 的
 * NodeSelection 视觉样式与选区干扰（公式编辑栏文本全选 bug 的诱因之一）。 */
function insertMathNode(editor: Editor, display: boolean) {
  const type = display ? 'mathBlock' : 'math'
  editor
    .chain()
    .focus()
    .insertContent({ type, attrs: { latex: '', id: newId() } })
    .run()
}

/** 模块显示名：Modules/Math/Definition.md -> Math/Definition */
function moduleLabel(path: string): string {
  return path.replace(/^Modules\//, '').replace(/\.md$/, '')
}

/** 剥离模块正文开头的标题（创建模块时自动生成的 `# 名称`）。
 * 仅剥离内容最前面的第一个一级标题及其后空行；
 * `## 定义` 等章节标题属于内容本身，不剥离。
 * 返回空串表示模块除标题外无内容。 */
export function stripModuleTitle(content: string): string {
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length || !/^#\s+/.test(lines[i].trim())) return content
  let j = i + 1
  while (j < lines.length && lines[j].trim() === '') j++
  return lines.slice(j).join('\n').trimStart()
}

export default function EditorToolbar() {
  const { editor } = useCurrentEditor()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [headingOpen, setHeadingOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [footnoteOpen, setFootnoteOpen] = useState(false)
  const [moduleOpen, setModuleOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [modules, setModules] = useState<ModuleInfo[]>([])

  const s =
    useEditorState({
      editor,
      selector: ({ editor: e }) => ({
        headingLevel: e?.isActive('heading') ? (e.getAttributes('heading').level as number) : 0,
        bold: e?.isActive('bold') ?? false,
        italic: e?.isActive('italic') ?? false,
        underline: e?.isActive('underline') ?? false,
        strike: e?.isActive('strike') ?? false,
        code: e?.isActive('code') ?? false,
        codeBlock: e?.isActive('codeBlock') ?? false,
        blockquote: e?.isActive('blockquote') ?? false,
        bulletList: e?.isActive('bulletList') ?? false,
        orderedList: e?.isActive('orderedList') ?? false,
        canUndo: e?.can().undo() ?? false,
        canRedo: e?.can().redo() ?? false,
      }),
    }) ?? {
      headingLevel: 0,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      codeBlock: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      canUndo: false,
      canRedo: false,
    }

  // 单行工具栏：悬停时纵向滚轮转为横向滚动（内容未溢出时不影响页面滚动）
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth > el.clientWidth && e.deltaY !== 0) {
        el.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  if (!editor) return null

  const applyHeading = (level: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {
    if (level === 0) editor.chain().focus().setParagraph().run()
    else editor.chain().focus().toggleHeading({ level }).run()
    setHeadingOpen(false)
  }

  const applyList = (kind: 'none' | 'bullet' | 'ordered') => {
    if (kind === 'bullet') editor.chain().focus().toggleBulletList().run()
    else if (kind === 'ordered') editor.chain().focus().toggleOrderedList().run()
    else {
      editor.chain().focus().clearNodes().run()
    }
    setListOpen(false)
  }

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const res = await uploadAttachment(file)
      // 视频统一使用 video 节点（spec 3.4 ke-video）；attach 仅承载 image/file
      // 节点构建与拖拽添加共用（src/editor/upload.ts），保证两种入口行为一致
      const node = attachmentNode(editor.schema, res, file.name)
      editor.chain().focus().insertContent(node).run()
    } catch (err) {
      window.alert(`附件上传失败：${String(err)}`)
    }
  }

  const headingLabel =
    s.headingLevel > 0 ? `标题${s.headingLevel}` : '正文'

  // Phase 5 插入模块：打开下拉时懒加载模块列表
  const toggleModulePicker = async () => {
    const next = !moduleOpen
    setModuleOpen(next)
    if (next && modules.length === 0) {
      try {
        setModules((await listModules()).modules)
      } catch {
        setModules([])
      }
    }
  }

  // 插入模块（约束 2 内容复制 + 来源记录）：
  // 1. 读取模块 Markdown 原文（已剥离 frontmatter）
  // 2. 剥离开头的 `# 标题`（创建模块时自动生成，不随内容插入）
  // 3. 前置 ke-module 来源标记（仅含 source）
  // 4. 整体解析进 Document Model 并插入当前光标位置
  // 保存后序列化为 ke-module 标记 + 模块内容；模块与文章无动态关系。
  const insertModule = async (m: ModuleInfo) => {
    setModuleOpen(false)
    try {
      const mod = await getModule(m.path)
      const body = stripModuleTitle(mod.content)
      const marker = `<!-- ke-module: ${JSON.stringify({ source: m.path })} -->`
      const md = `${marker}\n\n${body}`
      const manager = (editor.storage.markdown as MarkdownExtensionStorage).manager
      const content = manager.parse(md)
      editor.chain().focus().insertContent(content).run()
    } catch (e) {
      window.alert(`插入模块失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div
      ref={barRef}
      className="flex h-[52px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-gray-200 bg-white px-2"
    >
      {/* 标题下拉（优化 4） */}
      <Dropdown
        open={headingOpen}
        onClose={() => setHeadingOpen(false)}
        trigger={
          <button
            type="button"
            title="标题 / 正文"
            onClick={() => setHeadingOpen((v) => !v)}
            className={[
              'flex h-10 min-w-[52px] flex-col items-center justify-center gap-[3px] rounded-md px-1.5 transition-colors',
              s.headingLevel > 0 ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800',
            ].join(' ')}
          >
            <span className="text-[15px] leading-none">Aa</span>
            <span
              className={[
                'max-w-full truncate text-[10px] leading-none',
                s.headingLevel > 0 ? 'font-medium' : 'text-gray-500',
              ].join(' ')}
            >
              {headingLabel}
            </span>
          </button>
        }
      >
        <MenuItem active={s.headingLevel === 0} onClick={() => applyHeading(0)}>
          正文
        </MenuItem>
        {([1, 2, 3, 4, 5, 6] as const).map((lvl) => (
          <MenuItem key={lvl} active={s.headingLevel === lvl} onClick={() => applyHeading(lvl)}>
            标题{lvl}（{lvl === 1 ? '最大' : lvl === 6 ? '最小' : ''}）
          </MenuItem>
        ))}
      </Dropdown>

      <Divider />
      <ToolbarButton
        b={{
          icon: <strong>B</strong>,
          label: '粗体',
          title: '粗体',
          active: s.bold,
          onClick: () => editor.chain().focus().toggleBold().run(),
        }}
      />
      <ToolbarButton
        b={{
          icon: <em>I</em>,
          label: '斜体',
          title: '斜体',
          active: s.italic,
          onClick: () => editor.chain().focus().toggleItalic().run(),
        }}
      />
      <ToolbarButton
        b={{
          icon: <u>U</u>,
          label: '下划线',
          title: '下划线',
          active: s.underline,
          onClick: () => editor.chain().focus().toggleUnderline().run(),
        }}
      />
      <ToolbarButton
        b={{
          icon: <s>S</s>,
          label: '删除线',
          title: '删除线',
          active: s.strike,
          onClick: () => editor.chain().focus().toggleStrike().run(),
        }}
      />
      <Divider />
      <ToolbarButton
        b={{
          icon: <code>{'</>'}</code>,
          label: '行内码',
          title: '行内代码',
          active: s.code,
          onClick: () => editor.chain().focus().toggleCode().run(),
        }}
      />
      <ToolbarButton
        b={{
          icon: <code>{"{ }"}</code>,
          label: '代码块',
          title: '代码块',
          active: s.codeBlock,
          onClick: () => editor.chain().focus().toggleCodeBlock().run(),
        }}
      />
      <ToolbarButton
        b={{
          icon: '❝',
          label: '引用',
          title: '引用',
          active: s.blockquote,
          onClick: () => editor.chain().focus().toggleBlockquote().run(),
        }}
      />
      <Divider />
      {/* 列表下拉（优化 4） */}
      <Dropdown
        open={listOpen}
        onClose={() => setListOpen(false)}
        trigger={
          <button
            type="button"
            title="列表类型"
            onClick={() => setListOpen((v) => !v)}
            className={[
              'flex h-10 min-w-[52px] flex-col items-center justify-center gap-[3px] rounded-md px-1.5 transition-colors',
              s.bulletList || s.orderedList
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800',
            ].join(' ')}
          >
            <span className="text-[15px] leading-none">≡</span>
            <span
              className={[
                'max-w-full truncate text-[10px] leading-none',
                s.bulletList || s.orderedList ? 'font-medium' : 'text-gray-500',
              ].join(' ')}
            >
              列表
            </span>
          </button>
        }
      >
        <MenuItem active={s.bulletList} onClick={() => applyList('bullet')}>
          • 无序列表
        </MenuItem>
        <MenuItem active={s.orderedList} onClick={() => applyList('ordered')}>
          1. 有序列表
        </MenuItem>
        <MenuItem
          active={!s.bulletList && !s.orderedList}
          onClick={() => applyList('none')}
        >
          无（清除格式）
        </MenuItem>
      </Dropdown>
      <Divider />
      <ToolbarButton
        b={{
          icon: '∑',
          label: '行内公式',
          title: '插入行内公式（LaTeX 源码 + 渲染）',
          onClick: () => insertMathNode(editor, false),
        }}
      />
      <ToolbarButton
        b={{
          icon: '∑∑',
          label: '块级公式',
          title: '插入块级公式（LaTeX 源码 + 渲染）',
          onClick: () => insertMathNode(editor, true),
        }}
      />
      <ToolbarButton
        b={{
          icon: '📝',
          label: '注释',
          title: '插入注释（正文上标 [n] + 文末参考栏）',
          onClick: () => setFootnoteOpen(true),
        }}
      />
      <ToolbarButton
        b={{
          icon: '💡',
          label: '信息块',
          title: '插入信息块（标题可自定义）',
          onClick: () => editor.chain().focus().insertNote('', 'blue').run(),
        }}
      />
      {/* Phase 5：插入模块（来源记录模式） */}
      <Dropdown
        open={moduleOpen}
        onClose={() => setModuleOpen(false)}
        trigger={
          <button
            type="button"
            title="插入模块（复制 Modules/ 内容 + 来源标记）"
            onClick={() => void toggleModulePicker()}
            className={[
              'flex h-10 min-w-[52px] flex-col items-center justify-center gap-[3px] rounded-md px-1.5 transition-colors',
              'text-gray-600 hover:bg-gray-100 hover:text-gray-800',
            ].join(' ')}
          >
            <span className="text-[15px] leading-none">▣</span>
            <span className="max-w-full truncate text-[10px] leading-none text-gray-500">
              模块
            </span>
          </button>
        }
      >
        {modules.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-gray-400">
            暂无模块（在左侧 Modules 目录创建后刷新）
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {modules.map((m) => (
              <MenuItem key={m.path} onClick={() => void insertModule(m)}>
                {moduleLabel(m.path)}
              </MenuItem>
            ))}
          </div>
        )}
      </Dropdown>
      {/* 表格：行列网格选择器（1~8 行 × 1~8 列） */}
      <Dropdown
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        trigger={
          <button
            type="button"
            title="插入表格（选择行列数）"
            onClick={() => setTableOpen((v) => !v)}
            className="flex h-10 min-w-[52px] flex-col items-center justify-center gap-[3px] rounded-md px-1.5 transition-colors text-gray-600 hover:bg-gray-100 hover:text-gray-800"
          >
            <span className="text-[15px] leading-none">▦</span>
            <span className="max-w-full truncate text-[10px] leading-none text-gray-500">表格</span>
          </button>
        }
      >
        <TableSizePicker
          onPick={(rows, cols) => {
            setTableOpen(false)
            editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
          }}
        />
      </Dropdown>
      <ToolbarButton
        b={{
          icon: '📎',
          label: '附件',
          title: '插入附件（图片/文件/视频）',
          onClick: () => fileRef.current?.click(),
        }}
      />
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={onPickFile}
        accept="image/*,video/*,.pdf,.zip,.txt,.csv,.xlsx,.docx,.pptx,.epub,.json"
      />
      <div className="ml-auto flex shrink-0 items-center">
        <ToolbarButton
          b={{
            icon: '↩',
            label: '撤销',
            title: '撤销',
            disabled: !s.canUndo,
            onClick: () => editor.chain().focus().undo().run(),
          }}
        />
        <ToolbarButton
          b={{
            icon: '↪',
            label: '重做',
            title: '重做',
            disabled: !s.canRedo,
            onClick: () => editor.chain().focus().redo().run(),
          }}
        />
      </div>
      {/* 注释输入弹窗 */}
      <FootnoteDialog
        open={footnoteOpen}
        onClose={() => setFootnoteOpen(false)}
        onConfirm={(text, style) => {
          setFootnoteOpen(false)
          if (style === 'plain') editor.chain().focus().insertPlainFootnote(text).run()
          else editor.chain().focus().insertFootnote(text).run()
        }}
      />
    </div>
  )
}
