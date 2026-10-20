/** LeftSidebar（Focus 最终版）测试：
 * 侧栏只保留「工作区头 + 新建文档按钮 + 导航 5 项 + 文件区（label/新建/文章树）+ footer 三段」。
 * 侧栏内部不再渲染 搜索/模块/资料/回收站/最近/标签 视图 —— 导航点击只切换主画布页面
 * （`onNavigate(page)`），激活态由 `activePage` 决定（task-12）。
 *
 * 覆盖：
 * A. 导航 5 项 + 主画布切页回调 + activePage 高亮；侧栏内容不随导航切换（固定文件树）
 * B. 文件区：文件 label / 新建文档+新建文件夹入口 / 文章树 / activeId 高亮 / 加载失败重试 / 空态
 * C. 删除确认文案（契约 §7：文档软删单次确认且可恢复；文件夹硬删双重确认）
 * D. footer 三段（设置 / 专注模式 / 切换外观）回调与主题图标
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import LeftSidebar from './LeftSidebar'
import * as api from '../../api/client'
import type { TreePayload } from '../../types'

// 2026-09-15：确认机制由原生 window.confirm（Tauri 下被替换为 async → 恒 truthy、静默绕过）
// 改为自绘 askConfirm。此处 mock 该模块以断言「调用点传对了文案、并遵守用户选择」；
// 对话框自身的渲染/交互由 components/common/PromptDialog.test.tsx 覆盖。
const promptMocks = vi.hoisted(() => ({
  askConfirm: vi.fn(async (_msg: string, _opts?: unknown) => true as boolean),
  askPrompt: vi.fn(async (_title?: string, _defaultValue?: string) => null as string | null),
}))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: promptMocks.askConfirm,
  askPrompt: promptMocks.askPrompt,
  usePrompt: () => promptMocks.askPrompt,
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

// 侧栏现在只依赖文件树 / 文件操作 API（搜索、附件、回收站、最近、标签已迁主画布页面）
vi.mock('../../api/client', () => ({
  createDocIn: vi.fn(),
  createFolder: vi.fn(),
  deleteArticle: vi.fn(),
  deleteFolder: vi.fn(),
  getTree: vi.fn(),
  movePath: vi.fn(),
  renameDoc: vi.fn(),
  renameFolder: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function tree(articles: string[] = []): TreePayload {
  return { root: '/ws', articles, modules: [], attachments: { images: [], videos: [], files: [] } }
}

let root: Root | null = null
let container: HTMLDivElement
/** happy-dom v20 未实现 window.alert（typeof === 'undefined'），直接挂 spy */
let alertSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks 不清实现 → 显式重置，避免上一用例的 mock 泄漏
  promptMocks.askConfirm.mockResolvedValue(true)
  promptMocks.askPrompt.mockResolvedValue(null)
  container = document.createElement('div')
  document.body.appendChild(container)
  alertSpy = vi.fn()
  ;(window as unknown as { alert: unknown }).alert = alertSpy
  vi.mocked(api.getTree).mockResolvedValue(tree())
  vi.mocked(api.createDocIn).mockResolvedValue({} as never)
  vi.mocked(api.createFolder).mockResolvedValue({ path: 'Articles/x' } as never)
  vi.mocked(api.deleteArticle).mockResolvedValue({} as never)
  vi.mocked(api.deleteFolder).mockResolvedValue({ deleted: '' } as never)
  vi.mocked(api.movePath).mockResolvedValue({ from: 'a', to: 'b' } as never)
  vi.mocked(api.renameDoc).mockResolvedValue({ from: 'a', to: 'b' } as never)
  vi.mocked(api.renameFolder).mockResolvedValue({ from: 'a', to: 'b' } as never)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function render(
  props: Partial<React.ComponentProps<typeof LeftSidebar>> = {},
  treeData?: TreePayload,
): Promise<void> {
  if (treeData) vi.mocked(api.getTree).mockResolvedValue(treeData)
  root = createRoot(container)
  const full: React.ComponentProps<typeof LeftSidebar> = { activeId: null, onOpenArticle: vi.fn(), ...props }
  await act(async () => {
    root!.render(<LeftSidebar {...full} />)
  })
  await settle()
}

/** 同一 root 重新渲染（用于 props 变化场景） */
async function rerender(props: Partial<React.ComponentProps<typeof LeftSidebar>> = {}): Promise<void> {
  const full: React.ComponentProps<typeof LeftSidebar> = { activeId: null, onOpenArticle: vi.fn(), ...props }
  await act(async () => {
    root!.render(<LeftSidebar {...full} />)
  })
  await settle()
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
  })
  await settle()
}

async function openContextMenu(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  })
}

/** 右键菜单中的「删除…」→ 触发确认流程 */
async function deleteVia(node: HTMLElement): Promise<void> {
  await openContextMenu(node)
  await click(findButton('删除…')!)
}

