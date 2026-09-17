/**
 * LeftSidebar「附件能力迁左栏 + 默认收起」独立对抗验证套件（task-14 / task-24 · verifier-attach）
 *
 * 背景：主理人裁决「『附件』应该在左侧查看」（task-12 迁移），随后裁决**默认收起**
 * （task-22：左栏空间占用偏多）。本套件由 verifier **独立推导**攻击面，不复述验收条目。
 *
 * ⚠ 判据变更留痕（task-24）：原 L2「默认展开」判据已作废，改为「默认收起」；
 *   其余判据（迁移等价性 / 全部 referenced_by / <a> 契约 / 零写请求 + 裸 fetch 绊线 /
 *   无 button 嵌套 / 不依赖 tree.attachments / 反向等价性 / 50 条不截断 / 超长名 /
 *   删除孤儿 / refreshKey / 边界）**一条未删、一条未削弱**，仅补 `openList()` 前置展开。
 *
 * 攻击面覆盖：
 *   ① 默认收起语义：只留表头 + 计数 + 孤儿徽章；无行/无详情/无孤儿块/无底部说明
 *   ② 收起**不得**省掉首次数据请求（计数与徽章依赖数据）
 *   ③ 收起**不得**残留上一轮展开行/详情（展开→收起→数据/文档变化→再展开）
 *   ④ aria-expanded 语义 + 键盘可达性
 *   ⑤ 迁移信息量不缩水、全部引用、<a> href 契约、零写请求、边界
 *
 * 写入边界（task-24）：本文件与 docs/verification-attach-collapse.md 为 verifier 产物；
 * 不得修改任何源码。
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

const FIXTURE_NAMES = ['共享图.png', '孤立资料.pdf', '空引用.png', '热门图.png']

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
  activeId?: string | null
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
      <LeftSidebar
        activeId={opts.activeId ?? null}
        onOpenArticle={onOpenArticle}
        refreshKey={opts.refreshKey ?? 0}
        workspaceRoot="/ws"
      />,
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
      <LeftSidebar
        activeId={opts.activeId ?? null}
        onOpenArticle={onOpenArticle}
        refreshKey={opts.refreshKey ?? 0}
        workspaceRoot="/ws"
      />,
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

/** 卸载重挂（验证展开态不被持久化 / 不留残留 DOM） */
async function remount(opts: RenderOpts = {}): Promise<void> {
  await act(async () => {
    root?.unmount()
  })
  root = null
  await render(opts)
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

/** 当前是否已有附件行渲染（优先 data 钩子，退化到 fixture 名称） */
function rowCount(): number {
  const byHook = container.querySelectorAll('[data-attachment-row]').length
  if (byHook > 0) return byHook
  return FIXTURE_NAMES.filter((n) => !!findClickable(n)).length
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
 * 会与徽章所在的表头容器混淆（上一轮验证已踩过一次）。故判据 = data-testid 或「含删除按钮的容器」。
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

/** 附件小节是否已展开（优先 aria-expanded，退化到「是否已有行」） */
function isExpanded(): boolean {
  const t = header()
  const aria = t?.getAttribute('aria-expanded')
  if (aria === 'true') return true
  if (aria === 'false') return false
  return rowCount() > 0
}

/** 前置展开（幂等）：判据变更后默认收起，需要行的用例先展开 */
async function openList(): Promise<void> {
  if (!isExpanded()) await click(header(), '附件表头（展开）')
}

async function clickRow(name: string): Promise<void> {
  await openList()
  await click(findClickable(name), `附件行 ${name}`)
}

async function clickReferral(rel: string): Promise<void> {
  let link = findClickable(rel)
  if (!link) {
    await openList()
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
// L-1 默认态（task-24 判据变更：默认收起）
// ============================================================================
describe('L-1 默认收起语义', () => {
  it('默认收起：不点击时只留表头（计数可见；行/详情/孤儿块/底部说明均不渲染）', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })

    expect(header(), '附件表头应为可点击折叠开关').toBeTruthy()
    expect(headerText(), '收起态必须显示计数 2').toMatch(/附件[^0-9]{0,3}2/)
    expect(findClickable('共享图.png'), '默认收起时仍渲染附件行').toBeUndefined()
    expect(findClickable('孤立资料.pdf')).toBeUndefined()
    expect(findClickable(DOC_A), '默认收起时仍渲染引用详情').toBeUndefined()
    expect(orphanScope(), '默认收起时仍渲染孤儿区块').toBeUndefined()
    expect(text(), '默认收起时仍渲染底部说明').not.toContain('不随笔记回滚')
    expect(hasHeaderOrphanSignal(), '默认收起时孤儿徽章不可见（信号丢失）').toBe(true)
  })

  it('默认收起**不得**省掉首次数据请求（计数与徽章依赖数据）', async () => {
    await render({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })

    expect(
      vi.mocked(api.listAttachments).mock.calls.length,
      '收起态未请求附件列表 → 计数无从得来',
    ).toBeGreaterThanOrEqual(1)
    expect(
      vi.mocked(api.listOrphans).mock.calls.length,
      '收起态未请求孤儿列表 → 徽章无从得来',
    ).toBeGreaterThanOrEqual(1)
  })

  it('收起态计数与徽章来自真实数据（3 附件 + 1 孤儿）', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM, mkAttachment({ rel_path: 'Attachments/images/第三图.png' })], orphans: [ORPHAN_ITEM] })

    expect(headerText(), '计数与数据不符').toMatch(/附件[^0-9]{0,3}3/)
    expect(hasHeaderOrphanSignal()).toBe(true)
  })

  it('收起态无孤儿时表头不出现孤儿噪声', async () => {
    await render({ attachments: [SHARED_3REFS] })

    expect(hasHeaderOrphanSignal(), '无孤儿却出现孤儿提示').toBe(false)
  })

  it('收起态信号可达：aria-expanded=false 且徽章文本可见，徽章位于折叠按钮内（点徽章即展开）', async () => {
    await render({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })

    const toggle = header()!
    expect(toggle.getAttribute('aria-expanded'), '收起态应为 aria-expanded=false').toBe('false')
    const badge = container.querySelector<HTMLElement>('[data-testid="orphan-badge"]')
    expect(badge, '收起态孤儿徽章 DOM 丢失').toBeTruthy()
    expect(badge!.textContent ?? '', '徽章文本不可见/为空').toMatch(/孤儿附件[^\d]*1/)

    // 「点徽章即展开」的前提是徽章在折叠按钮内（不是兄弟节点）
    expect(toggle.contains(badge!), '徽章不在折叠按钮内 → 点它无法展开（信号不可达）').toBe(true)
    await click(badge!, '孤儿徽章')
    expect(header()!.getAttribute('aria-expanded'), '点徽章未展开').toBe('true')
    expect(rowCount(), '点徽章展开后应渲染附件行').toBeGreaterThan(0)
  })

  it('aria-expanded 语义：默认 false → 点表头 true → 再点 false', async () => {
    await render({ attachments: [SHARED_3REFS] })

    expect(header()?.getAttribute('aria-expanded'), '默认收起应是 aria-expanded=false').toBe('false')
    await click(header(), '附件表头（展开）')
    expect(header()?.getAttribute('aria-expanded'), '展开后 aria-expanded 应为 true').toBe('true')
    await click(header(), '附件表头（收起）')
    expect(header()?.getAttribute('aria-expanded'), '再收起后 aria-expanded 应为 false').toBe('false')
  })

  it('键盘可达性：折叠开关是原生 button 且可聚焦（Enter/Space 由浏览器原生激活）', async () => {
    await render({ attachments: [SHARED_3REFS] })

    const t = header()
    expect(t?.tagName, '折叠开关不是原生 button → 键盘不可达').toBe('BUTTON')
    expect(t?.getAttribute('type')).toBe('button')
    expect((t as HTMLButtonElement).disabled).toBe(false)
    ;(t as HTMLElement).focus()
    expect(document.activeElement, '折叠开关不可聚焦').toBe(t)
    // 真实浏览器中原生 button 收到 Enter/Space 会合成 click；happy-dom 不合成（已实测 PROBE=false），
    // 故此处只断言结构前提 + click 通路（见上一条用例的 aria-expanded 往返），不构造假红。
    t!.click()
    await settle()
    expect(t?.getAttribute('aria-expanded'), 'click 通路（键盘激活的等价效果）应展开').toBe('true')
  })

  it('点表头 → 展开齐全；再点 → 收起（两态往返）', async () => {
    await render({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })

    await openList()
    expect(findClickable('共享图.png'), '展开后附件行丢失').toBeTruthy()
    expect(orphanScope(), '展开后孤儿区块丢失').toBeTruthy()
    expect(text()).toContain('不随笔记回滚')

    await click(header(), '附件表头（收起）')
    expect(findClickable('共享图.png'), '再点未收起').toBeUndefined()
    expect(orphanScope()).toBeUndefined()
  })

  it('收起态刷新按钮仍可用：点击会重新拉取附件数据', async () => {
    await render({ attachments: [SHARED_3REFS] })
    const before = vi.mocked(api.listAttachments).mock.calls.length

    expect(headerAction(), '收起态表头刷新按钮丢失').toBeTruthy()
    await click(headerAction(), '表头刷新按钮')

    expect(
      vi.mocked(api.listAttachments).mock.calls.length,
      '收起态点刷新未重新拉取',
    ).toBeGreaterThan(before)
  })
})

