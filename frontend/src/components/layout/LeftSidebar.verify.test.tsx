/**
 * LeftSidebar「附件能力迁左栏」独立对抗验证套件（task-14 / verifier-attach）
 *
 * 背景：主理人裁决「『附件』应该在左侧查看啊（那里本来就有一列附件的 UI），不应该在文档属性里」。
 * task-12 把附件能力从右栏迁到左栏「附件」区。本套件由 verifier **独立推导**攻击面，不复述验收条目：
 *
 *   ① 数据源真迁移：渲染**不得再依赖 `tree.attachments`**（构造 tree.attachments 全空 + API 有数据的替身）
 *   ② 迁移信息量不缩水：名称 / 大小 / 已引用-未引用徽章 / 全部 referenced_by / 全路径 / 修改时间 / 孤儿删除
 *   ③ 「全部引用」：3 篇文档引用同一附件 → 3 条全列出、逐条可跳转、点行本身不误跳
 *   ④ 收起两态（task-11 语义沿用）：收起态零行/零详情/零孤儿 DOM，但计数与孤儿徽章可见
 *   ⑤ 不变量：只读流程零写请求（27 写函数替身 + 裸 fetch 绊线）；`<a href={attachmentUrl}>` 打开能力仍在
 *   ⑥ 边界：0 附件 / 空 referenced_by / 50 条不截断 / 超长名 / refreshKey 重载 / 删除孤儿后刷新
 *
 * 写入边界（task-14）：不得修改任何源码；本文件与 RightPanel.verify.test.tsx、
 * docs/verification-relocate.md 为 verifier 产物。
 *
 * 脚手架范式沿用 src/state/memoTree.test.tsx（createRoot + act + IS_REACT_ACT_ENVIRONMENT）
 * 与既有 LeftSidebar.test.tsx（vi.mock api/client、PromptDialog）。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import LeftSidebar from './LeftSidebar'
import * as api from '../../api/client'
import type { AttachmentItem, OrphanItem, TreePayload } from '../../types'

// ---------- 模块替身（api/client 全量，避免新实现引用到未替身导出而崩） ----------
vi.mock('../../api/client', () => ({
  apiBase: () => '/api',
  attachmentUrl: (rel: string) => `/api/attachments/${rel}`,
  getHealth: vi.fn(),
  getTree: vi.fn(),
  getArticle: vi.fn(),
  createArticle: vi.fn(),
  saveArticle: vi.fn(),
  search: vi.fn(),
  deleteArticle: vi.fn(),
  getWorkspaceCurrent: vi.fn(),
  createWorkspace: vi.fn(),
  openWorkspace: vi.fn(),
  closeWorkspace: vi.fn(),
  getRecentWorkspaces: vi.fn(),
  getRecentDocuments: vi.fn(),
  recordRecentDocument: vi.fn(),
  clearRecentDocuments: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  createDocIn: vi.fn(),
  renameDoc: vi.fn(),
  movePath: vi.fn(),
  getFsEvents: vi.fn(),
  getTags: vi.fn(),
  getFilesByTag: vi.fn(),
  updateArticleMeta: vi.fn(),
  listAttachments: vi.fn(),
  listOrphans: vi.fn(),
  deleteAttachment: vi.fn(),
  uploadAttachment: vi.fn(),
  listModules: vi.fn(),
  getModule: vi.fn(),
  exportPackage: vi.fn(),
  importMarkdown: vi.fn(),
  importPackage: vi.fn(),
  rebuildIndex: vi.fn(),
  listHistory: vi.fn(),
  previewHistory: vi.fn(),
  restoreHistory: vi.fn(),
  listRecovery: vi.fn(),
  registerRecovery: vi.fn(),
  discardRecovery: vi.fn(),
  restoreRecovery: vi.fn(),
  listTrash: vi.fn(),
  restoreTrash: vi.fn(),
  purgeTrash: vi.fn(),
  clearTrash: vi.fn(),
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
  'createArticle',
  'saveArticle',
  'deleteArticle',
  'createWorkspace',
  'openWorkspace',
  'closeWorkspace',
  'recordRecentDocument',
  'clearRecentDocuments',
  'createFolder',
  'renameFolder',
  'deleteFolder',
  'createDocIn',
  'renameDoc',
  'movePath',
  'updateArticleMeta',
  'deleteAttachment',
  'uploadAttachment',
  'importMarkdown',
  'importPackage',
  'rebuildIndex',
  'restoreHistory',
  'registerRecovery',
  'discardRecovery',
  'restoreRecovery',
  'restoreTrash',
  'purgeTrash',
  'clearTrash',
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
const DOC_C = 'Articles/文档C.md'

const SHARED = 'Attachments/images/共享图.png'
const LONE = 'Attachments/files/孤立资料.pdf'
const ORPHAN = 'Attachments/files/孤儿报告.pdf'

function mkAttachment(over: Partial<AttachmentItem> & { rel_path: string }): AttachmentItem {
  return {
    name: over.rel_path.split('/').pop() ?? over.rel_path,
    category: over.rel_path.includes('/images/') ? 'images' : over.rel_path.includes('/videos/') ? 'videos' : 'files',
    size: 2048,
    mtime: '2026-09-15T10:00:00+08:00',
    referenced_by: [],
    ...over,
  }
}

const SHARED_3REFS = mkAttachment({ rel_path: SHARED, size: 4096, referenced_by: [DOC_A, DOC_B, DOC_C] })
const LONE_ITEM = mkAttachment({ rel_path: LONE, size: 3072, referenced_by: [] })
const ORPHAN_ITEM: OrphanItem = {
  name: '孤儿报告.pdf',
  path: ORPHAN,
  size: 1024,
  mtime: '2026-09-14T08:30:00+08:00',
}

/** tree.attachments 恒为空 —— 用于证明附件区渲染已不依赖文件树 */
function emptyTree(articles: string[] = ['Articles/文档A.md']): TreePayload {
  return { root: '/ws', articles, modules: [], attachments: { images: [], videos: [], files: [] } }
}

