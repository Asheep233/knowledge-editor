/**
 * Focus 模块页（ModulesPage）行为测试。
 *
 * 覆盖：
 *  ① 列表渲染（名称/路径/版本/标签/更新时间/摘要）与副标题计数（模块/文件夹）；
 *  ② 加载中 / 加载失败 + 重试 / 空态 / 筛选无结果；
 *  ③ 标签 chips 与搜索框过滤；
 *  ④ 新建模块（createDocIn('Modules', title) + 刷新）/ 新建文件夹（createFolder）+ 失败反馈；
 *  ⑤ 只读预览弹层（getModule）：打开、内容渲染、Esc/关闭、跳转编辑器；
 *  ⑥ refreshToken 变化触发重新取数。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import * as api from '../../api/client'
import type { ArticleMeta, TreePayload } from '../../types'
import { ModulesPage, excerptOf, parseTags, splitMath } from './ModulesPage'
import type { FocusPageProps } from './pageTypes'

const promptMocks = vi.hoisted(() => ({
  askPrompt: vi.fn(async (_title?: string, _defaultValue?: string) => null as string | null),
  askConfirm: vi.fn(async (_msg: string, _opts?: unknown) => true as boolean),
}))
vi.mock('../common/PromptDialog', () => ({
  askPrompt: promptMocks.askPrompt,
  askConfirm: promptMocks.askConfirm,
  usePrompt: () => promptMocks.askPrompt,
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

vi.mock('../../api/client', () => ({
  listModules: vi.fn(),
  getTree: vi.fn(),
  getArticle: vi.fn(),
  getModule: vi.fn(),
  createDocIn: vi.fn(),
  createFolder: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MODULES: api.ModuleListPayload = {
  count: 2,
  modules: [
    { name: '质心系定义', path: 'Modules/理论力学/质心系定义.md', title: '质心系定义', tags: '定义', version: 2 },
    { name: '两体约化质量', path: 'Modules/理论力学/两体约化质量.md', title: '两体约化质量', tags: '', version: 1 },
  ],
}

function tree(modules: string[]): TreePayload {
  return { root: '/ws', articles: [], modules, attachments: { images: [], videos: [], files: [] } }
}

function article(path: string, content: string, size = 2048): ArticleMeta {
  return {
    id: path,
    path,
    title: path.split('/').pop() ?? path,
    content,
    updated_at: '2026-10-12T03:00:00Z',
    created_at: '2026-10-01T03:00:00Z',
    size,
  }
}

let root: Root | null = null
let container: HTMLDivElement

function $<T extends Element = Element>(sel: string): T | null {
  return container.querySelector<T>(sel)
}
function byTestId(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}
function text(): string {
  return container.textContent ?? ''
}
function allButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}
function buttonByText(label: string): HTMLButtonElement | undefined {
  return allButtons().find((b) => (b.textContent ?? '').replace(/\s+/g, '').includes(label.replace(/\s+/g, '')))
}

/** 清空微任务 + 宏任务队列（两阶段取数：模块列表 → 逐模块元数据） */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

async function mount(overrides: Partial<FocusPageProps> = {}): Promise<FocusPageProps> {
  const props: FocusPageProps = {
    onNavigate: vi.fn(),
    onOpenArticle: vi.fn(),
    onNewArticle: vi.fn(),
    refreshToken: 0,
    ...overrides,
  }
  await act(async () => {
    root = createRoot(container)
    root.render(<ModulesPage {...props} />)
  })
  await settle()
  return props
}

async function rerender(props: FocusPageProps): Promise<void> {
  await act(async () => {
    root!.render(<ModulesPage {...props} />)
  })
  await settle()
}

async function click(el: Element | null | undefined, label: string): Promise<void> {
  expect(el, `未找到可点击元素：${label}`).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await settle()
}

