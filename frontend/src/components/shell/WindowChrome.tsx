/**
 * WindowChrome（handoff §3.2 / 参考稿顶栏）：
 * - 左：应用名 + 文件 / 编辑 / 视图 / 帮助 菜单按钮（菜单栏 mock，仅 hover 态；
 *   「文件」为真实下拉：新建/导入/切换工作区等，其余按参考稿不做行为）
 * - 右：最小化 / 最大化 / 关闭（mock：桌面壳由 Tauri 原生窗口控件提供，此处仅视觉）
 * 背景 = --sidebar 底 + --sidebar-border 分隔线（与左栏同色系，参考稿一致）。
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'

interface Props {
  /** 文件菜单动作（真实功能接线） */
  onNewArticle?: () => void
  onImportFile?: () => void
  onOpenWorkspace?: () => void
  onNewWorkspace?: () => void
  onCloseWorkspace?: () => void
  onOpenSettings?: () => void
  onRecoveryCheck?: () => void
}

const MENU_BTN =
  'h-[22px] shrink-0 rounded-[6px] px-2 text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none'

export default function WindowChrome({
  onNewArticle,
  onImportFile,
  onOpenWorkspace,
  onNewWorkspace,
  onCloseWorkspace,
  onOpenSettings,
  onRecoveryCheck,
}: Props) {
  const [fileOpen, setFileOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!fileOpen) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      setFileOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [fileOpen])

  const item =
    'block w-full px-3 py-1.5 text-left text-[12px] text-foreground/80 hover:bg-accent'

  return (
    <div
      className="flex h-7 shrink-0 items-center justify-between pl-3 pr-1.5"
      style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-foreground)', borderBottom: '1px solid var(--sidebar-border)' }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <span className="mr-1.5 truncate text-[12px] font-semibold tracking-wide">KnowledgeEditor</span>
        {/* 文件：真实下拉（新建/导入/工作区/设置），其余 mock */}
        <div ref={wrapRef} className="relative">
          <button type="button" className={MENU_BTN} style={{ color: 'var(--sidebar-foreground)' }} onClick={() => setFileOpen((v) => !v)}>
            文件
          </button>
          {fileOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg">
              {onNewArticle ? (
                <button type="button" className={item} onClick={() => { setFileOpen(false); onNewArticle() }}>
                  新建文档…
                </button>
              ) : null}
              {onImportFile ? (
                <button type="button" className={item} onClick={() => { setFileOpen(false); onImportFile() }}>
                  导入 Markdown / 文档包…
                </button>
              ) : null}
              <div className="my-1 border-t border-border" />
              {onOpenWorkspace ? (
                <button type="button" className={item} onClick={() => { setFileOpen(false); onOpenWorkspace() }}>
                  打开工作区…
                </button>
              ) : null}
              {onNewWorkspace ? (
                <button type="button" className={item} onClick={() => { setFileOpen(false); onNewWorkspace() }}>
                  新建工作区…
                </button>
              ) : null}
              {onRecoveryCheck ? (
                <button type="button" className={item} onClick={() => { setFileOpen(false); onRecoveryCheck() }}>
                  恢复检查…
                </button>
              ) : null}
              {onCloseWorkspace ? (
                <button type="button" className={`${item} text-rose-600 hover:bg-rose-50`} onClick={() => { setFileOpen(false); onCloseWorkspace() }}>
                  关闭工作区
                </button>
              ) : null}
              <div className="my-1 border-t border-border" />
              {onOpenSettings ? (
                <button type="button" className={item} onClick={() => { setFileOpen(false); onOpenSettings() }}>
                  设置…
                </button>
              ) : null}
            </div>
          )}
        </div>
        {['编辑', '视图', '帮助'].map((label) => (
          <button key={label} type="button" className={MENU_BTN} style={{ color: 'var(--sidebar-foreground)' }}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" aria-label="最小化" className="grid h-7 w-7 place-items-center rounded-[6px] text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none" style={{ color: 'var(--sidebar-foreground)' }}>
          <Icon name="minus" className="size-3.5" />
        </button>
        <button type="button" aria-label="最大化" className="grid h-7 w-7 place-items-center rounded-[6px] text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none" style={{ color: 'var(--sidebar-foreground)' }}>
          <Icon name="square" className="size-3" />
        </button>
        <button type="button" aria-label="关闭" className="grid h-7 w-7 place-items-center rounded-[6px] text-[12px] transition-[background-color,color,transform] duration-150 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none" style={{ color: 'var(--sidebar-foreground)' }}>
          <Icon name="close" className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