// ---------- 渲染脚手架 ----------
let root: Root | null = null
let container: HTMLDivElement
let openSpy: ReturnType<typeof vi.fn<(id: string) => void>>
let alertSpy: AnyMock

interface RenderOpts {
  attachments?: AttachmentItem[]
  orphans?: OrphanItem[]
  tree?: TreePayload
  refreshKey?: number
}

async function render(opts: RenderOpts = {}): Promise<void> {
  mockData(opts)
  openSpy = vi.fn<(id: string) => void>()
  const onOpenArticle = (id: string): void => {
    openSpy(id)
  }
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <LeftSidebar activeId={null} onOpenArticle={onOpenArticle} refreshKey={opts.refreshKey ?? 0} workspaceRoot="/ws" />,
    )
  })
  await settle()
  await settle()
}

async function update(opts: RenderOpts = {}): Promise<void> {
  mockData(opts)
  const onOpenArticle = (id: string): void => {
    openSpy(id)
  }
  await act(async () => {
    root!.render(
      <LeftSidebar activeId={null} onOpenArticle={onOpenArticle} refreshKey={opts.refreshKey ?? 0} workspaceRoot="/ws" />,
    )
  })
  await settle()
  await settle()
}

function mockData(opts: RenderOpts): void {
  vi.mocked(api.getTree).mockResolvedValue(opts.tree ?? emptyTree())
  vi.mocked(api.listAttachments).mockResolvedValue({
    count: (opts.attachments ?? []).length,
    attachments: opts.attachments ?? [],
  })
  vi.mocked(api.listOrphans).mockResolvedValue({
    count: (opts.orphans ?? []).length,
    orphans: opts.orphans ?? [],
  })
  vi.mocked(api.deleteAttachment).mockResolvedValue({ deleted: 'ok' })
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function text(): string {
  return container.textContent ?? ''
}

function clickables(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('button, a, [role="button"], [role="link"], [aria-expanded]'),
  )
}

/** 文本最短匹配 = 最内层可点击元素（避免误取包住整块的外层容器） */
function findClickable(needle: string): HTMLElement | undefined {
  return clickables()
    .filter((el) => (el.textContent ?? '').includes(needle))
    .sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0]
}

/** 附件小节表头（含「附件」字样的最内层可点击元素） */
function header(): HTMLElement | undefined {
  return findClickable('附件')
}

function headerText(): string {
  return (header()?.textContent ?? '').replace(/\s+/g, '')
}

/**
 * 表头刷新/添加按钮：允许实现自由命名，只要求表头区域内有一个带「刷新/添加」语义的按钮。
 * 注意：不能只看折叠开关的直接父节点 —— 实测表头结构为
 * `<headerRow><leftGroup><toggle/></leftGroup><refresh/></headerRow>`，
 * 刷新按钮比 toggle 高一层；故从内向外逐层查找，命中即返回（避免误匹配更外层其它刷新按钮）。
 */
