/**
 * RightPanel「右栏净身」独立验证套件（task-14 / verifier-attach）
 *
 * 背景（主理人裁决）：附件能力的家 = 左栏；右栏「文档属性就是文档属性」。
 * 本文件由上一轮「附件区改造」套件（26 用例）**重写**而来 —— 上一轮的验证对象（右栏附件小节）
 * 已被 task-12 删除，故原断言作废，改为**负向净身判据 + 保留项双向断言**：
 *
 *   ① 净身（负向）：渲染结果零附件痕迹 —— 无「附件」字样、无附件/孤儿 DOM 钩子、
 *      无指向附件的 <a>、**零附件数据请求**（listAttachments/listOrphans/deleteAttachment 全不被调用）
 *   ② 保留（正向）：文档属性 / 大纲 / 历史快照 / 收起右栏 四项能力仍在
 *   ③ 不变量：只读语义不变 —— 渲染与交互全程零写请求；仅显式点「保存属性」才写（非空对照）
 *
 * 写入边界（task-14）：本文件 + LeftSidebar.verify.test.tsx + docs/verification-relocate.md 是
 * verifier 可写产物；不得修改任何源码。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import RightPanel from './RightPanel'
// 源码级净身断言用：以原文形式读入被验证组件（不依赖 mock 是否被漏设）
import rightPanelSource from './RightPanel.tsx?raw'
import * as api from '../../api/client'
import type { ArticleMeta } from '../../types'

// ---------- 模块替身 ----------
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
}))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: promptMocks.askConfirm,
  askPrompt: vi.fn(async () => null),
  usePrompt: () => vi.fn(async () => null),
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

// 编辑器内核绊线：右栏依赖图触达 editor/index 即整文件失败（不得引入编辑器事务能力）
vi.mock('../../editor/index', () => {
  throw new Error('[不变量] RightPanel 不得引入编辑器内核 editor/index')
})

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

function callsOf(fn: string): unknown[][] {
  const m = apiMocks[fn]
  if (!m) throw new Error(`api/client 替身缺少导出 ${fn}`)
  return m.mock.calls as unknown[][]
}

let fetchSpy: AnyMock

function assertNoWrites(): void {
  const touched = WRITE_FUNCS.filter((fn) => callsOf(fn).length > 0)
  expect(touched, `只读不变量被破：写请求被调用 ${JSON.stringify(touched)}`).toEqual([])
  expect(
    fetchSpy.mock.calls,
    `出现绕过 api/client 的裸 fetch ${JSON.stringify(fetchSpy.mock.calls)}`,
  ).toEqual([])
}

/** 右栏净身判据：任何附件用途的数据请求都不应发生 */
function assertNoAttachmentDataAccess(): void {
  for (const fn of ['listAttachments', 'listOrphans', 'deleteAttachment', 'uploadAttachment'] as const) {
    expect(
      callsOf(fn),
      `右栏仍在访问附件数据：${fn} 被调用 ${JSON.stringify(callsOf(fn))}`,
    ).toEqual([])
  }
}

// ---------- 数据与脚手架 ----------
function mkArticle(over: Partial<ArticleMeta> = {}): ArticleMeta {
  return {
    id: 'Articles/主文档.md',
    path: 'Articles/主文档.md',
    title: '主文档',
    content: '# 主文档\n\n## 小节一\n\n正文\n\n### 小节二\n',
    created_at: '2026-09-01T10:00:00+08:00',
    updated_at: '2026-09-15T09:30:00+08:00',
    size: 2048,
    word_count: 123,
    tags: ['项目', '备忘'],
    meta: { ke_version: 3 },
    ...over,
  }
}

let root: Root | null = null
let container: HTMLDivElement
type VoidSpy = ReturnType<typeof vi.fn<() => void>>
let collapseSpy: VoidSpy
let historySpy: VoidSpy
let alertSpy: AnyMock

interface RenderOpts {
  article?: ArticleMeta | null
  withHistory?: boolean
}

async function render(opts: RenderOpts = {}): Promise<void> {
  const art = opts.article === undefined ? mkArticle() : opts.article
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <RightPanel
        article={art}
        onOpenArticle={vi.fn()}
        onCollapse={collapseSpy}
        onOpenHistory={opts.withHistory ? historySpy : undefined}
      />,
    )
  })
  await settle()
}

