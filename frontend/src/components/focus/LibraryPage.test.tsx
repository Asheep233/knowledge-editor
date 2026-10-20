/**
 * Focus 知识库页（LibraryPage）行为测试。
 *
 * 覆盖 task-9 契约：
 *  A. 页头统计（由 getTree 派生「N 篇文档 · M 个文件夹 · K 个模块」）；
 *  B. 继续写作 hero：标题 + 正文摘要（剥 frontmatter）+ 元信息 + 打开最近文档；
 *  C. 最近编辑列表：行内容 / 点击打开 / 「清空」语义（成功刷新 + 失败可见提示）；
 *  D. 文件夹网格：由文件树派生（名称、篇数）+ 点击筛选最近编辑；
 *  E. 标签 chips：getTags 渲染 + 点击 getFilesByTag 展示该标签文档 + 再点收起；
 *  F. 加载 / 错误（可重试）/ 空态；
 *  G. 导入：.md → importMarkdown、.zip → importPackage，成功后打开导入文档；失败可见提示。
 *
 * 数据层 mock `api/client`（组件只依赖其中 8 个函数）。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import type { ArticleMeta, RecentDocument, TagInfo, TagFilesPayload, TreePayload } from '../../types'
import * as api from '../../api/client'
import { LibraryPage } from './LibraryPage'
import type { FocusPageProps } from './pageTypes'

vi.mock('../../api/client', () => ({
  clearRecentDocuments: vi.fn(),
  getArticle: vi.fn(),
  getFilesByTag: vi.fn(),
  getRecentDocuments: vi.fn(),
  getTags: vi.fn(),
  getTree: vi.fn(),
  importMarkdown: vi.fn(),
  importPackage: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TREE: TreePayload = {
  root: '/ws',
  articles: [
    'Articles/普通物理学/碰撞动力学.md',
    'Articles/普通物理学/Homework.md',
    'Articles/数学分析/可测函数.md',
  ],
  modules: ['Modules/质心系定义.md', 'Modules/两体约化质量.md'],
  attachments: { images: [], videos: [], files: [] },
}

const RECENTS: RecentDocument[] = [
  {
    rel_path: 'Articles/普通物理学/碰撞动力学.md',
    title: '碰撞动力学：质心系与动量',
    opened_at: '2026-10-20T14:06:00+08:00',
  },
  {
    rel_path: 'Articles/数学分析/可测函数.md',
    title: '测度论 · 第 3 讲：可测函数',
    opened_at: '2026-10-19T21:40:00+08:00',
  },
  {
    rel_path: 'Articles/普通物理学/Homework.md',
    title: 'Homework-Ch6',
    opened_at: '2026-10-16T22:41:00+08:00',
  },
]

const HERO_ARTICLE: ArticleMeta = {
  id: RECENTS[0].rel_path,
  path: RECENTS[0].rel_path,
  title: '碰撞动力学：质心系与动量',
  content:
    '---\ntitle: 碰撞动力学：质心系与动量\ntags: [物理, 习题]\n---\n\n两体碰撞的实验室系计算往往冗长；换到质心系之后，对称性会让动量与动能的关系立刻显形。本文整理第六周讲义的主线：先确认动量守恒，再引入质心系与约化质量。',
  word_count: 1918,
  updated_at: '2026-10-20T14:06:00+08:00',
  tags: ['物理', '习题'],
}

const TAGS: TagInfo[] = [
  { name: '物理', count: 1 },
  { name: '习题', count: 1 },
]

const TAG_FILES: TagFilesPayload = {
  tag: '物理',
  count: 1,
  files: [
    {
      id: 1,
      rel_path: 'Articles/普通物理学/碰撞动力学.md',
      kind: 'document',
      title: '碰撞动力学：质心系与动量',
      updated_at: '2026-10-20T14:06:00+08:00',
    },
  ],
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function baseProps(overrides: Partial<FocusPageProps> = {}): FocusPageProps {
  return {
    onNavigate: vi.fn(),
    onOpenArticle: vi.fn(),
    onNewArticle: vi.fn(),
    refreshToken: 0,
    ...overrides,
  }
}

/** 推进微任务 / effect 链（树 + 最近 + 标签 + hero 取正文是多级 then） */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function mount(overrides: Partial<FocusPageProps> = {}): Promise<FocusPageProps> {
  const props = baseProps(overrides)
  await act(async () => {
    root = createRoot(container!)
    root.render(<LibraryPage {...props} />)
  })
  await flush()
  return props
}