// ============================================================================
// A. 导航 5 项 → 主画布切页（task-12）
// ============================================================================
describe('LeftSidebar — 导航 5 项与主画布切页', () => {
  it('导航 5 项齐全；editor 页（未传 activePage）默认高亮「知识库」', async () => {
    await render()
    for (const label of ['知识库', '搜索', '模块', '资料', '回收站']) {
      expect(findButton(label), `缺少导航项：${label}`).toBeTruthy()
    }
    expect(findButton('知识库')!.getAttribute('aria-current')).toBe('page')
    for (const label of ['搜索', '模块', '资料', '回收站']) {
      expect(findButton(label)!.getAttribute('aria-current'), label).toBeNull()
    }
  })

  it('点击导航只回调 onNavigate(page)，不在侧栏渲染对应旧视图', async () => {
    const onNavigate = vi.fn()
    await render({ onNavigate })

    const cases: Array<[string, string]> = [
      ['知识库', 'library'],
      ['搜索', 'search'],
      ['模块', 'modules'],
      ['资料', 'assets'],
      ['回收站', 'trash'],
    ]
    for (const [label, page] of cases) {
      await click(findButton(label)!)
      expect(onNavigate).toHaveBeenLastCalledWith(page)
    }

    // 旧侧栏视图的 DOM 钩子/输入框一个都不应出现
    expect(container.querySelector('#ke-global-search')).toBeNull()
    expect(container.querySelector('[data-testid="attachments-toggle"]')).toBeNull()
    expect(container.querySelector('[data-testid="orphans-block"]')).toBeNull()
    expect(container.querySelector('[data-trash-id]')).toBeNull()
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(0)
  })

  it('activePage 决定高亮：search/modules/assets/trash 与回到 library', async () => {
    const onNavigate = vi.fn()
    const pages = ['search', 'modules', 'assets', 'trash', 'library'] as const
    const labels: Record<(typeof pages)[number], string> = {
      library: '知识库',
      search: '搜索',
      modules: '模块',
      assets: '资料',
      trash: '回收站',
    }
    await render({ activePage: 'search', onNavigate })
    expect(findButton('搜索')!.getAttribute('aria-current')).toBe('page')
    expect(findButton('知识库')!.getAttribute('aria-current')).toBeNull()

    for (const page of pages) {
      await rerender({ activePage: page, onNavigate })
      expect(findButton(labels[page])!.getAttribute('aria-current'), `activePage=${page}`).toBe('page')
      for (const other of pages) {
        if (other !== page) {
          expect(findButton(labels[other])!.getAttribute('aria-current'), `${page}/${other}`).toBeNull()
        }
      }
    }
  })

  it('侧栏内容固定：导航切换后文件树仍在，不出现任何内部视图内容', async () => {
    const onNavigate = vi.fn()
    await render({ onNavigate }, tree(['Articles/文档A.md']))
    expect(container.textContent).toContain('文档A')

    for (const label of ['搜索', '模块', '资料', '回收站']) {
      await click(findButton(label)!)
      expect(container.textContent, `切到 ${label} 后文件树丢失`).toContain('文档A')
      expect(container.textContent).toContain('文件')
    }
  })

  it('导航按钮是原生 button 且可键盘聚焦（焦点环/Enter 由原生行为保证）', async () => {
    await render()
    for (const label of ['知识库', '搜索', '模块', '资料', '回收站']) {
      const btn = findButton(label)!
      expect(btn.tagName).toBe('BUTTON')
      expect(btn.getAttribute('type')).toBe('button')
      expect(btn.disabled).toBe(false)
    }
  })
})

// ============================================================================
// B. 文件区（固定展示）
// ============================================================================
describe('LeftSidebar — 文件区', () => {
  it('渲染「文件」label + 新建文档/新建文件夹图标按钮', async () => {
    await render()
    const fileLabel = Array.from(container.querySelectorAll('span')).find((s) => s.textContent?.trim() === '文件')
    expect(fileLabel, '缺少「文件」区标题').toBeTruthy()
    expect(container.querySelector('button[aria-label="新建文档"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="新建文件夹"]')).toBeTruthy()
  })

  it('渲染文章树：文件夹行（div.group + 计数）/ 文档行（title=relPath）', async () => {
    await render({}, tree(['Articles/子目录/文档B.md', 'Articles/文档A.md']))
    const folder = container.querySelector<HTMLElement>('div.group')
    expect(folder, '缺少文件夹行').toBeTruthy()
    expect(folder!.textContent).toContain('子目录')
    expect(folder!.textContent).toContain('1')

    const doc = container.querySelector<HTMLElement>('[title="Articles/文档A.md"]')
    expect(doc).toBeTruthy()
    expect(doc!.textContent).toContain('文档A')
  })

  it('点击文档 → onOpenArticle(relPath)；点击文件夹只展开/收起，不打开文档', async () => {
    const onOpenArticle = vi.fn()
    await render({ onOpenArticle }, tree(['Articles/子目录/文档B.md']))

    // 文件夹默认收起（子文档不在 DOM）；先展开
    const folder = container.querySelector<HTMLElement>('div.group')!
    expect(container.querySelector('[title="Articles/子目录/文档B.md"]')).toBeNull()
    await click(folder)

    const doc = container.querySelector<HTMLElement>('[title="Articles/子目录/文档B.md"]')!
    await click(doc)
    expect(onOpenArticle).toHaveBeenCalledWith('Articles/子目录/文档B.md')

    // 点文件夹只会收起，不打开文档；收起后子文档消失
    onOpenArticle.mockClear()
    await click(folder)
    expect(onOpenArticle).not.toHaveBeenCalled()
    expect(container.querySelector('[title="Articles/子目录/文档B.md"]')).toBeNull()
  })

  it('activeId 对应文档行高亮（bg-sidebar-accent）', async () => {
    await render({ activeId: 'Articles/文档A.md' }, tree(['Articles/文档A.md']))
    const doc = container.querySelector<HTMLElement>('[title="Articles/文档A.md"]')!
    expect(doc.className).toContain('bg-sidebar-accent')
  })

  it('空树 → 「暂无文章」', async () => {
    await render()
    expect(container.textContent).toContain('暂无文章')
  })

  it('加载失败：显示「加载失败，请重试」，点重试重新拉取成功', async () => {
    vi.mocked(api.getTree).mockRejectedValueOnce(new Error('boom'))
    await render()
    expect(container.textContent).toContain('加载失败，请重试')

    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/文档A.md']))
    await click(findButton('重试')!)
    expect(container.textContent).toContain('文档A')
  })

  it('refreshKey 变化触发重新加载文件树', async () => {
    await render({ refreshKey: 0 })
    expect(vi.mocked(api.getTree).mock.calls.length).toBe(1)
    await rerender({ refreshKey: 1 })
    expect(vi.mocked(api.getTree).mock.calls.length).toBe(2)
  })
})