function headerAction(): HTMLElement | undefined {
  let el: HTMLElement | null | undefined = header()?.parentElement
  for (let depth = 0; depth < 3 && el; depth++) {
    const found = Array.from(el.querySelectorAll<HTMLElement>('button')).find((b) => {
      if (b === header()) return false
      const label = `${b.getAttribute('aria-label') ?? ''}${b.getAttribute('title') ?? ''}`
      return /刷新|添加/.test(label)
    })
    if (found) return found
    el = el.parentElement
  }
  return undefined
}

/** 孤儿信号判据：文案含「孤儿」/ 警示符 / 琥珀-警示样式 / data-aria 标记（不锁实现） */
function hasOrphanSignal(head: HTMLElement | undefined): boolean {
  if (!head) return false
  const t = head.textContent ?? ''
  if (t.includes('孤儿') || /[⚠!]/.test(t)) return true
  return !!head.querySelector(
    '[class*="amber"],[class*="warning"],[class*="rose"],[class*="alert"],[data-orphan],[aria-label*="孤儿"]',
  )
}

/**
 * 表头**行**作用域（toggle 与刷新按钮的最近共同祖先）。
 * 实测：孤儿徽章是折叠按钮的**兄弟节点**（同属表头行），不在按钮内部，
 * 故信号判据必须覆盖整行，否则会误判「收起态信号丢失」。
 */
function headerRow(): HTMLElement | undefined {
  const toggle = header()
  const refresh = headerAction()
  if (!toggle) return undefined
  if (!refresh) return toggle.parentElement ?? undefined
  const chain = (n: HTMLElement | null): HTMLElement[] => {
    const out: HTMLElement[] = []
    let cur: HTMLElement | null = n
    while (cur) {
      out.push(cur)
      cur = cur.parentElement
    }
    return out
  }
  const refreshChain = new Set(chain(refresh))
  return chain(toggle).find((n) => refreshChain.has(n))
}

/** 表头行内的孤儿信号（收起态必须可见） */
function hasHeaderOrphanSignal(): boolean {
  return hasOrphanSignal(headerRow())
}

/**
 * 孤儿区块（展开态）作用域判定。
 * ⚠️ 不能用「文本含孤儿附件」做退化判据 —— 收起态表头徽章文案本身就是「孤儿附件 N」，
 * 会与徽章所在的表头容器混淆（本轮验证已踩过一次）。故判据 = data-testid 或「含删除按钮的容器」。
 */
function orphanScope(): HTMLElement | undefined {
  const byTestId = container.querySelector<HTMLElement>('[data-testid="orphans-block"]')
  if (byTestId) return byTestId
  const del = Array.from(container.querySelectorAll<HTMLElement>('button'))
    .filter((b) => (b.textContent ?? '').includes('删除'))
    .sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0]
  return del?.closest('div') ?? undefined
}

function findIn(scope: HTMLElement | undefined, needle: string): HTMLElement | undefined {
  if (!scope) return undefined
  return Array.from(scope.querySelectorAll<HTMLElement>('button, a'))
    .filter((el) => (el.textContent ?? '').includes(needle))
    .sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0]
}

async function click(el: HTMLElement | undefined, label = '元素'): Promise<void> {
  expect(el, `未找到可点击元素：${label}`).toBeTruthy()
  await act(async () => {
    el!.click()
  })
  await settle()
}