const $ = (selector: string) => container?.querySelector(selector) ?? null
const $all = (selector: string) => [...(container?.querySelectorAll(selector) ?? [])]
const byTestId = (id: string) => $('[data-testid="' + id + '"]')
const normalize = (text: string) => text.replace(/\s+/g, '')
const buttons = () => [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
const btnByText = (text: string) =>
  buttons().find((b) => normalize(b.textContent ?? '') === normalize(text))

async function clickEl(el: Element | null | undefined, label: string) {
  expect(el, `未找到可点击元素：${label}`).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function clickButton(text: string) {
  await clickEl(btnByText(text), `按钮「${text}」`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getTree).mockResolvedValue(TREE)
  vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: RECENTS })
  vi.mocked(api.getTags).mockResolvedValue({ tags: TAGS })
  vi.mocked(api.getArticle).mockResolvedValue(HERO_ARTICLE)
  vi.mocked(api.getFilesByTag).mockResolvedValue(TAG_FILES)
  vi.mocked(api.clearRecentDocuments).mockResolvedValue(undefined)
  vi.mocked(api.importMarkdown).mockResolvedValue({
    id: 'Articles/new.md',
    path: 'Articles/new.md',
    title: '新导入',
    created: true,
  })
  vi.mocked(api.importPackage).mockResolvedValue({
    id: 'Articles/pkg.md',
    path: 'Articles/pkg.md',
    title: '文档包',
    created: true,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
})

describe('LibraryPage · 页头与 hero', () => {
  it('统计副标题由 getTree 派生：3 篇文档 · 2 个文件夹 · 2 个模块', async () => {
    await mount()
    expect(container!.textContent).toContain('知识库')
    expect(container!.textContent).toContain('3 篇文档 · 2 个文件夹 · 2 个模块')
  })

  it('继续写作 hero：标题 + 正文摘要（剥 frontmatter）+ 元信息', async () => {
    await mount()
    const hero = byTestId('library-hero')
    expect(hero, '缺少继续写作 hero 卡').toBeTruthy()
    expect(hero!.textContent).toContain('碰撞动力学：质心系与动量')
    expect(hero!.textContent).toContain('两体碰撞的实验室系计算往往冗长')
    expect(hero!.textContent, '摘要不应包含 YAML frontmatter').not.toContain('tags: [物理, 习题]')
    expect(hero!.textContent).toContain('1,918 字')
    expect(hero!.textContent).toContain('物理 / 习题')
    expect(vi.mocked(api.getArticle)).toHaveBeenCalledWith(RECENTS[0].rel_path)
  })

  it('「继续写作」按钮 → onOpenArticle(最近文档路径)', async () => {
    const props = await mount()
    await clickButton('继续写作')
    expect(props.onOpenArticle).toHaveBeenCalledWith(RECENTS[0].rel_path)
  })
})

describe('LibraryPage · 最近编辑', () => {
  it('列表行展示 标题/所属路径；点击行打开文档', async () => {
    const props = await mount()
    const rows = $all('[data-testid="doc-row"]')
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('碰撞动力学：质心系与动量')
    expect(rows[0].textContent).toContain('普通物理学')
    expect(rows[1].textContent).toContain('数学分析')
    await clickEl(rows[1], '第二行最近文档')
    expect(props.onOpenArticle).toHaveBeenCalledWith(RECENTS[1].rel_path)
  })

  it('「清空」：调用 clearRecentDocuments 并刷新为空态', async () => {
    vi.mocked(api.getRecentDocuments)
      .mockResolvedValueOnce({ documents: RECENTS })
      .mockResolvedValueOnce({ documents: [] })
    await mount()
    expect($all('[data-testid="doc-row"]').length).toBe(3)
    await clickButton('清空')
    expect(api.clearRecentDocuments).toHaveBeenCalledTimes(1)
    expect(container!.textContent).toContain('暂无最近编辑的文档')
  })

  it('「清空」失败：给可见提示且不产生未处理 rejection', async () => {
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      seen.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      await mount()
      vi.mocked(api.clearRecentDocuments).mockRejectedValue(new Error('backend down'))
      await clickButton('清空')
      await flush()
      expect(seen, `出现未处理的 rejection：${String(seen[0])}`).toEqual([])
      expect(container!.textContent).toContain('清空最近文档失败')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('LibraryPage · 文件夹与标签', () => {
  it('文件夹网格：由树派生名称/篇数；点击筛选最近编辑，再点取消', async () => {
    await mount()
    const cards = $all('[data-testid="folder-card"]')
    expect(cards.length).toBe(2)
    const physics = cards.find((c) => c.textContent?.includes('普通物理学'))
    expect(physics, '缺少「普通物理学」文件夹卡').toBeTruthy()
    expect(physics!.textContent).toContain('2 篇')

    await clickEl(physics, '普通物理学文件夹卡')
    const toggled = $all('[data-testid="folder-card"]').find((c) => c.textContent?.includes('普通物理学'))
    expect(toggled!.getAttribute('aria-pressed')).toBe('true')
    expect($all('[data-testid="doc-row"]').length, '应按文件夹筛选出 2 篇').toBe(2)
    expect(container!.textContent).toContain('最近编辑 · 普通物理学')

    await clickEl(toggled, '再次点击取消筛选')
    expect($all('[data-testid="doc-row"]').length).toBe(3)
  })

  it('标签 chips：点击 getFilesByTag 展示该标签文档，再次点击收起', async () => {
    await mount()
    const chips = $all('[data-testid="tag-chip"]')
    expect(chips.length).toBe(2)
    await clickEl(chips[0], '标签「物理」')
    expect(api.getFilesByTag).toHaveBeenCalledWith('物理')
    const card = byTestId('library-tag-card')
    expect(card, '缺少标签筛选结果卡').toBeTruthy()
    expect(card!.textContent).toContain('碰撞动力学：质心系与动量')

    await clickEl($all('[data-testid="tag-chip"]')[0], '再次点击「物理」取消')
    expect(byTestId('library-tag-card')).toBeNull()
  })
})

describe('LibraryPage · 状态（加载/错误/空态）', () => {
  it('加载失败：错误态展示原因，点「重试」后恢复', async () => {
    vi.mocked(api.getTree).mockRejectedValueOnce(new Error('backend down'))
    await mount()
    expect(container!.textContent).toContain('知识库加载失败')
    expect(container!.textContent).toContain('backend down')

    await clickButton('重试')
    expect(container!.textContent).not.toContain('知识库加载失败')
    expect(container!.textContent).toContain('3 篇文档 · 2 个文件夹 · 2 个模块')
  })

  it('空态：无文档/无最近记录时展示空态 CTA', async () => {
    vi.mocked(api.getTree).mockResolvedValue({
      root: '/ws',
      articles: [],
      modules: [],
      attachments: { images: [], videos: [], files: [] },
    })
    vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: [] })
    vi.mocked(api.getTags).mockResolvedValue({ tags: [] })
    const props = await mount()
    expect(byTestId('library-empty'), '缺少空态卡').toBeTruthy()
    expect(container!.textContent).toContain('还没有文档')
    await clickButton('新建文档')
    expect(props.onNewArticle).toHaveBeenCalledTimes(1)
  })
})

describe('LibraryPage · 导入', () => {
  async function pickFile(name: string) {
    const input = byTestId('library-import-input') as HTMLInputElement | null
    expect(input, '缺少导入文件 input').toBeTruthy()
    const file = new File(['# 标题\n\n正文'], name, { type: 'text/markdown' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    return file
  }

  it('「导入」按钮触发文件选择；.md 走 importMarkdown 并打开导入的文档', async () => {
    const props = await mount()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    try {
      await clickButton('导入')
      expect(clickSpy).toHaveBeenCalledTimes(1)
    } finally {
      clickSpy.mockRestore()
    }
    const file = await pickFile('导入的笔记.md')
    expect(api.importMarkdown).toHaveBeenCalledWith(file)
    expect(api.importPackage).not.toHaveBeenCalled()
    expect(props.onOpenArticle).toHaveBeenCalledWith('Articles/new.md')
  })

  it('.zip 走 importPackage；失败时给出可见提示', async () => {
    await mount()
    vi.mocked(api.importPackage).mockRejectedValueOnce(new Error('zip 已损坏'))
    await pickFile('文档包.zip')
    expect(api.importPackage).toHaveBeenCalledTimes(1)
    expect(api.importMarkdown).not.toHaveBeenCalled()
    expect(container!.textContent).toContain('导入失败：zip 已损坏')
  })
})
