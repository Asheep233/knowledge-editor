/**
 * task-74 **接线级**用例（EditorArea 入口）：
 *  ① 工具条按钮 → 预览对话框出现（内容取自**已保存正文**，不额外触发序列化）
 *  ② 确认另存后：新文件走 `createArticle`（`<原名>-正体d`），**当前文档 sha256 未变**、
 *     **不新增标签**、**不调用原文档的保存/PUT**、**不自动打开新文件**
 *
 * 手法参照 `EditorArea.task64.test.tsx`：mock 编辑器与 API client，只验接线行为。
 */
import { act } from 'react'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 挂载 EditorArea 较重：全量并行时 5s 默认超时偶发不够（CI 全量曾超时 1 次），此处放宽到 20s。
vi.setConfig({ testTimeout: 20000 })
import { createRoot, type Root } from 'react-dom/client'
import type { ArticleMeta } from '../../types'

const CS = vi.hoisted(() => ({
  md: '',
  json: { type: 'doc', content: [] as unknown[] },
  requests: [] as Array<{ method: string; url: string; body: unknown }>,
  created: [] as Array<{ title: string; content: string }>,
  getMarkdownCalls: 0,
  editor: null as unknown,
}))

vi.mock('@tiptap/react', () => ({
  EditorContext: { Provider: (props: { children?: unknown }) => props.children },
  EditorContent: () => null,
  useEditor: () => CS.editor,
  useCurrentEditor: () => ({ editor: CS.editor }),
  // 工具条用 useEditorState 读激活态；测试只需"有值"，不需要真实响应
  useEditorState: (opts: { selector?: (ctx: { editor: unknown }) => unknown }) =>
    (opts?.selector ? opts.selector({ editor: CS.editor }) : null),
  EditorProvider: (p: { children?: unknown }) => p.children,
}))
vi.mock('../../editor', () => ({
  /** 万能可调用代理：EditorArea/工具条会读很多 tiptap API（isActive/can/chain/state…），
   *  这里对业务只需准确的 getMarkdown（计数）与 getJSON；其余一律返回可调用代理。 */
  useKeEditor: () => {
    const proxy: unknown = new Proxy(function () {} as unknown as object, {
      get(_t, prop) {
        if (prop === 'then') return undefined
        if (prop === 'getMarkdown') return () => { CS.getMarkdownCalls++; return CS.md }
        if (prop === 'getJSON') return () => CS.json
        if (prop === 'isEditable') return true
        if (prop === 'isFocused' || prop === 'isActive') return () => false
        if (prop === 'state') return { doc: { textBetween: () => '', content: { size: 0 } }, selection: { from: 0, to: 0, empty: true } }
        if (prop === 'view') return { dom: document.createElement('div'), dispatch: () => undefined, state: { doc: { textBetween: () => '' } } }
        if (prop === 'storage') return { markdown: { manager: { parse: () => ({ type: 'doc' }), serialize: () => CS.md } } }
        if (prop === 'schema') return { nodes: {} }
        if (prop === 'extensionManager') return { extensions: [] }
        return proxy
      },
      apply() { return proxy },
    })
    CS.editor = proxy
    return proxy
  },
  // EditorArea 还从 ../../editor 取这些具名导出（本用例不触及它们的逻辑）
  setKeContent: () => undefined,
  openMathEditorById: () => false,
}))

vi.mock('../../api/client', () => ({
  getTree: async () => ({ root: '', articles: ['Articles/Week3.md', 'Articles/其它.md'], modules: [], attachments: { images: [], videos: [], files: [] } }),
  createArticle: async (title: string, content: string) => {
    CS.created.push({ title, content })
    return { id: `Articles/${title}.md`, path: `Articles/${title}.md`, title, content }
  },
  saveArticle: async (_id: string, content: string) => {
    CS.requests.push({ method: 'PUT', url: _id, body: content })
    return { id: _id, path: _id, title: '', content }
  },
  updateArticleMeta: async () => ({}),
  renameDoc: async () => ({}),
  registerRecovery: () => undefined,
  uploadAttachment: async () => ({ path: '' }),
  getHealth: async () => ({ ok: true }),
  getArticle: async (id: string) => ({ id, path: id, title: 'Week3', content: CS.md }),
  search: async () => ({ items: [] }),
  deleteArticle: async () => undefined,
  getWorkspaceCurrent: async () => ({ root: '', articles: [] }),
  listTrash: async () => [],
  restoreTrash: async () => undefined,
  purgeTrash: async () => undefined,
  restoreHistory: async () => ({}),
  getHistory: async () => [],
}))