async function clickReferral(rel: string): Promise<void> {
  let link = findClickable(rel)
  if (!link) {
    await click(header(), '附件表头（展开）')
    link = findClickable(rel)
  }
  await click(link, `引用条目 ${rel}`)
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
  vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: [] })
  vi.mocked(api.getTags).mockResolvedValue({ tags: [] })
  vi.mocked(api.listModules).mockResolvedValue({ count: 0, modules: [] })
  vi.mocked(api.listTrash).mockResolvedValue({ count: 0, items: [] })
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
// L-1 数据源真迁移 + 默认态
// ============================================================================
describe('L-1 数据源迁移与默认态', () => {
  it('tree.attachments 全空但 /api/attachments/list 有数据 → 附件仍渲染（不依赖文件树）', async () => {
    await render({ tree: emptyTree(), attachments: [SHARED_3REFS, LONE_ITEM] })

    expect(vi.mocked(api.listAttachments).mock.calls.length, '未调用 attachments API').toBeGreaterThanOrEqual(1)
    expect(findClickable('共享图.png'), '附件区仍依赖 tree.attachments（API 数据未渲染）').toBeTruthy()
    expect(findClickable('孤立资料.pdf')).toBeTruthy()
  })

  it('默认展开：无需任何点击即可看到附件行与计数', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM] })

    expect(header(), '附件表头应为可点击折叠开关').toBeTruthy()
    expect(headerText(), '表头应显示计数 2').toMatch(/附件[^0-9]{0,3}2/)
    expect(findClickable('共享图.png'), '默认未展开（task-12 要求默认展开）').toBeTruthy()
  })

  it('表头带刷新/添加按钮（action 位保留）', async () => {
    await render({ attachments: [SHARED_3REFS] })

    expect(headerAction(), '表头刷新按钮丢失').toBeTruthy()
  })

  it('0 附件：展开态显示「暂无附件」空态', async () => {
    await render({ attachments: [] })

    expect(headerText()).toMatch(/附件[^0-9]{0,3}0/)
    expect(text(), '空态文案丢失').toContain('暂无附件')
  })
})

// ============================================================================
// L-2 详情正确性 + 迁移信息量不缩水
// ============================================================================
describe('L-2 详情：全部引用 / 信息量 / 跳转', () => {
  it('迁移信息量不缩水：名称 / 大小 / 已引用徽章 / 全路径 / 修改时间 逐项可见', async () => {
    await render({ attachments: [SHARED_3REFS] })

    expect(text(), '名称丢失').toContain('共享图.png')
    expect(text(), '大小丢失').toMatch(/4\.0\s*KB/)
    expect(text(), '已引用徽章丢失').toContain('已引用')

    await click(findClickable('共享图.png'), '附件行 共享图')
    expect(text(), '详情缺全路径 rel_path').toContain(SHARED)
    expect(text(), '详情缺修改时间').toMatch(/2026/)
  })

  it('3 篇文档引用同一附件 → 详情必须列出全部 3 条（不是只列 [0]）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await click(findClickable('共享图.png'), '附件行 共享图')

    const body = text()
    expect(body, `缺少 ${DOC_A}`).toContain(DOC_A)
    expect(body, `缺少 ${DOC_B}`).toContain(DOC_B)
    expect(body, `缺少 ${DOC_C}`).toContain(DOC_C)
    expect(body).toMatch(/(篇|条|处|个)/)
  })

  it('详情内每条引用可跳转（onOpenArticle 收到正确 docRel，恰好 3 次）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await click(findClickable('共享图.png'), '附件行 共享图')

    await clickReferral(DOC_A)
    await clickReferral(DOC_B)
    await clickReferral(DOC_C)

    const args = openSpy.mock.calls.map((c) => c[0])
    expect(args).toContain(DOC_A)
    expect(args).toContain(DOC_B)
    expect(args).toContain(DOC_C)
    expect(openSpy).toHaveBeenCalledTimes(3)
  })

  it('点附件行本身 = 就地展开，不得直接把用户跳走', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await click(findClickable('共享图.png'), '附件行 共享图')

    expect(openSpy, '点击附件行不应触发跳转').not.toHaveBeenCalled()
  })

  it('未引用附件：显示「未被…引用」+ 全路径 + 大小 + 修改时间', async () => {
    await render({ attachments: [LONE_ITEM] })
    await click(findClickable('孤立资料.pdf'), '附件行 孤立资料')

    const body = text()
    expect(body).toMatch(/未被(任何文档)?引用/)
    expect(body, '已引用/未引用徽章丢失').toContain('未引用')
    expect(body).toContain(LONE)
    expect(body).toMatch(/3\.0\s*KB/)
    expect(body).toMatch(/2026/)
  })

  it('同行两击 = 展开再收起（详情消失，列表不塌）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await click(findClickable('共享图.png'), '附件行 展开')
    expect(text()).toContain(DOC_B)

    await click(findClickable('共享图.png'), '附件行 收起')
    expect(text(), '同点两次应收起详情').not.toContain(DOC_B)
    expect(findClickable('共享图.png'), '收起详情不应连带收起整个列表').toBeTruthy()
  })

  it('点不同行 = 切换详情，上一个展开态不残留', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM] })
    await click(findClickable('共享图.png'), '附件行 共享图')
    expect(text()).toContain(DOC_C)

    await click(findClickable('孤立资料.pdf'), '附件行 孤立资料')
    expect(text(), '切换行后上一附件详情仍在').not.toContain(DOC_C)
    expect(text()).toMatch(/未被(任何文档)?引用/)
  })

  it('50 条引用不得被截断（防隐性上限）', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `Articles/引用-${String(i).padStart(2, '0')}.md`)
    await render({ attachments: [mkAttachment({ rel_path: 'Attachments/images/热门图.png', referenced_by: many })] })
    await click(findClickable('热门图.png'), '附件行 热门图')

    const shown = clickables().filter((el) => /Articles\/引用-\d\d\.md/.test(el.textContent ?? ''))
    expect(shown.length, '引用条目被截断（应全部列出 50 条）').toBe(50)
    expect(text()).toContain('Articles/引用-49.md')
  })
})

