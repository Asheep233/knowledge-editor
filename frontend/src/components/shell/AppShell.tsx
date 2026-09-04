/**
 * 应用共享壳（handoff §3.1）：三栏桌面窗口布局，全部令牌化（零硬编码色值）。
 *
 * 布局常量（handoff §3.1）：
 * - 左侧导航 w-[280px]，背景 --sidebar，右侧 1px --sidebar-border；
 * - 中央 flex-1 min-w-0，背景 --background；
 * - 右侧属性栏 w-[300px]，背景 --background，左侧 1px --border；
 * - 底部可选状态条（StatusBar）。
 *
 * 说明：菜单栏/窗口控件交给 Tauri 原生（menu.rs），本组件不含 mock 菜单栏。
 */
import type { ReactNode } from 'react'

export interface AppShellProps {
  /** 顶栏（可选：应用头，如工作区选择 / 版本徽标区域） */
  header?: ReactNode
  /** 左侧导航（FileSidebar / 工作区选择页不传，则不渲染侧栏列） */
  left?: ReactNode
  /** 中央列（编辑器 / 页面内容） */
  main: ReactNode
  /** 右侧属性栏（InspectorPanel；null = 不渲染右列，如设置页/启动器页） */
  right?: ReactNode
  /** 底部状态条（StatusBar 组件） */
  statusBar?: ReactNode
}

export function AppShell({ header, left, main, right, statusBar }: AppShellProps) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {header}
      <div className="flex min-h-0 flex-1">
        {left ? (
          <aside className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            {left}
          </aside>
        ) : null}
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">{main}</main>
        {right ? (
          <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-l border-border bg-background">
            {right}
          </aside>
        ) : null}
      </div>
      {statusBar}
    </div>
  )
}