async function typeSearch(value: string): Promise<void> {
  const input = $<HTMLInputElement>('input[aria-label="搜索模块"]')
  expect(input, '缺少搜索框').toBeTruthy()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  promptMocks.askPrompt.mockResolvedValue(null)
  promptMocks.askConfirm.mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.mocked(api.listModules).mockResolvedValue(MODULES)
  vi.mocked(api.getTree).mockResolvedValue(
    tree(['Modules/理论力学/', 'Modules/理论力学/质心系定义.md', 'Modules/理论力学/两体约化质量.md']),
  )
  vi.mocked(api.getArticle).mockImplementation(async (path: string) =>
    article(path, `---\ntitle: ${path}\n---\n\n# 标题\n\n这是 ${path} 的正文摘要，总动量 $\\mathbf{P}=0$ 守恒。`),
  )
  vi.mocked(api.getModule).mockResolvedValue({
    name: '质心系定义',
    path: 'Modules/理论力学/质心系定义.md',
    meta: {},
    content: '# 质心系定义\n\n总动量 $\\mathbf{P}=0$ 的惯性系。',
  })
  vi.mocked(api.createDocIn).mockResolvedValue({ id: 'Modules/新模块.md', path: 'Modules/新模块.md' })
  vi.mocked(api.createFolder).mockResolvedValue({ path: 'Modules/新文件夹', created: true })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

describe('ModulesPage · 数据渲染', () => {
  it('渲染模块卡片：名称/路径/版本/标签/更新时间/摘要，副标题统计模块数与文件夹数', async () => {
    await mount()
    expect(api.listModules).toHaveBeenCalledTimes(1)
    expect(api.getTree).toHaveBeenCalledTimes(1)
    // 副标题
    expect(text()).toContain('2 个模块')
    expect(text()).toContain('1 个文件夹')
    // 卡片
    expect(byTestId('modules-grid')).toBeTruthy()
    expect(byTestId('module-card-Modules/理论力学/质心系定义.md')).toBeTruthy()
    expect(byTestId('module-card-Modules/理论力学/两体约化质量.md')).toBeTruthy()
    expect(text()).toContain('质心系定义')
    expect(text()).toContain('Modules/理论力学/质心系定义.md')
    expect(text()).toContain('v2')
    expect(text()).toContain('v1')
    expect(text()).toContain('定义')
    // 更新时间（getArticle 补全）→ 卡片顶部「理论力学 · 10 月 12 日」（与参考稿空格风格一致）
    expect(text()).toContain('10 月 12 日')
    // 摘要 + 行内公式经 KaTeX 渲染（参考稿 auto-render 效果）
    expect(text()).toContain('正文摘要')
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0)
    // 大小
    expect(text()).toContain('2.0 KB')
    // 标签 chips 过滤行（全部 + 定义）
    expect(buttonByText('全部')).toBeTruthy()
  })

  it('getArticle 补全失败时仍展示基础卡片（不阻塞列表）', async () => {
    vi.mocked(api.getArticle).mockRejectedValue(new Error('boom'))
    await mount()
    expect(byTestId('module-card-Modules/理论力学/质心系定义.md')).toBeTruthy()
    expect(text()).toContain('质心系定义')
  })

  it('getTree 失败时用模块路径推导文件夹数，不影响列表', async () => {
    vi.mocked(api.getTree).mockRejectedValue(new Error('tree down'))
    await mount()
    expect(byTestId('modules-grid')).toBeTruthy()
    expect(text()).toContain('2 个模块')
    expect(text()).toContain('1 个文件夹')
  })

  it('refreshToken 变化触发重新取数', async () => {
    const props = await mount()
    expect(api.listModules).toHaveBeenCalledTimes(1)
    await rerender({ ...props, refreshToken: 1 })
    expect(api.listModules).toHaveBeenCalledTimes(2)
  })
})

