/**
 * RightPanel 附件区「独立对抗验证」用例集（task-10 / verifier-attach）
 *
 * 定位：这是**验证者**写的测试，不是开发者验收测试的副本。
 * 用例由 verifier 独立推导（对抗性优先），覆盖四类：
 *   ① 不变量：附件区是**只读展示**——展开/跳转/取消删除全流程不得产生任何写请求；
 *   ② 正确性：3 篇文档引用同一附件 → 必须列出**全部 3 条**（旧实现只列 [0]，本次要修的核心）；
 *   ③ 信号保留：默认收起时若存在孤儿附件，表头必须仍可见提示（"不占空间但别丢信号"）；
 *   ④ 边界：0 附件 / 空 referenced_by / 超长路径 / 同一行两次点击 / 切换行不残留。
 *
 * 写入边界（task-10）：本文件与 docs/verification-attach-logo.md 是 verifier 唯一可写的产物，
 * 不得修改 RightPanel.tsx 或任何其它源码。
 *
 * 说明：仓库组件测试范式沿用 src/state/memoTree.test.tsx（createRoot + act +
 * IS_REACT_ACT_ENVIRONMENT）与 LeftSidebar.test.tsx（vi.mock api/client、PromptDialog）。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import RightPanel from './RightPanel'
import * as api from '../../api/client'
import type { ArticleMeta, AttachmentItem, OrphanItem } from '../../types'

// ---------- 模块替身 ----------
// ① api/client 全量替身：只读展示的强不变量 = 任何写函数 mock 都不得被调用。
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

// ② 确认对话框（孤儿删除走 askConfirm）
const promptMocks = vi.hoisted(() => ({
  askConfirm: vi.fn(async (_msg: string, _opts?: unknown) => true as boolean),
}))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: promptMocks.askConfirm,
  askPrompt: vi.fn(async () => null),
  usePrompt: () => vi.fn(async () => null),
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

// ③ 编辑器内核绊线：RightPanel 的依赖图一旦触达 editor/index（即引入编辑器/事务能力），
//    本工厂抛错。当前依赖图：RightPanel → api/client(已替身) / state/outline / icons / PromptDialog。
vi.mock('../../editor/index', () => {
  throw new Error('[不变量] RightPanel 不得引入编辑器内核 editor/index（不得触发编辑器事务）')
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------- 写请求清单（只读不变量用；来源：src/api/client.ts 全量导出） ----------
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

function callsOf(fn: string): unknown[][] {
  const m = apiMocks[fn]
  if (!m) throw new Error(`api/client 替身缺少导出 ${fn}（作者需同步 WRITE_FUNCS）`)
  return m.mock.calls as unknown[][]
}

/** 强不变量：全流程零写请求（client 写函数 + 绕过 client 的裸 fetch 双层） */
function assertNoWrites(): void {
  const touched = WRITE_FUNCS.filter((fn) => callsOf(fn).length > 0)
  expect(
    touched,
    `只读展示不变量被破：以下写请求被调用 ${JSON.stringify(touched.map((f) => [f, callsOf(f)]))}`,
  ).toEqual([])
  expect(
    fetchSpy.mock.calls,
    `只读展示不变量被破：出现绕过 api/client 的裸 fetch ${JSON.stringify(fetchSpy.mock.calls)}`,
  ).toEqual([])
}

// ---------- 测试数据 ----------
const DOC_A = 'Articles/文档A.md'
const DOC_B = 'Articles/子目录/文档B.md'
const DOC_C = 'Articles/文档C.md'

/** 3 篇文档引用同一附件（旧实现只跳转 referenced_by[0]） */
const SHARED = 'assets/images/共享图.png'
/** 未被任何文档引用 */
const LONE = 'assets/files/孤立资料.pdf'
const ORPHAN = 'assets/files/孤儿报告.pdf'

function mkAttachment(over: Partial<AttachmentItem> & { rel_path: string }): AttachmentItem {
  return {
    name: over.rel_path.split('/').pop() ?? over.rel_path,
    category: 'images',
    size: 2048,
    mtime: '2026-09-15T10:00:00+08:00',
    referenced_by: [],
    ...over,
  }
}

function mkArticle(over: Partial<ArticleMeta> = {}): ArticleMeta {
  return {
    id: 'Articles/主文档.md',
    path: 'Articles/主文档.md',
    title: '主文档',
    content: '# 主文档\n\n正文',
    ...over,
  }
}