// ============================================================================
// L-2 数据源真迁移
// ============================================================================
describe('L-2 数据源迁移', () => {
  it('tree.attachments 全空但 /api/attachments/list 有数据 → 展开后渲染（不依赖文件树）', async () => {
    await render({ tree: emptyTree(), attachments: [SHARED_3REFS, LONE_ITEM] })

    expect(vi.mocked(api.listAttachments).mock.calls.length).toBeGreaterThanOrEqual(1)
    await openList()
    expect(findClickable('共享图.png'), '附件区仍依赖 tree.attachments（API 数据未渲染）').toBeTruthy()
    expect(findClickable('孤立资料.pdf')).toBeTruthy()
  })

  it('0 附件：收起态不显示空态文案，展开后显示「暂无附件」', async () => {
    await render({ attachments: [] })

    expect(headerText()).toMatch(/附件[^0-9]{0,3}0/)
    expect(text(), '收起态不应渲染列表体').not.toContain('暂无附件')

    await openList()
    expect(text(), '空态文案丢失').toContain('暂无附件')
  })
})

// ============================================================================
// L-3 详情正确性 + 迁移信息量不缩水
// ============================================================================
describe('L-3 详情：全部引用 / 信息量 / 跳转', () => {
  it('迁移信息量不缩水：名称 / 大小 / 已引用徽章 / 全路径 / 修改时间 逐项可见', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await openList()

    expect(text(), '名称丢失').toContain('共享图.png')
    expect(text(), '大小丢失').toMatch(/4\.0\s*KB/)
    expect(text(), '已引用徽章丢失').toContain('已引用')

    await click(findClickable('共享图.png'), '附件行 共享图')
    expect(text(), '详情缺全路径 rel_path').toContain(SHARED)
    expect(text(), '详情缺修改时间').toMatch(/2026/)
  })

  it('3 篇文档引用同一附件 → 详情必须列出全部 3 条（不是只列 [0]）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await clickRow('共享图.png')

    const body = text()
    expect(body, `缺少 ${DOC_A}`).toContain(DOC_A)
    expect(body, `缺少 ${DOC_B}`).toContain(DOC_B)
    expect(body, `缺少 ${DOC_C}`).toContain(DOC_C)
    expect(body).toMatch(/(篇|条|处|个)/)
  })

  it('详情内每条引用可跳转（onOpenArticle 收到正确 docRel，恰好 3 次）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await clickRow('共享图.png')

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
    await clickRow('共享图.png')

    expect(openSpy, '点击附件行不应触发跳转').not.toHaveBeenCalled()
  })

  it('未引用附件：显示「未被…引用」+ 全路径 + 大小 + 修改时间', async () => {
    await render({ attachments: [LONE_ITEM] })
    await clickRow('孤立资料.pdf')

    const body = text()
    expect(body).toMatch(/未被(任何文档)?引用/)
    expect(body, '已引用/未引用徽章丢失').toContain('未引用')
    expect(body).toContain(LONE)
    expect(body).toMatch(/3\.0\s*KB/)
    expect(body).toMatch(/2026/)
  })

  it('同行两击 = 展开再收起（详情消失，列表不塌）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await clickRow('共享图.png')
    expect(text()).toContain(DOC_B)

    await click(findClickable('共享图.png'), '附件行 收起')
    expect(text(), '同点两次应收起详情').not.toContain(DOC_B)
    expect(findClickable('共享图.png'), '收起详情不应连带收起整个列表').toBeTruthy()
  })

  it('点不同行 = 切换详情，上一个展开态不残留', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM] })
    await clickRow('共享图.png')
    expect(text()).toContain(DOC_C)

    await click(findClickable('孤立资料.pdf'), '附件行 孤立资料')
    expect(text(), '切换行后上一附件详情仍在').not.toContain(DOC_C)
    expect(text()).toMatch(/未被(任何文档)?引用/)
  })

  it('50 条引用不得被截断（防隐性上限）', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `Articles/引用-${String(i).padStart(2, '0')}.md`)
    await render({ attachments: [mkAttachment({ rel_path: 'Attachments/images/热门图.png', referenced_by: many })] })
    await clickRow('热门图.png')

    const shown = clickables().filter((el) => /Articles\/引用-\d\d\.md/.test(el.textContent ?? ''))
    expect(shown.length, '引用条目被截断（应全部列出 50 条）').toBe(50)
    expect(text()).toContain('Articles/引用-49.md')
  })
})