describe('ModulesPage · 加载/错误/空态', () => {
  it('加载中显示占位文案', async () => {
    let resolveList: ((v: api.ModuleListPayload) => void) | null = null
    vi.mocked(api.listModules).mockImplementation(
      () => new Promise<api.ModuleListPayload>((resolve) => {
        resolveList = resolve
      }),
    )
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ModulesPage onNavigate={vi.fn()} onOpenArticle={vi.fn()} onNewArticle={vi.fn()} refreshToken={0} />,
      )
    })
    expect(byTestId('loading-state')?.textContent).toContain('加载中')
    await act(async () => {
      resolveList?.(MODULES)
    })
    await settle()
    expect(byTestId('modules-grid')).toBeTruthy()
  })

  it('加载失败显示错误态，点「重试」后恢复列表', async () => {
    vi.mocked(api.listModules).mockRejectedValueOnce(new Error('backend down'))
    await mount()
    expect(byTestId('error-state')?.textContent).toContain('模块加载失败')
    await click(buttonByText('重试'), '重试按钮')
    expect(byTestId('modules-grid')).toBeTruthy()
    expect(api.listModules).toHaveBeenCalledTimes(2)
  })

  it('空态：没有模块时显示引导与新建入口', async () => {
    vi.mocked(api.listModules).mockResolvedValue({ count: 0, modules: [] })
    vi.mocked(api.getTree).mockResolvedValue(tree([]))
    await mount()
    expect(byTestId('empty-state')?.textContent).toContain('还没有模块')
    expect(byTestId('new-module')).toBeTruthy()
  })
})

describe('ModulesPage · 筛选', () => {
  it('搜索框按标题/路径过滤；清除后恢复', async () => {
    await mount()
    await typeSearch('两体')
    expect(byTestId('module-card-Modules/理论力学/两体约化质量.md')).toBeTruthy()
    expect(byTestId('module-card-Modules/理论力学/质心系定义.md')).toBeNull()
    await typeSearch('')
    expect(byTestId('module-card-Modules/理论力学/质心系定义.md')).toBeTruthy()
  })

  it('标签 chip 过滤；无匹配显示空结果态', async () => {
    await mount()
    const tagChip = allButtons().find((b) => (b.textContent ?? '').trim() === '定义')
    await click(tagChip, '标签 chip「定义」')
    expect(byTestId('module-card-Modules/理论力学/质心系定义.md')).toBeTruthy()
    expect(byTestId('module-card-Modules/理论力学/两体约化质量.md')).toBeNull()
    await typeSearch('绝对不存在xyz')
    expect(byTestId('empty-state')?.textContent).toContain('没有匹配的模块')
  })
})

describe('ModulesPage · 新建', () => {
  it('新建模块：askPrompt 输入名称 → createDocIn(Modules, title) → 刷新列表 + 成功提示', async () => {
    promptMocks.askPrompt.mockResolvedValue('新模块')
    await mount()
    await click(byTestId('new-module'), '新建模块按钮')
    expect(api.createDocIn).toHaveBeenCalledWith('Modules', '新模块')
    expect(api.listModules).toHaveBeenCalledTimes(2)
    expect(byTestId('page-status')?.textContent).toContain('已创建模块：新模块')
  })

  it('新建模块取消（askPrompt 返回 null）不创建', async () => {
    promptMocks.askPrompt.mockResolvedValue(null)
    await mount()
    await click(byTestId('new-module'), '新建模块按钮')
    expect(api.createDocIn).not.toHaveBeenCalled()
    expect(byTestId('page-status')).toBeNull()
  })

  it('新建模块失败：提示错误信息且不刷新列表', async () => {
    promptMocks.askPrompt.mockResolvedValue('新模块')
    vi.mocked(api.createDocIn).mockRejectedValue(new Error('409 已存在同名文档'))
    await mount()
    await click(byTestId('new-module'), '新建模块按钮')
    expect(byTestId('page-status')?.textContent).toContain('新建模块失败')
    expect(api.listModules).toHaveBeenCalledTimes(1)
  })

  it('新建文件夹：createFolder(Modules/<name>) 并刷新', async () => {
    promptMocks.askPrompt.mockResolvedValue('新文件夹')
    await mount()
    await click(buttonByText('新建文件夹'), '新建文件夹按钮')
    expect(api.createFolder).toHaveBeenCalledWith('Modules/新文件夹')
    expect(api.listModules).toHaveBeenCalledTimes(2)
    expect(byTestId('page-status')?.textContent).toContain('已创建文件夹')
  })

  it('新建文件夹名含 / 时拒绝并提示', async () => {
    promptMocks.askPrompt.mockResolvedValue('a/b')
    await mount()
    await click(buttonByText('新建文件夹'), '新建文件夹按钮')
    expect(api.createFolder).not.toHaveBeenCalled()
    expect(byTestId('page-status')?.textContent).toContain('不能包含')
  })
})