const SHARED_3REFS = mkAttachment({ rel_path: SHARED, size: 4096, referenced_by: [DOC_A, DOC_B, DOC_C] })
const LONE_ITEM = mkAttachment({ rel_path: LONE, category: 'files', size: 3072, referenced_by: [] })
const ORPHAN_ITEM: OrphanItem = {
  name: '孤儿报告.pdf',
  path: ORPHAN,
  size: 1024,
  mtime: '2026-09-14T08:30:00+08:00',
}

// ---------- 渲染脚手架 ----------
let root: Root | null = null
let container: HTMLDivElement
type OpenSpy = ReturnType<typeof vi.fn<(id: string) => void>>
let openSpy: OpenSpy
let alertSpy: AnyMock
let fetchSpy: AnyMock

interface RenderOpts {
  attachments?: AttachmentItem[]
  orphans?: OrphanItem[]
  article?: ArticleMeta
}

function panelJsx(opts: RenderOpts) {
  const onOpenArticle = (id: string): void => {
    openSpy(id)
  }
  return <RightPanel article={opts.article ?? mkArticle()} onOpenArticle={onOpenArticle} />
}

async function render(opts: RenderOpts = {}): Promise<void> {
  mockData(opts)
  openSpy = vi.fn<(id: string) => void>()
  root = createRoot(container)
  await act(async () => {
    root!.render(panelJsx(opts))
  })
  await settle()
}

async function update(opts: RenderOpts = {}): Promise<void> {
  // 注意：props 变化后组件会重新拉取列表，替身返回值必须同步更新，否则是脚手架假红
  mockData(opts)
  await act(async () => {
    root!.render(panelJsx(opts))
  })
  await settle()
}

