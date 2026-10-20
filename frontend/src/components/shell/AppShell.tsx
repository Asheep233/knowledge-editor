/**
 * 应用壳（AstraNota Focus 版 · 设计交接包 HANDOFF.md §2 / MIGRATION-CHECKLIST Phase 2）
 *
 * 结构：
 * - 没有顶栏；页面从窗口顶部开始。
 * - 左侧是浮在画布上的 256px 圆角卡片（浮动文件侧栏），可收起（«）与重新展开（» / Ctrl+\\）。
 * - 中央是最大 860px、阅读列 680px 的居中纸面卡片（由 EditorArea 内的 .focus-paper 承载）。
 * - 格式工具 / 保存 / 导出浮在纸面上方的浮动命令条（EditorArea 内的 EditorToolbar 经 CSS 浮起）。
 * - 右侧不设常驻信息栏：`right` 内容按需渲染为右侧浮层（InspectorSheet）。
 * - 底部状态条不再常驻；`statusBar` 仅保留在隐藏容器内（保存状态已进入浮动命令条）。
 *
 * 兼容：保留原 AppShell props 形状（header/left/main/right/statusBar），业务状态仍由 App 持有。
 */
import type { ReactNode } from 'react'

export interface AppShellProps {
  /** 顶栏（可选：如隐藏的导入 input；Focus 版不渲染可视顶栏） */
  header?: ReactNode
  /** 左侧浮动文件侧栏内容 */
  left?: ReactNode
  /** 中央列（编辑器 / 页面内容） */
  main: ReactNode
  /** 右侧信息浮层内容（`inspectorOpen` 为 true 时渲染为浮层，否则不渲染） */
  right?: ReactNode
  /** 底部状态条（Focus 版放入隐藏容器，仅用于保持 DOM/逻辑兼容） */
  statusBar?: ReactNode
  /** Focus：侧栏是否展开（桌面 ≥1280 保留左右对称留白，纸面中心不移动） */
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  /** Focus：右侧信息浮层是否展开 */
  inspectorOpen?: boolean
  onCloseInspector?: () => void
  /** Focus：专注模式（隐藏侧栏，命令条沉到纸面下方居中，仅留正文） */
  focusMode?: boolean
  onExitFocus?: () => void
}

export function AppShell({
  header,
  left,
  main,
  right,
  statusBar,
  sidebarOpen = true,
  onToggleSidebar,
  inspectorOpen = false,
  onCloseInspector,
  focusMode = false,
  onExitFocus,
}: AppShellProps) {
  return (
    <div
      data-ke-slot="shell-root"
      className="focus-shell"
      data-focus-mode={focusMode ? '1' : undefined}
    >
      {focusMode ? (
        <div className="focus-exit-bar" data-ke-appearance-scope="chrome">
          <button type="button" onClick={onExitFocus} title="退出专注模式（Esc）" aria-label="退出专注模式">
            <span aria-hidden="true">←</span>
            <span>退出专注</span>
          </button>
        </div>
      ) : null}
      <div
        data-ke-slot="shell-body"
        className="focus-body-row"
        data-focus-sidebar={sidebarOpen ? 'open' : 'closed'}
      >
        {left ? (
          sidebarOpen ? (
            <aside
              data-ke-slot="shell-navigation"
              data-ke-appearance-scope="chrome"
              className="focus-files-bar"
              aria-label="文件与导航"
            >
              {left}
            </aside>
          ) : onToggleSidebar ? (
            <button
              type="button"
              className="focus-sidebar-reopen"
              title="展开文件侧栏（Ctrl/Cmd+\）"
              aria-label="展开文件侧栏"
              onClick={onToggleSidebar}
            >
              »
            </button>
          ) : null
        ) : null}

        <main data-ke-slot="shell-main" className="focus-main-col">
          {main}
        </main>

        {sidebarOpen ? (
          <button
            type="button"
            className="focus-drawer-scrim"
            aria-label="关闭文件抽屉"
            onClick={onToggleSidebar}
          />
        ) : null}

        {inspectorOpen && right ? (
          <div className="focus-inspector-layer">
            <button
              type="button"
              className="focus-inspector-scrim"
              aria-label="关闭文档信息"
              onClick={onCloseInspector}
            />
            <div
              data-ke-slot="shell-inspector"
              data-ke-appearance-scope="chrome"
              className="focus-inspector-sheet"
            >
              {right}
            </div>
          </div>
        ) : null}
      </div>
      {header}
      {statusBar ? (
        <div className="focus-status-hidden" aria-hidden="true">
          {statusBar}
        </div>
      ) : null}
    </div>
  )
}