// ============================================================================
// C. 删除确认文案（契约 §7）
// ============================================================================
describe('LeftSidebar — 删除确认文案（契约 §7）', () => {
  it('文档删除：单次确认且文案含「可在回收站恢复」', async () => {
    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/文档A.md']))
    await render()

    const node = container.querySelector<HTMLElement>('[title="Articles/文档A.md"]')!
    expect(node).toBeTruthy()
    await deleteVia(node)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    const msg = String(promptMocks.askConfirm.mock.calls[0][0])
    expect(msg).toContain('确认删除「文档A.md」')
    expect(msg).toContain('可在回收站恢复')
    expect(msg).not.toContain('无法恢复')
    expect(vi.mocked(api.deleteArticle)).toHaveBeenCalledWith('Articles/文档A.md')
  })

  it('文档删除：取消确认则不发起删除请求', async () => {
    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/文档A.md']))
    promptMocks.askConfirm.mockResolvedValue(false)
    await render()

    await deleteVia(container.querySelector<HTMLElement>('[title="Articles/文档A.md"]')!)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteArticle)).not.toHaveBeenCalled()
  })

  it('文件夹删除：保留原「无法恢复」双重确认', async () => {
    vi.mocked(api.getTree).mockResolvedValue(tree(['Articles/子目录/文档B.md']))
    await render()

    const folderRow = container.querySelector<HTMLElement>('div.group')!
    expect(folderRow.textContent).toContain('子目录')
    await deleteVia(folderRow)

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(2)
    const first = String(promptMocks.askConfirm.mock.calls[0][0])
    const second = String(promptMocks.askConfirm.mock.calls[1][0])
    expect(first).toContain('确认删除「子目录」')
    expect(first).not.toContain('可在回收站恢复')
    expect(second).toContain('无法恢复')
    expect(vi.mocked(api.deleteFolder)).toHaveBeenCalledWith('Articles/子目录')
  })
})

// ============================================================================
// D. footer 三段
// ============================================================================
describe('LeftSidebar — footer 三段与回调', () => {
  it('footer 渲染 设置 / 专注模式 / 切换外观，点击分别回调', async () => {
    const onOpenSettings = vi.fn()
    const onToggleFocusMode = vi.fn()
    const onToggleTheme = vi.fn()
    await render({ onOpenSettings, onToggleFocusMode, onToggleTheme })

    const settings = findButton('设置')!
    const focusMode = findButton('专注模式')!
    const theme = findButton('切换外观')!
    expect(settings.getAttribute('aria-label')).toBe('打开设置')
    expect(theme.getAttribute('aria-label')).toBe('切换外观')

    await click(settings)
    await click(focusMode)
    await click(theme)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1)
    expect(onToggleTheme).toHaveBeenCalledTimes(1)
  })

  it('外观图标随 themeIsDark 切换 moon/sun', async () => {
    await render()
    expect(container.querySelector('[data-appearance-icon="moon"]')).toBeTruthy()
    await rerender({ themeIsDark: true })
    expect(container.querySelector('[data-appearance-icon="sun"]')).toBeTruthy()
  })

  it('收起侧栏按钮保留（onCollapse + aria-label）', async () => {
    const onCollapse = vi.fn()
    await render({ onCollapse })
    const collapse = container.querySelector<HTMLButtonElement>('button[aria-label="收起文件侧栏"]')
    expect(collapse).toBeTruthy()
    await click(collapse!)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })
})