vi.mock('../common/PromptDialog', () => ({
  askConfirm: async () => true,
  askPrompt: async () => null,
  PromptHost: () => null,
  PromptRoot: (p: { children?: unknown }) => p.children,
}))

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

let root: Root | null = null
let container: HTMLDivElement

const ARTICLE: ArticleMeta = {
  id: 'Articles/Week3.md',
  path: 'Articles/Week3.md',
  title: 'Week3',
  content: '---\nke_version: 1\n---\n\n正文 dx 不变\n\n$dx + d_i$\n\n$$\ndM/dt\n$$\n',
}

beforeEach(() => {
  CS.requests = []
  CS.created = []
  CS.getMarkdownCalls = 0
  CS.md = ARTICLE.content
  CS.json = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '正文 dx 不变' }] },
      { type: 'paragraph', content: [{ type: 'math', attrs: { latex: 'dx + d_i' } }] },
      { type: 'mathBlock', attrs: { latex: 'dM/dt' } },
    ],
  }
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

async function mountEditorArea() {
  const EditorArea = (await import('./EditorArea')).default
  await act(async () => {
    root = createRoot(container)
    root.render(<EditorArea article={ARTICLE} loading={false} onNewArticle={() => undefined} onSaved={() => undefined} />)
  })
  await act(async () => { await Promise.resolve() })
}

/**
 * Focus §2.4：命令条可见动作组已收敛为 搜索 / ⋯更多 / 保存 / 导出，
 * 「微分 d 转正体」入口移入「⋯更多」菜单（portal 到 body）——先点开菜单再找按钮。
 */
async function openMoreMenu() {
  const more = [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '更多')
  expect(more, '命令条缺少「更多」菜单按钮').toBeTruthy()
  await act(async () => { (more as HTMLButtonElement).click() })
  await act(async () => { await Promise.resolve() })
}

/** 「更多」菜单经 Dropdown 的 portal 渲染到 document.body，需要在 body 范围内查找 */
async function findUprightDButton(): Promise<HTMLButtonElement> {
  const btn = [...document.body.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').includes('微分 d 转正体'))
  expect(btn, '「更多」菜单缺少「微分 d 转正体」按钮').toBeTruthy()
  return btn as HTMLButtonElement
}

describe('task-74 接线：工具条按钮 → 预览 → 另存，不动当前文档', () => {
  it('点击按钮出现对话框，且**不额外调用 getMarkdown()**（正文取已保存状态）', async () => {
    await mountEditorArea()
    const before = CS.getMarkdownCalls
    await openMoreMenu()
    const btn = await findUprightDButton()
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-ke-upright-summary]')?.textContent).toContain('将修改')
    expect(CS.getMarkdownCalls, '打开预览不得触发序列化').toBe(before)
  })

  it('另存：新文件 <原名>-正体d、当前文档 sha256 未变、无 PUT、不自动打开新文件', async () => {
    await mountEditorArea()
    await openMoreMenu()
    const btn = await findUprightDButton()
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })
    const save = container.querySelector('[data-ke-upright-save]') as HTMLButtonElement
    await act(async () => { save.click() })
    await act(async () => { await Promise.resolve() })

    // ① 只新建一个新文件，名字符合规格
    expect(CS.created.length).toBe(1)
    expect(CS.created[0].title).toBe('Week3-正体d')
    expect(CS.created[0].content, '只改微分 d').toContain('$\\mathrm{d}x + d_i$')
    expect(CS.created[0].content, '正文里的 dx 不动').toContain('正文 dx 不变')

    // ② 原件字节不变（入参 sha 相同）+ 没有对原文档的写入请求
    expect(sha256(CS.md)).toBe(sha256(ARTICLE.content))
    expect(CS.requests.filter((r) => r.method === 'PUT').length, '不得保存/写回原文档').toBe(0)

    // ③ 成功提示在对话框内；不自动关闭（更不自动打开新文件）
    expect(container.querySelector('[data-ke-upright-done]')?.textContent).toContain('原件未改动')
    expect(container.querySelector('[data-ke-upright-summary]'), '对话框不应自动关闭').toBeTruthy()
  })
})