// ============================================================================
// L-3 收起两态
// ============================================================================
describe('L-3 收起两态（收起 = 只剩表头一行）', () => {
  it('收起态：零行 / 零详情 / 零孤儿 DOM，但计数与孤儿徽章可见', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })

    await click(header(), '附件表头（收起）')

    expect(findClickable('共享图.png'), '收起态仍渲染附件行').toBeUndefined()
    expect(findClickable('孤立资料.pdf')).toBeUndefined()
    expect(findClickable(DOC_A), '收起态仍渲染引用详情').toBeUndefined()
    expect(findClickable('删除'), '收起态仍渲染孤儿删除入口').toBeUndefined()
    expect(orphanScope(), '收起态仍渲染孤儿区块 DOM').toBeUndefined()
    expect(headerText(), '收起态计数必须可见').toMatch(/附件[^0-9]{0,3}2/)
    expect(hasHeaderOrphanSignal(), '收起态孤儿信号丢失').toBe(true)
  })

  it('展开态：行 / 孤儿区块 / 删除按钮 / 底部说明 全部回来', async () => {
    await render({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })
    await click(header(), '附件表头（收起）')
    await click(header(), '附件表头（再展开）')

    expect(findClickable('共享图.png')).toBeTruthy()
    expect(orphanScope(), '展开态孤儿区块丢失').toBeTruthy()
    expect(findIn(orphanScope(), '删除'), '展开态孤儿删除按钮丢失').toBeTruthy()
    expect(text()).toContain('孤儿附件')
  })

  it('无孤儿时收起态表头不出现孤儿噪声', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await click(header(), '附件表头（收起）')

    expect(hasHeaderOrphanSignal(), '无孤儿却出现孤儿提示').toBe(false)
  })
})

// ============================================================================
// L-4 「打开文件」能力 + DOM 合法性
// ============================================================================
describe('L-4 打开能力与 DOM 合法性', () => {
  it('每个附件保留独立 <a href={attachmentUrl(rel)}> 且 target=_blank / rel=noreferrer', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM] })

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/attachments/"]'))
    expect(links.length, '附件打开链接数量应等于附件行数').toBe(2)
    const hrefs = links.map((a) => a.getAttribute('href'))
    expect(hrefs).toContain(`/api/attachments/${SHARED}`)
    expect(hrefs).toContain(`/api/attachments/${LONE}`)
    for (const a of links) {
      expect(a.getAttribute('target'), `${a.getAttribute('href')} 缺 target=_blank`).toBe('_blank')
      expect(a.getAttribute('rel'), `${a.getAttribute('href')} 缺 rel=noreferrer`).toBe('noreferrer')
    }
  })

  it('DOM 合法性：无 button 嵌套 button/a、无 a 嵌套 button', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })
    await click(findClickable('共享图.png'), '附件行 共享图')

    expect(container.querySelectorAll('button button').length, 'button 嵌套 button').toBe(0)
    expect(container.querySelectorAll('button a').length, 'button 嵌套 a').toBe(0)
    expect(container.querySelectorAll('a button').length, 'a 嵌套 button').toBe(0)
  })
})