describe('ModulesPage · 只读预览', () => {
  it('点击卡片打开预览弹层（getModule）→ 展示原文 → 关闭', async () => {
    await mount()
    await click(byTestId('module-card-Modules/理论力学/质心系定义.md'), '模块卡片')
    expect(api.getModule).toHaveBeenCalledWith('Modules/理论力学/质心系定义.md')
    const dialog = byTestId('module-preview')
    expect(dialog).toBeTruthy()
    expect(dialog?.textContent).toContain('质心系定义')
    expect(dialog?.textContent).toContain('总动量')
    await click(buttonByText('关闭'), '关闭按钮')
    expect(byTestId('module-preview')).toBeNull()
  })

  it('预览弹层内「在编辑器中打开」→ onOpenArticle(path) 并关闭', async () => {
    const props = await mount()
    await click(byTestId('module-card-Modules/理论力学/质心系定义.md'), '模块卡片')
    await click(buttonByText('在编辑器中打开'), '在编辑器中打开')
    expect(props.onOpenArticle).toHaveBeenCalledWith('Modules/理论力学/质心系定义.md')
    expect(byTestId('module-preview')).toBeNull()
  })

  it('预览内容加载失败：弹层内给出错误提示，不崩溃', async () => {
    vi.mocked(api.getModule).mockRejectedValue(new Error('404'))
    await mount()
    await click(byTestId('module-card-Modules/理论力学/质心系定义.md'), '模块卡片')
    expect(byTestId('module-preview')?.textContent).toContain('模块内容加载失败')
  })

  it('Esc 关闭预览', async () => {
    await mount()
    await click(byTestId('module-card-Modules/理论力学/质心系定义.md'), '模块卡片')
    expect(byTestId('module-preview')).toBeTruthy()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    expect(byTestId('module-preview')).toBeNull()
  })
})

describe('ModulesPage · 纯函数', () => {
  it('excerptOf：去 frontmatter/Markdown 标记并截断；数学片段原样保留', () => {
    const s = excerptOf('---\ntitle: 甲\n---\n\n# 标题\n\n**加粗**与[链接](x) 文字。')
    expect(s).toBe('标题 加粗与链接 文字。')
    expect(excerptOf(`正文${'长'.repeat(200)}`).length).toBe(120)
    // 行内公式里的下划线/星号不当作 Markdown 清理
    expect(excerptOf('总动量 $\\mathbf{P}=\\sum_i m_i\\mathbf{v}_i$ 守恒')).toBe('总动量 $\\mathbf{P}=\\sum_i m_i\\mathbf{v}_i$ 守恒')
    // 截断切在公式中间时丢弃未闭合片段
    expect(excerptOf(`$abc${'x'.repeat(130)}`)).not.toMatch(/\$$/)
  })

  it('splitMath：切分普通文本与行内/块级公式', () => {
    expect(splitMath('前 $a+b$ 后')).toEqual([
      { math: false, text: '前 ' },
      { math: true, text: 'a+b' },
      { math: false, text: ' 后' },
    ])
    expect(splitMath('$$E=mc^2$$')).toEqual([{ math: true, text: 'E=mc^2' }])
    expect(splitMath('无公式')).toEqual([{ math: false, text: '无公式' }])
  })

  it('parseTags：兼容字符串/数组/空值', () => {
    expect(parseTags('定义, 公式')).toEqual(['定义', '公式'])
    expect(parseTags('[定义, 公式]')).toEqual(['定义', '公式'])
    expect(parseTags(['定义', '定理'])).toEqual(['定义', '定理'])
    expect(parseTags(undefined)).toEqual([])
  })
})
