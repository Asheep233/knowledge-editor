/**
 * LeftSidebar「Focus 最终版」独立对抗验证套件（task-12 · verifier-sidebar-final）
 *
 * 判据变更留痕（task-12）：侧栏 IA 最终收口为「导航 5 项 + 固定文章文件树 + footer 三段」，
 * 侧栏内部不再渲染 搜索/模块/资料/回收站/最近/标签 视图；导航只切主画布页面。
 * 因此「侧栏内附件区/搜索框/回收站视图」相关旧判据（task-14/task-24）**随功能迁出而移除**，
 * 对应能力由主画布页面（AssetsPage/SearchPage/TrashPage，task-9/10/11）与其测试承接。
 * 与侧栏无关的文件树/文件操作/footer 行为判据**一条未删、一条未削弱**。
 *
 * 攻击面覆盖：
 *   ① 导航契约：5 项 → onNavigate(page)；activePage 高亮唯一；旧视图 DOM 零残留
 *   ② 固定文件树：数据/样式契约（title / group / 30px 行 / 12.5px / 文件名不省略 / 缩进 / 计数）
 *   ③ 文件操作全链路：新建文档/文件夹（含文件夹内联 +）、重命名、移动、删除 → API + onFsMutation + 刷新
 *   ④ 只读不变量：挂载/导航/展开/右键/取消确认 → 零写请求 + 零裸 fetch + 零 alert
 *   ⑤ onBeforeFsMutation 否决权（rename/move/delete 前置 flush 未决保存，否决则不调 API）
 *   ⑥ footer 回调 / 主题图标 / 收起 / 加载失败重试 / 空态 / refreshKey
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import LeftSidebar from './LeftSidebar'
import * as api from '../../api/client'
import type { FsMutation } from '../../App'
import type { TreePayload } from '../../types'

// ---------- 模块替身（api/client：左栏最终版所需的全部依赖） ----------
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

const promptMocks = vi.hoisted(() => ({
  askConfirm: vi.fn(async (_msg: string, _opts?: unknown) => true as boolean),
  askPrompt: vi.fn(async (_title?: string, _def?: string) => null as string | null),
}))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: promptMocks.askConfirm,
  askPrompt: promptMocks.askPrompt,
  usePrompt: () => promptMocks.askPrompt,
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------- 写请求清单（只读不变量） ----------
const WRITE_FUNCS = [
  'createDocIn',
  'createFolder',
  'deleteArticle',
  'deleteFolder',
  'movePath',
  'renameDoc',
  'renameFolder',
] as const

type AnyMock = ReturnType<typeof vi.fn>
const apiMocks = api as unknown as Record<string, AnyMock>
let fetchSpy: AnyMock

function callsOf(fn: string): unknown[][] {
  const m = apiMocks[fn]
  if (!m) throw new Error(`api/client 替身缺少导出 ${fn}`)
  return m.mock.calls as unknown[][]
}

function assertNoWrites(): void {
  const touched = WRITE_FUNCS.filter((fn) => callsOf(fn).length > 0)
  expect(
    touched,
    `只读不变量被破：以下写请求被调用 ${JSON.stringify(touched.map((f) => [f, callsOf(f)]))}`,
  ).toEqual([])
  expect(
    fetchSpy.mock.calls,
    `只读不变量被破：出现绕过 api/client 的裸 fetch ${JSON.stringify(fetchSpy.mock.calls)}`,
  ).toEqual([])
}

// ---------- 测试数据 ----------
const DOC_A = 'Articles/文档A.md'
const DOC_B = 'Articles/子目录/文档B.md'
const FOLDER = 'Articles/子目录'

function tree(articles: string[] = []): TreePayload {
  return { root: '/ws', articles, modules: [], attachments: { images: [], videos: [], files: [] } }
}

// ---------- 渲染脚手架 ----------
let root: Root | null = null
let container: HTMLDivElement
let alertSpy: AnyMock
let openSpy: ReturnType<typeof vi.fn<(id: string) => void>>
let navSpy: ReturnType<typeof vi.fn<(page: string) => void>>
let fsSpy: ReturnType<typeof vi.fn<(m: FsMutation) => void>>

interface RenderOpts {
  tree?: TreePayload
  refreshKey?: number
  activePage?: 'library' | 'search' | 'modules' | 'assets' | 'trash'
  activeId?: string | null
  onBeforeFsMutation?: (node: import('../../utils/tree').TreeNode) => Promise<boolean>
  onOpenSettings?: () => void
  onToggleFocusMode?: () => void
  onToggleTheme?: () => void
  themeIsDark?: boolean
  onCollapse?: () => void
}

async function render(opts: RenderOpts = {}): Promise<void> {
  vi.mocked(api.getTree).mockResolvedValue(opts.tree ?? tree())
  openSpy = vi.fn<(id: string) => void>()
  navSpy = vi.fn<(page: string) => void>()
  fsSpy = vi.fn<(m: FsMutation) => void>()
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <LeftSidebar
        activeId={opts.activeId ?? null}
        onOpenArticle={openSpy}
        refreshKey={opts.refreshKey ?? 0}
        workspaceRoot="/ws"
        activePage={opts.activePage}
        onNavigate={navSpy}
        onFsMutation={fsSpy}
        onBeforeFsMutation={opts.onBeforeFsMutation}
        onOpenSettings={opts.onOpenSettings}
        onToggleFocusMode={opts.onToggleFocusMode}
        onToggleTheme={opts.onToggleTheme}
        themeIsDark={opts.themeIsDark ?? false}
        onCollapse={opts.onCollapse}
      />,
    )
  })
  await settle()
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function click(el: HTMLElement | undefined | null, label = '元素'): Promise<void> {
  expect(el, `未找到可点击元素：${label}`).toBeTruthy()
  await act(async () => {
    el!.click()
  })
  await settle()
}

async function openContextMenu(el: HTMLElement | undefined | null, label = '行'): Promise<void> {
  expect(el, `未找到右键目标：${label}`).toBeTruthy()
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  })
  await settle()
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
}

function docRow(rel: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[title="${rel}"]`)
}

function folderRow(name: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('div.group')).find((el) =>
    (el.textContent ?? '').includes(name),
  )
}

function fileLabel(): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('span')).find(
    (s) => (s.textContent ?? '').trim() === '文件',
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  promptMocks.askConfirm.mockResolvedValue(true)
  promptMocks.askPrompt.mockResolvedValue(null)
  container = document.createElement('div')
  document.body.appendChild(container)
  alertSpy = vi.fn()
  ;(window as unknown as { alert: unknown }).alert = alertSpy
  fetchSpy = vi.fn(async () => new Response('{}'))
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchSpy
  vi.mocked(api.createDocIn).mockResolvedValue({} as never)
  vi.mocked(api.createFolder).mockResolvedValue({ path: 'Articles/x' } as never)
  vi.mocked(api.deleteArticle).mockResolvedValue({} as never)
  vi.mocked(api.deleteFolder).mockResolvedValue({ deleted: '' } as never)
  vi.mocked(api.movePath).mockResolvedValue({ from: DOC_A, to: 'Articles/归档/文档A.md' } as never)
  vi.mocked(api.renameDoc).mockResolvedValue({ from: DOC_A, to: 'Articles/文档A-新.md' } as never)
  vi.mocked(api.renameFolder).mockResolvedValue({ from: FOLDER, to: 'Articles/子目录-新' } as never)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

// ============================================================================
// V1 导航契约：只切主画布页面，侧栏不再内嵌任何视图
// ============================================================================
describe('V1 导航契约（onNavigate / activePage / 无内部视图）', () => {
  it('5 项导航各自回调正确 page（顺序与 id 一一对应）', async () => {
    await render()
    const cases: Array<[string, string]> = [
      ['知识库', 'library'],
      ['搜索', 'search'],
      ['模块', 'modules'],
      ['资料', 'assets'],
      ['回收站', 'trash'],
    ]
    for (const [label, page] of cases) {
      await click(findButton(label), `导航项 ${label}`)
      expect(navSpy, `点击 ${label}`).toHaveBeenLastCalledWith(page)
    }
    expect(navSpy.mock.calls.map((c) => c[0])).toEqual([
      'library',
      'search',
      'modules',
      'assets',
      'trash',
    ])
    // 导航本身是只读操作：不得产生任何文件系统写请求
    assertNoWrites()
  })

  it('activePage 高亮唯一且互斥（每个页面逐项验证）', async () => {
    await render({ activePage: 'library' })
    const labels: Record<string, string> = {
      library: '知识库',
      search: '搜索',
      modules: '模块',
      assets: '资料',
      trash: '回收站',
    }
    for (const page of Object.keys(labels)) {
      await act(async () => {
        root!.render(
          <LeftSidebar
            activeId={null}
            onOpenArticle={openSpy}
            activePage={page as RenderOpts['activePage']}
            onNavigate={navSpy}
          />,
        )
      })
      await settle()
      for (const [otherPage, otherLabel] of Object.entries(labels)) {
        const expected = otherPage === page ? 'page' : null
        expect(
          findButton(otherLabel)!.getAttribute('aria-current'),
          `activePage=${page} / 按钮=${otherLabel}`,
        ).toBe(expected)
      }
    }
  })

  it('点击全部导航后：旧侧栏视图 DOM 零残留（搜索框/附件钩子/回收站钩子/最近标签）', async () => {
    await render({ tree: tree([DOC_A]) })
    for (const label of ['知识库', '搜索', '模块', '资料', '回收站']) {
      await click(findButton(label), label)
    }
    expect(container.querySelector('#ke-global-search'), '旧搜索框残留').toBeNull()
    expect(container.querySelector('[data-testid="attachments-toggle"]'), '旧附件表头残留').toBeNull()
    expect(container.querySelector('[data-testid="orphans-block"]'), '旧孤儿区块残留').toBeNull()
    expect(container.querySelector('[data-attachment]'), '旧附件行残留').toBeNull()
    expect(container.querySelector('[data-trash-id]'), '旧回收站行残留').toBeNull()
    for (const text of ['暂无附件', '暂无标签', '暂无模块', '暂无最近文档', '重建全文索引', '最近更新']) {
      expect(container.textContent, `旧视图文案残留：${text}`).not.toContain(text)
    }
    // 文件树始终固定存在
    expect(container.textContent).toContain('文档A')
    expect(fileLabel()).toBeTruthy()
  })

  it('导航容器语义：nav[aria-label=主导航] 内恰好 5 个原生 button', async () => {
    await render()
    const nav = container.querySelector('nav[aria-label="主导航"]')
    expect(nav).toBeTruthy()
    const btns = Array.from(nav!.querySelectorAll('button'))
    expect(btns).toHaveLength(5)
    for (const b of btns) {
      expect(b.tagName).toBe('BUTTON')
      expect(b.getAttribute('type')).toBe('button')
    }
  })
})

// ============================================================================
// V2 固定文件树：数据 / 样式契约
// ============================================================================
describe('V2 固定文件树契约', () => {
  it('数据契约：文档行 title=relPath、点击 onOpenArticle；文件夹行 div.group + 计数；文件夹计数=子树文档数', async () => {
    await render({ tree: tree([DOC_A, DOC_B, 'Articles/另一个.md']) })
    expect(docRow(DOC_A), '文档行丢失').toBeTruthy()
    const folder = folderRow('子目录')
    expect(folder, '文件夹行丢失').toBeTruthy()
    expect(folder!.textContent).toContain('1')

    await click(docRow(DOC_A), '文档行')
    expect(openSpy).toHaveBeenLastCalledWith(DOC_A)
  })

  it('样式契约（参考稿 .fb-tree .tree-row）：行高 30px / 字号 12.5px / 单级缩进 14px', async () => {
    await render({ tree: tree([DOC_B]) })
    const folder = folderRow('子目录')!
    await click(folder, '展开文件夹')
    const doc = docRow(DOC_B)!
    expect(folder.className, '文件夹行高').toContain('h-[30px]')
    expect(folder.className, '文件夹字号').toContain('text-[12.5px]')
    expect(folder.style.paddingLeft, '顶层缩进 10px').toBe('10px')
    expect(doc.className, '文档行高').toContain('h-[30px]')
    expect(doc.className, '文档字号').toContain('text-[12.5px]')
    expect(doc.style.paddingLeft, '二级缩进 24px').toBe('24px')
  })

  it('文件名不省略：名称节点 whitespace-nowrap 且不得有 truncate/text-overflow:ellipsis 类', async () => {
    const longName = '极长文件名'.repeat(12)
    const rel = `Articles/${longName}.md`
    await render({ tree: tree([rel]) })
    const row = docRow(rel)!
    const nameEl = Array.from(row.querySelectorAll<HTMLElement>('span')).find(
      (s) => (s.textContent ?? '').trim() === `${longName}.md`,
    )
    expect(nameEl, '文件名节点丢失').toBeTruthy()
    expect(nameEl!.className, '文件名必须不省略（nowrap）').toContain('whitespace-nowrap')
    expect(nameEl!.className, '文件名不得使用 truncate').not.toContain('truncate')
    expect(row.className, '行不得使用 truncate').not.toContain('truncate')
  })

  it('文件夹展开/收起：子文档 DOM 出现/消失，且不触发 onOpenArticle', async () => {
    await render({ tree: tree([DOC_B]) })
    expect(docRow(DOC_B), '默认应收起子目录').toBeNull()
    await click(folderRow('子目录'), '文件夹行')
    expect(docRow(DOC_B), '展开后子文档丢失').toBeTruthy()
    expect(openSpy, '展开文件夹不应打开文档').not.toHaveBeenCalled()
    await click(folderRow('子目录'), '文件夹行')
    expect(docRow(DOC_B), '收起后子文档仍存在').toBeNull()
  })

  it('加载失败 → 可见错误 + 重试成功；空树 → 「暂无文章」', async () => {
    vi.mocked(api.getTree).mockRejectedValueOnce(new Error('boom'))
    await render()
    expect(container.textContent).toContain('加载失败，请重试')
    await click(findButton('重试'), '重试按钮')
    expect(container.textContent).toContain('暂无文章')
  })

  it('refreshKey 变化 → 重新拉取文件树（外部文件系统变更联动）', async () => {
    await render({ tree: tree([DOC_A]), refreshKey: 0 })
    const first = vi.mocked(api.getTree).mock.calls.length
    await act(async () => {
      root!.render(
        <LeftSidebar
          activeId={null}
          onOpenArticle={openSpy}
          refreshKey={1}
          onNavigate={navSpy}
          onFsMutation={fsSpy}
        />,
      )
    })
    await settle()
    expect(vi.mocked(api.getTree).mock.calls.length).toBeGreaterThan(first)
  })
})

// ============================================================================
// V3 文件操作全链路（保留行为）：新建 / 重命名 / 移动 / 删除 + onFsMutation + 刷新
// ============================================================================
describe('V3 文件操作全链路', () => {
  it('新建文档（文件区 + 按钮）：prompt → createDocIn(Articles, 标题) → onFsMutation(create) → 刷新树', async () => {
    await render()
    promptMocks.askPrompt.mockResolvedValue('新文档一')
    const treeCallsBefore = vi.mocked(api.getTree).mock.calls.length
    await click(container.querySelector<HTMLElement>('button[aria-label="新建文档"]'), '文件区新建文档按钮')
    expect(promptMocks.askPrompt).toHaveBeenCalledWith('文档标题')
    expect(vi.mocked(api.createDocIn)).toHaveBeenCalledWith('Articles', '新文档一')
    expect(fsSpy).toHaveBeenCalledWith({ type: 'create' })
    expect(vi.mocked(api.getTree).mock.calls.length).toBeGreaterThan(treeCallsBefore)
  })

  it('新建文档取消（prompt 返回 null）→ 不写、不刷新', async () => {
    await render()
    const before = vi.mocked(api.getTree).mock.calls.length
    await click(container.querySelector<HTMLElement>('button[aria-label="新建文档"]'), '新建文档按钮')
    assertNoWrites()
    expect(vi.mocked(api.getTree).mock.calls.length).toBe(before)
  })

  it('新建文件夹（文件区 + 按钮）：prompt → createFolder(Articles/名称)', async () => {
    await render()
    promptMocks.askPrompt.mockResolvedValue('归档')
    await click(container.querySelector<HTMLElement>('button[aria-label="新建文件夹"]'), '文件区新建文件夹按钮')
    expect(vi.mocked(api.createFolder)).toHaveBeenCalledWith('Articles/归档')
    expect(fsSpy).toHaveBeenCalledWith({ type: 'create' })
  })

  it('文件夹内联 + 新建文档：createDocIn(该文件夹路径, 标题)', async () => {
    await render({ tree: tree([DOC_B]) })
    await click(folderRow('子目录'), '展开文件夹')
    promptMocks.askPrompt.mockResolvedValue('新子文档')
    await click(container.querySelector<HTMLElement>('button[aria-label="在「子目录」下新建文档"]'), '文件夹内联新建文档')
    expect(vi.mocked(api.createDocIn)).toHaveBeenCalledWith(FOLDER, '新子文档')
  })

  it('重命名：右键 → 重命名 → askPrompt(新名称, 当前名) → renameDoc + onFsMutation(rename)', async () => {
    await render({ tree: tree([DOC_A]) })
    promptMocks.askPrompt.mockResolvedValue('文档A-新.md')
    await openContextMenu(docRow(DOC_A), '文档行')
    await click(findButton('重命名'), '右键菜单重命名')
    expect(promptMocks.askPrompt).toHaveBeenCalledWith('新名称', '文档A.md')
    expect(vi.mocked(api.renameDoc)).toHaveBeenCalledWith(DOC_A, '文档A-新.md')
    expect(fsSpy).toHaveBeenCalledWith({ type: 'rename', from: DOC_A, to: 'Articles/文档A-新.md' })
  })

  it('移动到…：askPrompt 目录 → movePath(from, 目标/名称)', async () => {
    await render({ tree: tree([DOC_A]) })
    promptMocks.askPrompt.mockResolvedValue('Articles/归档')
    await openContextMenu(docRow(DOC_A), '文档行')
    await click(findButton('移动到…'), '右键菜单移动到')
    expect(vi.mocked(api.movePath)).toHaveBeenCalledWith(DOC_A, 'Articles/归档/文档A.md')
    expect(fsSpy).toHaveBeenCalledWith({
      type: 'move',
      from: DOC_A,
      to: 'Articles/归档/文档A.md',
    })
  })

  it('删除文档：确认 → deleteArticle + onFsMutation(delete)；取消 → 零写', async () => {
    await render({ tree: tree([DOC_A]) })
    await openContextMenu(docRow(DOC_A), '文档行')
    promptMocks.askConfirm.mockResolvedValueOnce(false)
    await click(findButton('删除…'), '右键菜单删除')
    assertNoWrites()

    await openContextMenu(docRow(DOC_A), '文档行')
    await click(findButton('删除…'), '右键菜单删除')
    expect(vi.mocked(api.deleteArticle)).toHaveBeenCalledWith(DOC_A)
    expect(fsSpy).toHaveBeenCalledWith({ type: 'delete', from: DOC_A })
  })

  it('删除文件夹：二次确认通过 → deleteFolder + onFsMutation(delete)', async () => {
    await render({ tree: tree([DOC_B]) })
    await openContextMenu(folderRow('子目录'), '文件夹行')
    await click(findButton('删除…'), '右键菜单删除')
    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.deleteFolder)).toHaveBeenCalledWith(FOLDER)
    expect(fsSpy).toHaveBeenCalledWith({ type: 'delete', from: FOLDER })
  })
})

// ============================================================================
// V4 onBeforeFsMutation 否决权（R1-B：先 flush 未决保存，否决则中止）
// ============================================================================
describe('V4 onBeforeFsMutation 否决权', () => {
  for (const [name, openMenu, promptValue] of [
    ['重命名', '重命名', '文档A-新.md'],
    ['移动到…', '移动到…', 'Articles/归档'],
    ['删除…', '删除…', null],
  ] as const) {
    it(`${name}：onBeforeFsMutation 返回 false → 不调用写 API`, async () => {
      const veto = vi.fn(async () => false)
      await render({ tree: tree([DOC_A]), onBeforeFsMutation: veto })
      if (promptValue) promptMocks.askPrompt.mockResolvedValue(promptValue)
      await openContextMenu(docRow(DOC_A), '文档行')
      await click(findButton(openMenu), `右键菜单 ${openMenu}`)
      expect(veto, 'onBeforeFsMutation 未被调用').toHaveBeenCalledTimes(1)
      assertNoWrites()
    })
  }
})

// ============================================================================
// V5 只读不变量
// ============================================================================
describe('V5 只读不变量（挂载/导航/展开/右键全流程）', () => {
  it('只读交互零写请求 + 零裸 fetch + 无 alert', async () => {
    await render({ tree: tree([DOC_A, DOC_B]) })
    assertNoWrites()

    for (const label of ['知识库', '搜索', '模块', '资料', '回收站']) {
      await click(findButton(label), label)
    }
    await click(folderRow('子目录'), '展开文件夹')
    await click(docRow(DOC_A), '打开文档')
    await click(folderRow('子目录'), '收起文件夹')

    // 打开右键菜单（只读）后关闭
    await openContextMenu(docRow(DOC_A), '文档行')
    expect(findButton('重命名'), '右键菜单未渲染').toBeTruthy()
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    assertNoWrites()
    expect(alertSpy, '只读交互不应弹 alert').not.toHaveBeenCalled()
    expect(openSpy).toHaveBeenCalledWith(DOC_A)
  })
})

// ============================================================================
// V6 footer / 收起 / 主题
// ============================================================================
describe('V6 footer 三段与壳层控件', () => {
  it('footer 三个原生 button：设置/专注模式/切换外观 → 各自回调 + aria-label', async () => {
    const onOpenSettings = vi.fn()
    const onToggleFocusMode = vi.fn()
    const onToggleTheme = vi.fn()
    await render({ onOpenSettings, onToggleFocusMode, onToggleTheme })
    await click(findButton('设置'), 'footer 设置')
    await click(findButton('专注模式'), 'footer 专注模式')
    await click(findButton('切换外观'), 'footer 切换外观')
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1)
    expect(onToggleTheme).toHaveBeenCalledTimes(1)
    expect(findButton('设置')!.getAttribute('aria-label')).toBe('打开设置')
    expect(findButton('切换外观')!.getAttribute('aria-label')).toBe('切换外观')
    expect(findButton('切换外观')!.querySelector('[data-appearance-icon="moon"]')).toBeTruthy()
    for (const label of ['设置', '专注模式', '切换外观']) {
      expect(findButton(label)!.tagName, `${label} 不是原生 button`).toBe('BUTTON')
    }
  })

  it('themeIsDark 时外观图标为 sun（深色模式）', async () => {
    await render({ themeIsDark: true })
    expect(findButton('切换外观')!.querySelector('[data-appearance-icon="sun"]')).toBeTruthy()
  })

  it('收起文件侧栏按钮：aria-label + onCollapse 回调；无回调时不渲染', async () => {
    const onCollapse = vi.fn()
    await render({ onCollapse })
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="收起文件侧栏"]')
    expect(btn).toBeTruthy()
    await click(btn, '收起侧栏')
    expect(onCollapse).toHaveBeenCalledTimes(1)

    await act(async () => {
      root!.unmount()
    })
    root = createRoot(container)
    await act(async () => {
      root!.render(<LeftSidebar activeId={null} onOpenArticle={openSpy} />)
    })
    await settle()
    expect(container.querySelector('button[aria-label="收起文件侧栏"]')).toBeNull()
  })

  it('工作区头：目录名 + 「本地工作区」副标题', async () => {
    await render()
    expect(container.textContent).toContain('ws')
    expect(container.textContent).toContain('本地工作区')
  })
})