function mockData(opts: RenderOpts): void {
  vi.mocked(api.listAttachments).mockResolvedValue({
    count: (opts.attachments ?? []).length,
    attachments: opts.attachments ?? [],
  })
  vi.mocked(api.listOrphans).mockResolvedValue({
    count: (opts.orphans ?? []).length,
    orphans: opts.orphans ?? [],
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function text(): string {
  return container.textContent ?? ''
}

/** 可点击候选（button/a/role=button/role=link/aria-expanded 宿主） */
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

function findAttachmentRow(name: string): HTMLElement | undefined {
  return findClickable(name)
}

/** 附件区表头（含「附件」字样的最内层可点击元素） */
function header(): HTMLElement | undefined {
  return findClickable('附件')
}

/** 表头文本（去空白），用于「附件 N」数量与孤儿提示的稳健匹配 */
function headerText(): string {
  return (header()?.textContent ?? '').replace(/\s+/g, '')
}

/**
 * 孤儿信号判据：文案含「孤儿」/ 警示符号 / 存在琥珀-警示样式或 data/aria 标记。
 * 不锁定具体文案或图标名（实现自由），但必须有**可被用户看到的**信号。
 */
function hasOrphanSignal(head: HTMLElement | undefined): boolean {
  if (!head) return false
  const t = head.textContent ?? ''
  if (t.includes('孤儿') || /[⚠!]/.test(t)) return true
  return !!head.querySelector(
    '[class*="amber"],[class*="warning"],[class*="rose"],[class*="alert"],[data-orphan],[aria-label*="孤儿"]',
  )
}

async function click(el: HTMLElement | undefined, label = '元素'): Promise<void> {
  expect(el, `未找到可点击元素：${label}`).toBeTruthy()
  await act(async () => {
    el!.click()
  })
  await settle()
}

async function expandList(): Promise<void> {
  await click(header(), '附件表头（展开）')
}

async function clickReferral(rel: string): Promise<void> {
  let link = findClickable(rel)
  if (!link) {
    // 若实现折叠了详情，重新展开后再点（避免脚手架误判）
    await expandList()
    link = findClickable(rel)
  }
  await click(link, `引用条目 ${rel}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  promptMocks.askConfirm.mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  alertSpy = vi.fn()
  ;(window as unknown as { alert: unknown }).alert = alertSpy
  // 兜底：即使 api/client 被替身，也要能发现组件绕过 client 直接 fetch 的写请求
  fetchSpy = vi.fn(async () => new Response('{}'))
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchSpy
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
// A-1 折叠语义与信号保留
// ============================================================================
describe('A-1 折叠（默认收起）与孤儿信号保留', () => {
  it('默认收起：附件条目不在 DOM，表头仍显示「附件」+ 数量', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM] })

    expect(header(), '附件表头应为可点击元素').toBeTruthy()
    expect(headerText(), '收起态表头必须仍显示数量 2').toMatch(/附件[^0-9]{0,3}2/)
    expect(findAttachmentRow('共享图.png'), '默认收起时不得平铺附件条目').toBeUndefined()
    expect(findAttachmentRow('孤立资料.pdf')).toBeUndefined()
  })

  it('有孤儿附件时，收起态必须仍可见提示（信号不能丢）', async () => {
    await render({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })

    expect(findAttachmentRow('共享图.png'), '前置：应处于收起态').toBeUndefined()
    expect(hasOrphanSignal(header()), '收起后丢失孤儿信号：表头无任何提示').toBe(true)
  })

  it('无孤儿时收起态表头不出现孤儿噪声', async () => {
    await render({ attachments: [SHARED_3REFS] })

    expect(hasOrphanSignal(header()), '无孤儿却出现孤儿提示').toBe(false)
  })

  it('两态成对（主理人裁决）：收起=只剩表头（删除入口消失/仅剩信号）；展开=孤儿区块+删除入口', async () => {
    await render({ attachments: [SHARED_3REFS], orphans: [ORPHAN_ITEM] })

    // 收起态：只允许表头一行 —— 孤儿信号必须保留，但处理入口不得占空间
    expect(hasOrphanSignal(header()), '收起态孤儿信号丢失').toBe(true)
    expect(findClickable('删除'), '收起态仍渲染孤儿删除入口（应随列表一起收起）').toBeUndefined()
    expect(findAttachmentRow('共享图.png'), '收起态仍渲染附件条目').toBeUndefined()

    // 展开态：孤儿区块与删除入口必须回来
    await expandList()
    expect(findClickable('删除'), '展开态缺少孤儿删除入口').toBeTruthy()
    expect(text()).toMatch(/孤儿附件/)
  })

  it('表头点击 = 展开；再点 = 收起（列表条目随之消失）', async () => {
    await render({ attachments: [SHARED_3REFS] })

    await expandList()
    expect(findAttachmentRow('共享图.png'), '展开后应显示附件条目').toBeTruthy()

    await click(header(), '附件表头（收起）')
    expect(findAttachmentRow('共享图.png'), '再点表头应收起列表').toBeUndefined()
  })
})

// ============================================================================
// A-2 展开详情正确性（本次核心修复：全部引用，而非只列第一条）
// ============================================================================
describe('A-2 点击附件 → 展开详情', () => {
  it('3 篇文档引用同一附件 → 详情必须列出全部 3 条（不是只列 [0]）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await expandList()
    await click(findAttachmentRow('共享图.png'), '附件行 共享图.png')

    const body = text()
    expect(body, `缺少 ${DOC_A}`).toContain(DOC_A)
    expect(body, `缺少 ${DOC_B}（旧实现只列 referenced_by[0]）`).toContain(DOC_B)
    expect(body, `缺少 ${DOC_C}（旧实现只列 referenced_by[0]）`).toContain(DOC_C)
    // 引用篇数信号（数量 3 + 任一量词，不锁死文案）
    expect(body).toMatch(/3/)
    expect(body).toMatch(/(篇|条|处|个)/)
  })

  it('详情内每一条引用都能跳到对应文档（onOpenArticle 收到正确 docRel）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await expandList()
    await click(findAttachmentRow('共享图.png'), '附件行 共享图.png')

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
    await expandList()
    await click(findAttachmentRow('共享图.png'), '附件行 共享图.png')

    expect(openSpy, '点击附件行不应触发跳转（否则看不到详情）').not.toHaveBeenCalled()
  })

  it('未引用附件：显示「未被…引用」+ 自身详情（rel_path / 大小 / 修改时间）', async () => {
    await render({ attachments: [LONE_ITEM] })
    await expandList()
    await click(findAttachmentRow('孤立资料.pdf'), '附件行 孤立资料.pdf')

    const body = text()
    expect(body).toMatch(/未被(任何文档)?引用/)
    expect(body, '详情应含附件全路径 rel_path').toContain(LONE)
    expect(body, '详情应含格式化大小').toMatch(/3\.0\s*KB/)
    expect(body, '详情应含修改时间').toMatch(/2026/)
  })

  it('同一行点两次 = 展开再收起（详情消失，列表不塌）', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await expandList()

    await click(findAttachmentRow('共享图.png'), '附件行 展开')
    expect(text()).toContain(DOC_B)

    await click(findAttachmentRow('共享图.png'), '附件行 收起')
    expect(text(), '同点两次应收起详情').not.toContain(DOC_B)
    expect(findAttachmentRow('共享图.png'), '收起详情不应连带收起整个列表').toBeTruthy()
  })

  it('点不同行 = 切换详情，上一个的展开态不得残留', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM] })
    await expandList()

    await click(findAttachmentRow('共享图.png'), '附件行 共享图')
    expect(text()).toContain(DOC_C)

    await click(findAttachmentRow('孤立资料.pdf'), '附件行 孤立资料')
    expect(text(), '切换行后上一个附件详情仍在（疑似同时展开两行）').not.toContain(DOC_C)
    expect(text()).toMatch(/未被(任何文档)?引用/)
  })

  it('引用列表顺序与 referenced_by 一致（不得乱序/丢条目）', async () => {
    const ordered = mkAttachment({
      rel_path: 'assets/images/顺序图.png',
      referenced_by: [DOC_C, DOC_A, DOC_B],
    })
    await render({ attachments: [ordered] })
    await expandList()
    await click(findAttachmentRow('顺序图.png'), '附件行 顺序图')

    const body = text()
    expect(body.indexOf(DOC_C)).toBeGreaterThanOrEqual(0)
    expect(body.indexOf(DOC_C)).toBeLessThan(body.indexOf(DOC_A))
    expect(body.indexOf(DOC_A)).toBeLessThan(body.indexOf(DOC_B))
  })

  it('DOM 合法性：不产生嵌套交互元素（button 内不得再嵌 button/a）', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })
    await expandList()
    await click(findAttachmentRow('共享图.png'), '附件行 共享图')
    await click(findAttachmentRow('孤立资料.pdf'), '附件行 孤立资料')

    expect(container.querySelectorAll('button button').length, 'button 嵌套 button').toBe(0)
    expect(container.querySelectorAll('button a').length, 'button 嵌套 a').toBe(0)
    expect(container.querySelectorAll('a button').length, 'a 嵌套 button').toBe(0)
  })
})

// ============================================================================
// A-3 只读不变量（最高价值）
// ============================================================================
describe('A-3 只读不变量：全程零写请求', () => {
  it('打开/展开/跳转/收起全流程：无任何写请求，且无 alert', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })

    await expandList() // 展开列表
    await click(findAttachmentRow('共享图.png'), '附件行 共享图') // 展开详情
    await clickReferral(DOC_A) // 跳转文档 A
    await clickReferral(DOC_B) // 跳转文档 B
    await click(findAttachmentRow('孤立资料.pdf'), '附件行 孤立资料') // 切到未引用附件
    await click(header(), '附件表头（收起）') // 收起

    assertNoWrites()
    expect(alertSpy, '只读展示不应弹 alert').not.toHaveBeenCalled()
  })

  it('展开/收起是纯前端状态：不重复请求 listAttachments / listOrphans', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })

    await expandList()
    await click(findAttachmentRow('共享图.png'), '附件行 共享图')
    await click(header(), '附件表头（收起）')

    expect(
      vi.mocked(api.listAttachments).mock.calls.length,
      '展开/收起不应重复请求 listAttachments',
    ).toBe(1)
    expect(vi.mocked(api.listOrphans).mock.calls.length, '展开/收起不应重复请求 listOrphans').toBe(1)
  })

  it('非空证明：写请求替身确实可被调用（避免「零调用」是替身失效造成的假绿）', async () => {
    await render({ attachments: [], orphans: [ORPHAN_ITEM] })
    promptMocks.askConfirm.mockResolvedValue(true)

    await expandList() // 孤儿处理入口随列表收起，需展开后才有删除按钮
    await click(findClickable('删除'), '孤儿附件删除按钮')

    expect(vi.mocked(api.deleteAttachment)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteAttachment).mock.calls[0][0]).toBe(ORPHAN)
  })

  it('取消孤儿删除 → 不得发起 deleteAttachment（读-取消不写）', async () => {
    await render({ attachments: [], orphans: [ORPHAN_ITEM] })
    promptMocks.askConfirm.mockResolvedValue(false)

    await expandList()
    await click(findClickable('删除'), '孤儿附件删除按钮')

    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.deleteAttachment)).not.toHaveBeenCalled()
    assertNoWrites()
  })

  it('不触发编辑器事务：附件交互后编辑器容器未被触碰', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await expandList()
    await click(findAttachmentRow('共享图.png'), '附件行 共享图')
    await clickReferral(DOC_A)

    expect(document.querySelector('.ke-editor-prose'), '附件区不得被当作编辑器容器').toBeNull()
  })
})

// ============================================================================
// A-4 既有信息未丢 + 边界
// ============================================================================
describe('A-4 既有信息未丢', () => {
  it('刷新按钮 / 已引用-未引用徽章 / 孤儿删除按钮 / 底部说明文案仍在', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM], orphans: [ORPHAN_ITEM] })
    await expandList()

    const refresh =
      container.querySelector('[aria-label="添加附件"]') ??
      container.querySelector('[title="添加附件"]')
    expect(refresh, '刷新按钮丢失').toBeTruthy()

    expect(text()).toMatch(/已引用/)
    expect(text()).toMatch(/未引用/)
    expect(findClickable('删除'), '孤儿附件删除按钮丢失').toBeTruthy()
    expect(text(), '底部说明文案丢失').toContain('孤儿附件仅支持手动删除，不随笔记回滚')
  })
})

describe('A-5 边界', () => {
  it('附件 0 条：收起与展开均正常', async () => {
    await render({ attachments: [] })

    expect(header(), '无附件时表头仍应可点').toBeTruthy()
    expect(headerText(), '无附件时表头数量应为 0').toMatch(/附件[^0-9]{0,3}0/)

    await expandList()
    expect(text()).toContain('暂无附件')

    await click(header(), '附件表头（再收起）')
    expect(text(), '收起后列表体（含空态文案）应一并收起').not.toContain('暂无附件')
  })

  it('附件 0 条但有孤儿：收起态表头仍须保留孤儿信号', async () => {
    await render({ attachments: [], orphans: [ORPHAN_ITEM] })

    expect(headerText(), '无附件时表头数量应为 0').toMatch(/附件[^0-9]{0,3}0/)
    expect(hasOrphanSignal(header()), '零附件场景下孤儿信号丢失').toBe(true)
  })

  it('50 条引用不得被截断（防「只显示前 N 条」的隐性上限）', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `Articles/引用-${String(i).padStart(2, '0')}.md`)
    await render({ attachments: [mkAttachment({ rel_path: 'assets/images/热门图.png', referenced_by: many })] })
    await expandList()
    await click(findAttachmentRow('热门图.png'), '附件行 热门图')

    const shown = clickables().filter((el) => /Articles\/引用-\d\d\.md/.test(el.textContent ?? ''))
    expect(shown.length, '引用条目被截断（应全部列出 50 条）').toBe(50)
    expect(text()).toContain('Articles/引用-49.md')
  })

  it('重开列表后仍至多一行处于展开态（收起了列表再展开不产生多行残留）', async () => {
    await render({ attachments: [SHARED_3REFS, LONE_ITEM] })
    await expandList()
    await click(findAttachmentRow('共享图.png'), '附件行 共享图')

    await click(header(), '附件表头（收起）')
    await expandList()

    const detailCount = container.querySelectorAll('[data-attachment-detail]').length
    const firstRowExpanded = findAttachmentRow('共享图.png')?.getAttribute('aria-expanded') === 'true'
    expect(detailCount, '重开列表后出现多行同时展开').toBeLessThanOrEqual(1)
    // 实现可保留或重置展开态，两者都可接受；但状态必须自洽（aria-expanded 与详情面板一致）
    expect(firstRowExpanded, 'aria-expanded 与详情面板存在状态不一致').toBe(detailCount === 1)
  })

  it('referenced_by 为空数组：按未引用处理（不跳转 + 显示未引用）', async () => {
    await render({ attachments: [mkAttachment({ rel_path: 'assets/images/空引用.png', referenced_by: [] })] })
    await expandList()
    await click(findAttachmentRow('空引用.png'), '附件行 空引用')

    expect(text()).toMatch(/未被(任何文档)?引用/)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('超长路径 / 文件名不破版（渲染成功且行内保留截断样式）', async () => {
    const longName = `${'极长文件名'.repeat(20)}.png`
    const longRel = `assets/images/${'深层目录'.repeat(30)}/${longName}`
    await render({ attachments: [mkAttachment({ rel_path: longRel })] })
    await expandList()

    const row = findAttachmentRow(longName)
    expect(row, '超长文件名条目未能渲染').toBeTruthy()
    const truncated =
      row!.className.includes('truncate') || !!row!.querySelector('[class*="truncate"]')
    expect(truncated, '超长文件名缺少截断样式（happy-dom 无布局引擎，仅能校验样式类）').toBe(true)
  })

  it('切换文档（article.id 变化）后重新加载列表且不崩', async () => {
    await render({ attachments: [SHARED_3REFS] })
    await update({
      attachments: [LONE_ITEM],
      article: mkArticle({ id: 'Articles/另一篇.md', path: 'Articles/另一篇.md', title: '另一篇' }),
    })

    expect(vi.mocked(api.listAttachments).mock.calls.length).toBe(2)
    await expandList()
    expect(findAttachmentRow('孤立资料.pdf')).toBeTruthy()
    assertNoWrites()
  })
})