async function update(opts: RenderOpts = {}): Promise<void> {
  await act(async () => {
    root!.render(<RightPanel article={opts.article ?? mkArticle()} onOpenArticle={vi.fn()} />)
  })
  await settle()
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

function findClickable(needle: string): HTMLElement | undefined {
  return clickables()
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

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  collapseSpy = vi.fn<() => void>()
  historySpy = vi.fn<() => void>()
  alertSpy = vi.fn()
  ;(window as unknown as { alert: unknown }).alert = alertSpy
  fetchSpy = vi.fn(async () => new Response('{}'))
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchSpy
  vi.mocked(api.updateArticleMeta).mockResolvedValue(mkArticle())
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
// R-1 净身（负向硬判据）
// ============================================================================
describe('R-1 右栏净身：不得存在任何附件小节', () => {
  it('渲染结果不含「附件」「孤儿」字样', async () => {
    await render({ withHistory: true })

    expect(text()).not.toContain('附件')
    expect(text()).not.toContain('孤儿')
  })

  it('不存在附件/孤儿 DOM 钩子（data-attachment-* / attachments-toggle / orphan-badge / orphans-block）', async () => {
    await render({ withHistory: true })

    const hooks = [
      '[data-attachment-row]',
      '[data-attachment-detail]',
      '[data-attachment]',
      '[data-testid="attachments-toggle"]',
      '[data-testid="orphan-badge"]',
      '[data-testid="orphans-block"]',
    ]
    for (const sel of hooks) {
      expect(container.querySelectorAll(sel).length, `残留附件 DOM 钩子：${sel}`).toBe(0)
    }
  })

  it('不存在指向附件的 <a>，也不存在孤儿删除入口', async () => {
    await render({ withHistory: true })

    expect(container.querySelectorAll('a[href*="attachments"]').length, '残留附件打开链接').toBe(0)
    expect(container.querySelectorAll('a[href^="/api/attachments/"]').length).toBe(0)
    expect(findClickable('删除'), '残留孤儿删除入口').toBeUndefined()
  })

  it('零附件数据请求：渲染 + 切换文档后 listAttachments/listOrphans/deleteAttachment 均未被调用', async () => {
    await render({ withHistory: true })
    await update({ article: mkArticle({ id: 'Articles/另一篇.md', path: 'Articles/另一篇.md' }) })

    assertNoAttachmentDataAccess()
  })

  it('源码级净身：RightPanel.tsx 正文不含 listAttachments/listOrphans/deleteAttachment/uploadAttachment', () => {
    // 去掉注释后再查，避免「注释里提到迁移」造成假红；只对正文做断言
    const body = rightPanelSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(rightPanelSource.length, '?raw 读取失败').toBeGreaterThan(500)
    for (const fn of ['listAttachments', 'listOrphans', 'deleteAttachment', 'uploadAttachment'] as const) {
      expect(body.includes(fn), `源码残留附件数据函数：${fn}`).toBe(false)
    }
    // 反向：属性能力必须仍在（证明不是"把整个文件清空"）
    expect(body).toContain('updateArticleMeta')
    expect(body).toContain('extractOutline')
  })
})

// ============================================================================
// R-2 保留项（正向）
// ============================================================================
describe('R-2 右栏保留能力', () => {
  it('文档属性完整：标题输入 / 标签 / 类型 / 字数 / 创建 / 修改 / 大小 / 保存位置 / KE 版本 / frontmatter', async () => {
    await render()

    const body = text()
    for (const label of ['标题', '标签', '类型', '字数', '创建时间', '修改时间', '大小', '保存位置', 'KE 版本', 'frontmatter']) {
      expect(body, `属性字段丢失：${label}`).toContain(label)
    }
    expect(container.querySelector('input'), '标题输入框丢失').toBeTruthy()
    expect(body).toContain('123') // 字数
    expect(body).toContain('2.0 KB') // 大小
    expect(body).toContain('Articles/主文档.md') // 保存位置
    expect(body).toContain('v3') // KE 版本
  })

  it('大纲仍在：显示条目与标题，条目可点击且不抛错', async () => {
    await render()

    expect(text()).toContain('大纲')
    expect(text()).toContain('主文档')
    expect(text()).toContain('小节一')
    const item = findClickable('小节二')
    expect(item, '大纲条目丢失').toBeTruthy()
    await click(item, '大纲条目 小节二') // 无编辑器 DOM 时走 alert 兜底，不应抛错
  })

  it('历史快照卡片仍在：查看历史触发 onOpenHistory', async () => {
    await render({ withHistory: true })

    expect(text()).toContain('历史快照')
    await click(findClickable('查看历史'), '查看历史')
    expect(historySpy).toHaveBeenCalledTimes(1)
  })

  it('收起右栏按钮仍在：触发 onCollapse', async () => {
    await render()

    const btn = container.querySelector('[aria-label="收起属性栏"]')
    expect(btn, '收起属性栏按钮丢失').toBeTruthy()
    await click(btn as HTMLElement, '收起属性栏')
    expect(collapseSpy).toHaveBeenCalledTimes(1)
  })

  it('未打开文档时显示空态且不崩', async () => {
    await render({ article: null })
    expect(text()).toContain('未打开文档')
  })
})

// ============================================================================
// R-3 只读不变量
// ============================================================================
describe('R-3 右栏只读不变量', () => {
  it('渲染 + 大纲点击 + 查看历史 + 收起：全程零写请求、零附件访问、零裸 fetch', async () => {
    await render({ withHistory: true })

    await click(findClickable('小节一'), '大纲条目')
    await click(findClickable('查看历史'), '查看历史')
    await click(container.querySelector('[aria-label="收起属性栏"]') as HTMLElement, '收起属性栏')

    assertNoWrites()
    assertNoAttachmentDataAccess()
  })

  it('非空证明：显式点「保存属性」时 updateArticleMeta 确实被调用（防替身失效假绿）', async () => {
    await render()

    const input = container.querySelector('input') as HTMLInputElement
    await act(async () => {
      // React 受控输入：用 native setter + input 事件驱动 value 变更
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '改过的标题')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()

    await click(findClickable('保存属性'), '保存属性')
    expect(vi.mocked(api.updateArticleMeta)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.updateArticleMeta).mock.calls[0][0]).toBe('Articles/主文档.md')
  })

  it('未编辑时不得出现「保存属性」按钮（避免无意义写入入口）', async () => {
    await render()
    expect(findClickable('保存属性')).toBeUndefined()
  })
})
