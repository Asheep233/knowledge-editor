/**
 * 编辑器工具栏（对齐参考稿 editor.html：单行 h-10 纯图标）。
 * 从左到右：标签（由 TabBar 提供）→ 字号▾ → 分隔线 → B/I/U/S → 分隔线 →
 * 无序/有序/引用/代码/链接/图片/公式 → 模块▾ → 「更多」▾（代码块/注释/信息块/表格/撤销/重做）→
 * 右侧：保存状态 + 历史快照 + 附件 + 导出主按钮（--primary 底白字）。
 * 图标控件直接映射 Tiptap 命令；激活态（B/I/U）随光标状态实时更新。
 */
import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { type MarkdownExtensionStorage } from '@tiptap/markdown'
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getModule, listModules, uploadAttachment, type ModuleInfo } from '../../api/client'
import { newId } from '../../editor/ke'
import { attachmentNode } from '../../editor/upload'
import { Icon } from '../icons'

/** 工具栏图标按钮（方形 32px，hover --muted 底；激活 --primary 色） */
function ToolIcon({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        'grid h-8 w-8 shrink-0 place-items-center rounded-[6px] transition-[background-color,color,transform] duration-150',
        active ? 'text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        'active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        disabled ? 'cursor-not-allowed opacity-40' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** 下拉容器（portal 到 body 固定定位，避免被工具栏裁剪） */
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

  useEffect(() => {
    if (!open) return
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width })
  }, [open])

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
              className="fixed z-50 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-xl"
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
        active ? 'bg-primary-soft font-medium text-blue-700' : 'text-foreground hover:bg-accent',
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
      <div className="mb-1.5 text-[11px] text-muted-foreground">{rows} 行 × {cols} 列</div>
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
                hover && r <= hover.r && c <= hover.c ? 'bg-primary-soft' : 'bg-gray-200 hover:bg-gray-300',
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
        active ? 'border-blue-500 bg-primary-soft' : 'border-border hover:border-gray-300',
      ].join(' ')}
    >
      <div className={['text-[13px] font-medium', active ? 'text-blue-700' : 'text-gray-800'].join(' ')}>
        {title}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</div>
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
        className="w-[420px] rounded-lg border border-border bg-card p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">插入注释</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="注释内容（正文出现上标 [n]，文末参考栏展示）"
          rows={3}
          autoFocus
          className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[13px] text-foreground outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
        />
        <div className="mt-3 flex gap-2">
          <StyleCard
            active={style === 'block'}
            onClick={() => setStyle('block')}
            title="灰底脚注区"
            desc="文末独立参考区域（KE 默认）"
          />
          <StyleCard
            active={style === 'plain'}
            onClick={() => setStyle('plain')}
            title="纯 Markdown"
            desc="普通段落（降级友好）"
          />
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border px-3 text-[13px] text-foreground/80 hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={confirm}
            className="h-8 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:brightness-95"
          >
            插入
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 模块标签：Modules/xxx.md → xxx（去前缀与 .md） */
function moduleLabel(p: string): string {
  return p.replace(/^Modules\//, '').replace(/\.md$/, '')
}

export interface EditorToolbarProps {
  /** TabBar 段（文档标签 + 新标签按钮），渲染在行最左（参考稿同一行） */
  tabBar?: ReactNode
  /** 右侧保存状态文字（如「已保存」）；为空则不显示 */
  saveLabel?: ReactNode
  /** 历史快照按钮 */
  onOpenHistory?: () => void
  /** 附件面板按钮（上方右侧附件图标） */
  onOpenAttachments?: () => void
  /** 导出主按钮（--primary 底白字） */
  exportButton?: ReactNode
  /** 立即保存（显式「保存」图标按钮） */
  onSave?: () => void
}

export default function EditorToolbar({
  tabBar,
  saveLabel,
  onOpenHistory,
  onOpenAttachments,
  exportButton,
  onSave,
}: EditorToolbarProps = {}) {
  const { editor } = useCurrentEditor()
  // 编辑器状态快照（激活态实时更新）
  const s = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: !!ctx.editor?.isActive('bold'),
      italic: !!ctx.editor?.isActive('italic'),
      underline: !!ctx.editor?.isActive('underline'),
      strike: !!ctx.editor?.isActive('strike'),
      code: !!ctx.editor?.isActive('code'),
      codeBlock: !!ctx.editor?.isActive('codeBlock'),
      blockquote: !!ctx.editor?.isActive('blockquote'),
      bulletList: !!ctx.editor?.isActive('bulletList'),
      orderedList: !!ctx.editor?.isActive('orderedList'),
      headingLevel: (() => {
        for (const lvl of [1, 2, 3, 4, 5, 6] as const) {
          if (ctx.editor?.isActive('heading', { level: lvl })) return lvl
        }
        return 0
      })(),
      canUndo: !!ctx.editor?.can().undo(),
      canRedo: !!ctx.editor?.can().redo(),
    }),
  })

  const [headingOpen, setHeadingOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [moduleOpen, setModuleOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [footnoteOpen, setFootnoteOpen] = useState(false)
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  // 收藏的图标按钮：阻止工具栏横向滚动（wheel → 平移）
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  if (!editor) return null

  // useEditorState 在编辑器未就绪时返回 null → 兜底默认状态（不渲染任何激活态）
  const st = s ?? {
    bold: false, italic: false, underline: false, strike: false,
    code: false, codeBlock: false, blockquote: false,
    bulletList: false, orderedList: false, headingLevel: 0,
    canUndo: false, canRedo: false,
  }

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

  const headingLabel = st.headingLevel > 0 ? `标题${st.headingLevel}` : '正文'

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
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border bg-card px-2">
      {/* TabBar 段（文档标签 + 新标签按钮，参考稿同一行） */}
      {tabBar}

      {/* 样式下拉：正文 / 标题1~6（参考稿「正文 ▾」第一段；单行纯图标 → 文字下拉） */}
      <Dropdown
        open={headingOpen}
        onClose={() => setHeadingOpen(false)}
        trigger={
          <button
            type="button"
            title="样式 / 标题"
            onClick={() => setHeadingOpen((v) => !v)}
            className={[
              'flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-[13px] transition-[background-color,color,transform] duration-150',
              st.headingLevel > 0 ? 'font-medium text-primary' : 'text-foreground',
              'hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none',
            ].join(' ')}
          >
            <span>{headingLabel}</span>
            <Icon name="chevron-down" className="size-3.5 text-muted-foreground" />
          </button>
        }
      >
        <MenuItem active={st.headingLevel === 0} onClick={() => applyHeading(0)}>正文</MenuItem>
        {([1, 2, 3, 4, 5, 6] as const).map((lvl) => (
          <MenuItem key={lvl} active={st.headingLevel === lvl} onClick={() => applyHeading(lvl)}>
            标题{lvl}（{lvl === 1 ? '最大' : lvl === 6 ? '最小' : ''}）
          </MenuItem>
        ))}
      </Dropdown>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />

      <ToolIcon title="加粗" active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Icon name="bold" className="size-4" />
      </ToolIcon>
      <ToolIcon title="斜体" active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Icon name="italic" className="size-4" />
      </ToolIcon>
      <ToolIcon title="下划线" active={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Icon name="underline" className="size-4" />
      </ToolIcon>
      <ToolIcon title="删除线" active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Icon name="strike" className="size-4" />
      </ToolIcon>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />

      {/* 列表下拉（无序/有序/取消） */}
      <Dropdown
        open={listOpen}
        onClose={() => setListOpen(false)}
        trigger={
          <button
            type="button"
            title="列表类型"
            onClick={() => setListOpen((v) => !v)}
            className={[
              'grid h-8 w-8 shrink-0 place-items-center rounded-[6px] transition-[background-color,color,transform] duration-150',
              st.bulletList || st.orderedList ? 'text-primary' : 'text-muted-foreground',
              'hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none',
            ].join(' ')}
          >
            <Icon name="list" className="size-4" />
          </button>
        }
      >
        <MenuItem active={st.bulletList} onClick={() => applyList('bullet')}>无序列表</MenuItem>
        <MenuItem active={st.orderedList} onClick={() => applyList('ordered')}>有序列表</MenuItem>
        <MenuItem active={!st.bulletList && !st.orderedList} onClick={() => applyList('none')}>无（清除格式）</MenuItem>
      </Dropdown>
      <ToolIcon title="有序列表" active={st.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <Icon name="ordered-list" className="size-4" />
      </ToolIcon>
      <ToolIcon title="引用" active={st.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Icon name="quote" className="size-4" />
      </ToolIcon>
      <ToolIcon title="行内代码" active={st.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Icon name="code" className="size-4" />
      </ToolIcon>
      <ToolIcon title="插入链接" onClick={() => {
        const prev = editor.getAttributes('link').href as string | undefined
        const url = window.prompt('链接地址：', prev ?? 'https://')
        if (url === null) return
        if (url === '') {
          editor.chain().focus().extendMarkRange('link').unsetLink().run()
          return
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      }}>
        <Icon name="link" className="size-4" />
      </ToolIcon>
      <ToolIcon title="插入图片" onClick={() => fileRef.current?.click()}>
        <Icon name="image" className="size-4" />
      </ToolIcon>
      <ToolIcon title="插入公式" onClick={() => {
        const node = { type: 'math', attrs: { id: newId(), latex: '' } }
        editor.chain().focus().insertContent(node).run()
      }}>
        <Icon name="sigma" className="size-4" />
      </ToolIcon>
      <ToolIcon title="插入块级公式" onClick={() => {
        const node = { type: 'mathBlock', attrs: { id: newId(), latex: '' } }
        editor.chain().focus().insertContent(node).run()
      }}>
        <Icon name="sigma" className="size-4" />
      </ToolIcon>

      {/* 模块▾（box 图标 + 文字 + chevron；懒加载） */}
      <Dropdown
        open={moduleOpen}
        onClose={() => setModuleOpen(false)}
        trigger={
          <button
            type="button"
            title="插入模块（复制 Modules/ 内容 + 来源标记）"
            onClick={() => void toggleModulePicker()}
            className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-border bg-card px-2.5 text-[13px] text-foreground transition-[background-color,color,transform,border-color] duration-150 hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
          >
            <Icon name="box" className="size-3.5 text-muted-foreground" />
            <span>模块</span>
            <Icon name="chevron-down" className="size-3.5 text-muted-foreground" />
          </button>
        }
      >
        {modules.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-muted-foreground">
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

      {/* 更多格式（展平为图标按钮，左右滑可见；隐藏较不常用功能但均可达） */}
      <ToolIcon title="代码块" active={st.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Icon name="code" className="size-4" />
      </ToolIcon>
      <ToolIcon title="注释（脚注）" onClick={() => setFootnoteOpen(true)}>
        <Icon name="note" className="size-4" />
      </ToolIcon>
      <ToolIcon title="信息块（ke-note）" onClick={() => editor.chain().focus().insertNote('', 'blue').run()}>
        <Icon name="bulb" className="size-4" />
      </ToolIcon>
      <ToolIcon title="表格…" onClick={() => setTableOpen(true)}>
        <Icon name="table" className="size-4" />
      </ToolIcon>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />

      <ToolIcon title="撤销" disabled={!st.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Icon name="undo" className="size-4" />
      </ToolIcon>
      <ToolIcon title="重做" disabled={!st.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Icon name="redo" className="size-4" />
      </ToolIcon>

      {/* 右侧：保存 + 保存状态 + 历史 + 附件 + 导出主按钮（--primary 底白字） */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {onSave ? (
          <ToolIcon title="保存（Ctrl+S）" onClick={onSave}>
            <Icon name="save" className="size-4" />
          </ToolIcon>
        ) : null}
        {saveLabel ? (
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground">{saveLabel}</span>
        ) : null}
        {onOpenHistory ? (
          <ToolIcon title="历史快照" onClick={onOpenHistory}>
            <Icon name="history" className="size-4" />
          </ToolIcon>
        ) : null}
        {onOpenAttachments ? (
          <ToolIcon title="附件" onClick={onOpenAttachments}>
            <Icon name="paperclip" className="size-4" />
          </ToolIcon>
        ) : null}
        {exportButton}
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={onPickFile}
        accept="image/*,video/*,.pdf,.zip,.txt,.csv,.xlsx,.docx,.pptx,.epub,.json"
      />

      {/* 表格：行列网格选择器（1~8 行 × 1~8 列）对话框（更多菜单触发） */}
      {tableOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={() => setTableOpen(false)}>
          <div className="rounded-lg border border-border bg-card p-3 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <TableSizePicker
              onPick={(rows, cols) => {
                setTableOpen(false)
                editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
              }}
            />
          </div>
        </div>
      ) : null}

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

/** 剥离模块内容开头的 `# 标题`（创建模块时自动生成，不随内容插入） */
export function stripModuleTitle(content: string): string {
  const m = /^#\s+.+(\n|$)/.exec(content.trimStart())
  return m ? content.trimStart().slice(m[0].length).trimStart() : content.trimStart()
}
