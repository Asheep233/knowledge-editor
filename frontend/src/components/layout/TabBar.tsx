/**
 * Tab 栏（文档标签页，v1.2.0-pre.1 第 1 步 · task-30）。
 *
 * 职责边界：
 * - **App 持有**「打开的文档集合」状态（`tabs` + 激活项 = `article.id`），本模块只提供
 *   ① 纯函数（增删/相邻/标题同步，可无 DOM 穷举测试）② 渲染组件（受控）③ 插槽
 *   `TabBarSlot`（经 context 注入，供 `EditorToolbar` 的既有 `tabBar` 槽位使用）。
 * - 标签集合是**会话状态**：不写 .md / ke-* / 设置（不持久化）。
 * - 切换/关闭的**数据安全**不在本模块：一律由 App 走既有 `requestOpenArticle`
 *   （`flushWithTimeout` + docSwitch 缝），本模块不碰 editor / saveQueue。
 */
import { createContext, useContext, type ReactNode } from 'react'
import { Icon } from '../icons'

export interface TabItem {
  /** 文档 id（= workspace 相对路径） */
  id: string
  /** 标签标题（文档标题；重命名/保存回包后同步） */
  title: string
}

/** 打开文档：已有同 id → 仅激活（追加语义由 App 的 article 状态承担）；否则追加到末尾。 */
export function openTab(tabs: TabItem[], item: TabItem): TabItem[] {
  const i = tabs.findIndex((t) => t.id === item.id)
  if (i < 0) return [...tabs, item]
  if (tabs[i].title === item.title) return tabs // 引用稳定（避免无谓重渲染）
  return tabs.map((t, k) => (k === i ? { ...t, title: item.title } : t))
}

/**
 * 关闭标签。返回新列表与**关闭后的激活 id**：
 * - 关闭非激活标签 → 激活项不变；
 * - 关闭激活标签 → **左邻优先**（主理人裁决/task-30 契约）；无左邻 → 右邻；
 * - 关闭最后一个 → `activeId = null`（回空态）。
 */
export function closeTab(
  tabs: TabItem[],
  activeId: string | null,
  closeId: string,
): { tabs: TabItem[]; activeId: string | null } {
  const i = tabs.findIndex((t) => t.id === closeId)
  if (i < 0) return { tabs, activeId }
  const next = tabs.filter((t) => t.id !== closeId)
  if (activeId !== closeId) return { tabs: next, activeId }
  if (next.length === 0) return { tabs: next, activeId: null }
  const ni = i - 1 >= 0 ? i - 1 : 0
  return { tabs: next, activeId: next[ni].id }
}

/** 重命名/移动：原位替换 tab id（保持顺序），标题可一并更新。 */
export function replaceTab(tabs: TabItem[], fromId: string, toId: string, title?: string): TabItem[] {
  const i = tabs.findIndex((t) => t.id === fromId)
  if (i < 0) return openTab(tabs, { id: toId, title: title ?? toId })
  return tabs.map((t, k) => (k === i ? { id: toId, title: title ?? t.title } : t))
}

/** 同步标题（保存回包 / 页眉重命名）。 */
export function setTabTitle(tabs: TabItem[], id: string, title: string): TabItem[] {
  const i = tabs.findIndex((t) => t.id === id)
  if (i < 0 || tabs[i].title === title) return tabs
  return tabs.map((t, k) => (k === i ? { ...t, title } : t))
}

/**
 * 环绕相邻标签（`doc.next` = 1 / `doc.prev` = -1）：
 * 最后一个 → 第一个、第一个 → 最后一个；空列表 → null；单标签 → 当前标签（不切换）。
 */
export function adjacentTabId(tabs: TabItem[], activeId: string | null, delta: 1 | -1): string | null {
  if (tabs.length === 0) return null
  const i = tabs.findIndex((t) => t.id === activeId)
  if (i < 0) return tabs[0].id
  if (tabs.length === 1) return tabs[0].id
  return tabs[(i + delta + tabs.length) % tabs.length].id
}

export interface TabBarProps {
  tabs: TabItem[]
  activeId?: string | null
  /** 有未保存修改的标签 id（与 App 的 saveState / saveQueue 同源，不另建 dirty 状态） */
  dirtyId?: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

/** 受控 Tab 栏：无标签时渲染 null（空态由编辑器区承担，不产坏标签）。 */
export function TabBar({ tabs, activeId, dirtyId, onActivate, onClose }: TabBarProps) {
  if (tabs.length === 0) return null
  return (
    <div
      role="tablist"
      aria-label="打开的文档"
      data-testid="tab-bar"
      className="flex h-8 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scroll-smooth"
    >
      {tabs.map((t) => {
        const active = t.id === activeId
        const dirty = t.id === dirtyId
        return (
          <div
            key={t.id}
            data-tab-id={t.id}
            data-active={active ? 'true' : 'false'}
            className={[
              'group flex h-7 max-w-[180px] shrink-0 items-center rounded-[6px] border',
              active ? 'border-border bg-background' : 'border-transparent hover:bg-accent',
            ].join(' ')}
          >
            {/* 激活控件：原生 button（键盘可达、可聚焦） */}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={t.id}
              className="flex h-full min-w-0 items-center gap-1.5 pl-2 pr-1 text-[12px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => onActivate(t.id)}
              onMouseDown={(e) => {
                // 中键：阻止 WebView 的自动滚动，改由 onAuxClick 关闭
                if (e.button === 1) e.preventDefault()
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(t.id)
                }
              }}
            >
              <span className={`truncate ${active ? 'font-medium' : ''}`}>{t.title || t.id}</span>
              {dirty ? (
                <span
                  data-dirty="true"
                  title="有未保存修改"
                  aria-label="有未保存修改"
                  className="size-1.5 shrink-0 rounded-full bg-amber-500"
                />
              ) : null}
            </button>
            {/* 关闭控件：与激活按钮是兄弟节点（避免 button 嵌套 button 的非法 DOM） */}
            <button
              type="button"
              aria-label={`关闭 ${t.title || t.id}`}
              title="关闭标签"
              className="mr-0.5 grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
            >
              <Icon name="close" className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** App 通过本 context 注入标签状态；`EditorToolbar` 的 tabBar 槽位默认渲染 `TabBarSlot`。 */
export const TabsContext = createContext<TabBarProps | null>(null)

/** 插槽组件：无 provider（或未打开文档）时渲染 null；显式 `tabBar` prop 仍优先。 */
export function TabBarSlot(): ReactNode {
  const ctx = useContext(TabsContext)
  if (!ctx) return null
  return <TabBar {...ctx} />
}