// ============================================================================
// L-5 孤儿删除
// ============================================================================
describe('L-5 孤儿删除（显式写路径 + 刷新）', () => {
  it('确认删除 → deleteAttachment(路径) 被调用且列表刷新', async () => {
    await render({ attachments: [], orphans: [ORPHAN_ITEM] })
    promptMocks.askConfirm.mockResolvedValue(true)
    const beforeCalls = vi.mocked(api.listAttachments).mock.calls.length

    await click(findIn(orphanScope(), '删除'), '孤儿删除按钮')

    expect(vi.mocked(api.deleteAttachment)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteAttachment).mock.calls[0][0]).toBe(ORPHAN)
    await settle()
    expect(
      vi.mocked(api.listAttachments).mock.calls.length,
      '删除成功后未刷新附件列表',
    ).toBeGreaterThan(beforeCalls)
  })

  it('取消删除 → 不得发起 deleteAttachment，且全程零写请求', async () => {
    await render({ attachments: [], orphans: [ORPHAN_ITEM] })
    promptMocks.askConfirm.mockResolvedValue(false)

    await click(findIn(orphanScope(), '删除'), '孤儿删除按钮')

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteAttachment)).not.toHaveBeenCalled()
    assertNoWrites()
  })
})

// ============================================================================
// L-6 只读不变量
// ============================================================================
describe('L-6 只读不变量（展开/详情/跳转/收起全流程零写）', () => {
  it('只读流程零写请求 + 零裸 fetch + 无 alert', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })

    await click(findClickable('共享图.png'), '附件行 共享图') // 展开详情
    await clickReferral(DOC_A) // 跳转
    await clickReferral(DOC_B)
    await click(findClickable('孤立资料.pdf'), '附件行 孤立资料') // 切换
    await click(header(), '附件表头（收起）')
    await click(header(), '附件表头（再展开）')

    assertNoWrites()
    expect(alertSpy, '只读展示不应弹 alert').not.toHaveBeenCalled()
  })

  it('展开/收起/点行详情不重复拉取列表（纯前端状态）', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })
    const afterMount = vi.mocked(api.listAttachments).mock.calls.length

    await click(findClickable('共享图.png'), '附件行 共享图')
    await click(header(), '附件表头（收起）')
    await click(header(), '附件表头（再展开）')

    expect(
      vi.mocked(api.listAttachments).mock.calls.length,
      '展开/收起/详情是纯前端状态，不应额外请求 listAttachments',
    ).toBe(afterMount)
  })
})

// ============================================================================
// L-7 边界
// ============================================================================
describe('L-7 边界', () => {
  it('referenced_by 为空数组：按未引用处理（显示未引用 + 不跳转）', async () => {
    await render({ attachments: [mkAttachment({ rel_path: 'Attachments/images/空引用.png', referenced_by: [] })] })
    await click(findClickable('空引用.png'), '附件行 空引用')

    expect(text()).toMatch(/未被(任何文档)?引用/)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('超长文件名/路径不破版（可渲染 + 行内保留截断样式）', async () => {
    const longName = `${'极长文件名'.repeat(20)}.png`
    const longRel = `Attachments/images/${'深层目录'.repeat(30)}/${longName}`
    await render({ attachments: [mkAttachment({ rel_path: longRel })] })

    const row = findClickable(longName)
    expect(row, '超长文件名条目未能渲染').toBeTruthy()
    const truncated = row!.className.includes('truncate') || !!row!.querySelector('[class*="truncate"]')
    expect(truncated, '超长文件名缺少截断样式（happy-dom 无布局引擎，仅能校验样式类）').toBe(true)
  })

  it('refreshKey 变化 → 重新加载附件列表', async () => {
    await render({ attachments: [SHARED_3REFS] })
    const first = vi.mocked(api.listAttachments).mock.calls.length

    await update({ attachments: [LONE_ITEM], refreshKey: 1 })

    expect(vi.mocked(api.listAttachments).mock.calls.length, 'refreshKey 变化未重载附件').toBeGreaterThan(first)
    expect(findClickable('孤立资料.pdf'), '重载后数据未更新').toBeTruthy()
  })

  it('树里存在附件名但 API 无数据 → 不得从 tree 推断渲染附件（等价性反证）', async () => {
    const treeWithAttachments: TreePayload = {
      ...emptyTree(),
      attachments: { images: ['Attachments/images/树里的图.png'], videos: [], files: [] },
    }
    await render({ tree: treeWithAttachments, attachments: [] })

    expect(findClickable('树里的图.png'), '仍从 tree.attachments 渲染附件（迁移未完成）').toBeUndefined()
    expect(text()).toContain('暂无附件')
  })
})
