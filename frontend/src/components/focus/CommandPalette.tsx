/**
 * Focus 命令面板（⌘K）＋「打开的文档」切换（替代常驻标签栏）。
 * 占位骨架：由实现任务填充（参考稿 prototype/screens/editor.html 的 .palette）。
 */
import type { TabItem } from '../layout/TabBar'
import type { AppPage } from './pageTypes'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onNavigate: (page: AppPage) => void
  onOpenArticle: (id: string) => void
  onNewArticle: () => void
  tabs: TabItem[]
  activeId: string | null
  onActivateTab: (id: string) => void
  onCloseTab: (id: string) => void
  /** 导出（PDF 菜单） */
  onExport: () => void
  /** 切换源码/正文视图 */
  onToggleSource: () => void
  onToggleFocusMode: () => void
  onOpenSettings: () => void
  onToggleTheme: () => void
}

export function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null
  return (
    <div
      role="dialog"
      aria-label="命令面板"
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh]"
      style={{ background: 'var(--scrim)' }}
      onClick={props.onClose}
    >
      <div
        className="w-[min(640px,calc(100vw-40px))] rounded-[18px] border p-4"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--elev-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ color: 'var(--text-3)', fontSize: 13 }}>命令面板实现中…（Esc 关闭）</div>
      </div>
    </div>
  )
}