// ============================================================================
// L-4 收起两态 + 无残留
// ============================================================================
describe('L-4 收起两态与无残留', () => {
  it('两态成对：收起零行/零详情/零孤儿 DOM → 展开齐全 → 再收起零 DOM', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })

    // 默认收起态
    expect(findClickable('共享图.png')).toBeUndefined()
    expect(orphanScope()).toBeUndefined()
    expect(findClickable('删除'), '收起态仍渲染孤儿删除入口').toBeUndefined()
    expect(headerText()).toMatch(/附件[^0-9]{0,3}2/)
    expect(hasHeaderOrphanSignal()).toBe(true)

    // 展开态
    await openList()
    expect(findClickable('共享图.png')).toBeTruthy()
    expect(orphanScope()).toBeTruthy()
    expect(findIn(orphanScope(), '删除'), '展开态孤儿删除按钮丢失').toBeTruthy()
    expect(text()).toContain('孤儿附件')

    // 再收起
    await click(header(), '附件表头（收起）')
    expect(findClickable('共享图.png')).toBeUndefined()
    expect(orphanScope()).toBeUndefined()
    expect(findClickable('删除')).toBeUndefined()
  })

  it('收起后不得残留上一轮展开行/详情：展开→点行详情→收起→数据+文档变化→再展开', async () => {
    await render({ attachments: [SHARED_3REFS], activeId: 'Articles/文档A.md' })
    await clickRow('共享图.png')
    expect(text(), '前置：详情应已展开').toContain(DOC_B)

    await click(header(), '附件表头（收起）')
    expect(text(), '收起态仍残留详情').not.toContain(DOC_B)

    // 切文档 + 数据变化（旧附件不再存在）
    await update({ attachments: [LONE_ITEM], refreshKey: 1, activeId: 'Articles/文档C.md' })
    await openList()

    expect(text(), '改变数据后仍残留上一轮的引用详情').not.toContain(DOC_B)
    expect(container.querySelectorAll('[data-attachment-detail]').length, '残留详情面板').toBe(0)
    expect(findClickable('孤立资料.pdf'), '新数据未渲染').toBeTruthy()
  })

  it('收起态不得渲染底部说明文案（不随笔记回滚）', async () => {
    await render({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })
    expect(text()).not.toContain('不随笔记回滚')

    await openList()
    expect(text(), '展开态底部说明丢失').toContain('不随笔记回滚')

    await click(header(), '附件表头（收起）')
    expect(text(), '收起后仍残留底部说明').not.toContain('不随笔记回滚')
  })

  it('展开态不得被持久化：卸载重挂后仍为默认收起', async () => {
    await render({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })
    await openList()
    await click(findClickable('共享图.png'), '附件行 共享图')
    expect(header()!.getAttribute('aria-expanded'), '前置：应处于展开态').toBe('true')

    await remount({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })

    expect(header()!.getAttribute('aria-expanded'), '重挂后未回到默认收起').toBe('false')
    expect(rowCount(), '重挂后仍残留附件行').toBe(0)
    expect(orphanScope(), '重挂后仍残留孤儿区块').toBeUndefined()
    expect(text(), '重挂后仍残留详情').not.toContain(DOC_B)
  })
})

// ============================================================================
// L-5 「打开文件」能力 + DOM 合法性
// ============================================================================
describe('L-5 打开能力与 DOM 合法性', () => {
  it('每个附件保留独立 <a href={attachmentUrl(rel)}> 且 target=_blank / rel=noreferrer', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM] })
    await openList()

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
    await clickRow('共享图.png')

    expect(container.querySelectorAll('button button').length, 'button 嵌套 button').toBe(0)
    expect(container.querySelectorAll('button a').length, 'button 嵌套 a').toBe(0)
    expect(container.querySelectorAll('a button').length, 'a 嵌套 button').toBe(0)
  })
})

// ============================================================================
// L-6 孤儿删除
// ============================================================================
describe('L-6 孤儿删除（显式写路径 + 刷新）', () => {
  it('确认删除 → deleteAttachment(路径) 被调用且列表刷新', async () => {
    await render({ attachments: [], orphans: [ORPHAN_ITEM] })
    promptMocks.askConfirm.mockResolvedValue(true)
    await openList()
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
    await openList()

    await click(findIn(orphanScope(), '删除'), '孤儿删除按钮')

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteAttachment)).not.toHaveBeenCalled()
    assertNoWrites()
  })
})

// ============================================================================
// L-7 只读不变量
// ============================================================================
describe('L-7 只读不变量（展开/详情/跳转/收起全流程零写）', () => {
  it('只读流程零写请求 + 零裸 fetch + 无 alert（含默认收起→展开→详情→跳转→收起）', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })

    // 收起态本身不得产生写请求
    assertNoWrites()

    await clickRow('共享图.png') // 展开 + 行详情
    await clickReferral(DOC_A) // 跳转
    await clickReferral(DOC_B)
    await click(findClickable('孤立资料.pdf'), '附件行 孤立资料') // 切换
    await click(header(), '附件表头（收起）')

    assertNoWrites()
    expect(alertSpy, '只读展示不应弹 alert').not.toHaveBeenCalled()
  })

  it('展开/收起/点行详情不重复拉取列表（纯前端状态）', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })
    const afterMount = vi.mocked(api.listAttachments).mock.calls.length

    await openList()
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
// L-8 边界
// ============================================================================
describe('L-8 边界', () => {
  it('referenced_by 为空数组：按未引用处理（显示未引用 + 不跳转）', async () => {
    await render({ attachments: [mkAttachment({ rel_path: 'Attachments/images/空引用.png', referenced_by: [] })] })
    await clickRow('空引用.png')

    expect(text()).toMatch(/未被(任何文档)?引用/)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('超长文件名/路径不破版（可渲染 + 行内保留截断样式）', async () => {
    const longName = `${'极长文件名'.repeat(20)}.png`
    const longRel = `Attachments/images/${'深层目录'.repeat(30)}/${longName}`
    await render({ attachments: [mkAttachment({ rel_path: longRel })] })
    await openList()

    const row = findClickable(longName)
    expect(row, '超长文件名条目未能渲染').toBeTruthy()
    const truncated = row!.className.includes('truncate') || !!row!.querySelector('[class*="truncate"]')
    expect(truncated, '超长文件名缺少截断样式（happy-dom 无布局引擎，仅能校验样式类）').toBe(true)
  })

  it('refreshKey 变化 → 重新加载附件列表（收起态也须刷新计数）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    const first = vi.mocked(api.listAttachments).mock.calls.length
    expect(headerText(), '前置：收起态计数 1').toMatch(/附件[^0-9]{0,3}1/)

    await update({ attachments: [LONE_ITEM, SHARED_3REFS], refreshKey: 1 })

    expect(vi.mocked(api.listAttachments).mock.calls.length, 'refreshKey 变化未重载附件').toBeGreaterThan(first)
    expect(headerText(), '收起态计数未随新数据更新').toMatch(/附件[^0-9]{0,3}2/)
    await openList()
    expect(findClickable('孤立资料.pdf'), '重载后数据未更新').toBeTruthy()
  })

  it('树里存在附件名但 API 无数据 → 不得从 tree 推断渲染附件（等价性反证）', async () => {
    const treeWithAttachments: TreePayload = {
      ...emptyTree(),
      attachments: { images: ['Attachments/images/树里的图.png'], videos: [], files: [] },
    }
    await render({ tree: treeWithAttachments, attachments: [] })

    await openList()
    expect(findClickable('树里的图.png'), '仍从 tree.attachments 渲染附件（迁移未完成）').toBeUndefined()
    expect(text()).toContain('暂无附件')
  })
})
