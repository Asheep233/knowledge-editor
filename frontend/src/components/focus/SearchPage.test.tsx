/**
 * Focus 搜索页（SearchPage）行为测试。
 *
 * 覆盖 task-9 契约：
 *  A. 初始空态 + 搜索框自动聚焦（未输入不请求）；
 *  B. 300ms 防抖 + Enter 立即检索 + Esc 清空；
 *  C. 结果：分组标题 / 标题 / 路径 / 类型 / 高亮摘要（剥 frontmatter）/ 底部结果数说明；
 *  D. 文档结果点击 onOpenArticle；模块 / 附件只读展示；
 *  E. 筛选 chips（全部 / 文档 / 模块 / 附件）按返回 kind 过滤；
 *  F. 加载 / 错误（可重试）/ 无结果空态（与「未输入」空态分离）；
 *  G. 重建索引（rebuildIndex + 重跑当前查询 + 统计提示 / 失败提示）。
 *
 * 数据层只 mock `search` 与 `rebuildIndex`（组件唯一的两个 API 依赖）。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import type { SearchPayload, SearchResult } from '../../types'
import * as api from '../../api/client'
import { SearchPage } from './SearchPage'
import type { FocusPageProps } from './pageTypes'

vi.mock('../../api/client', () => ({
  rebuildIndex: vi.fn(),
  search: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RESULTS: SearchResult[] = [
  {
    id: 1,
    rel_path: 'Articles/普通物理学/碰撞动力学.md',
    kind: 'document',
    title: '碰撞动力学：质心系与动量',
    updated_at: '2026-10-20T14:06:00+08:00',
    snippet:
      '---\ntitle: 碰撞动力学：质心系与动量\ntags: [物理, 习题]\n---\n\n换到质心系之后，对称性会让动量与动能的关系立刻显形。定义质心位置与质心速度。',
  },
  {
    id: 2,
    rel_path: 'Modules/理论力学/质心系定义.md',
    kind: 'module',
    title: '质心系定义',
    updated_at: '2026-10-18T09:00:00+08:00',
    snippet: '对质点系，总动量 P = Σ m_i v_i。若存在惯性系使 P = 0，该系称为质心系。',
  },
  {
    id: 3,
    rel_path: 'Attachments/images/质心系.png',
    kind: 'attachment',
    title: '质心系.png',
    updated_at: '2026-10-17T09:00:00+08:00',
  },
]

const PAYLOAD: SearchPayload = { query: '质心', count: 3, results: RESULTS }

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

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function mount(overrides: Partial<FocusPageProps> = {}): Promise<FocusPageProps> {
  const props = baseProps(overrides)
  await act(async () => {
    root = createRoot(container!)
    root.render(<SearchPage {...props} />)
  })
  await flush()
  return props
}

const $ = (selector: string) => container?.querySelector(selector) ?? null
const $all = (selector: string) => [...(container?.querySelectorAll(selector) ?? [])]
const byTestId = (id: string) => $('[data-testid="' + id + '"]')
const input = () => $('input[aria-label="搜索"]') as HTMLInputElement | null
const normalize = (text: string) => text.replace(/\s+/g, '')
const buttons = () => [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
const btnByText = (text: string) => buttons().find((b) => normalize(b.textContent ?? '') === normalize(text))

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

async function typeQuery(value: string) {
  const el = input()
  expect(el, '缺少搜索输入框').toBeTruthy()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, value)
    el!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

async function pressEnter() {
  const el = input()
  expect(el, '缺少搜索输入框').toBeTruthy()
  await act(async () => {
    el!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  await flush()
}

/** 输入 + Enter（跳过防抖，立即检索） */
async function searchNow(query: string) {
  await typeQuery(query)
  await pressEnter()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.search).mockResolvedValue(PAYLOAD)
  vi.mocked(api.rebuildIndex).mockResolvedValue({
    status: 'ok',
    stats: { document: 3, module: 2, attachment: 1 },
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

describe('SearchPage · 空态与防抖', () => {
  it('初始空态：搜索框自动聚焦，未输入时不请求搜索', async () => {
    await mount()
    const el = input()
    expect(el).toBeTruthy()
    expect(document.activeElement, '搜索框应自动聚焦').toBe(el)
    expect(api.search).not.toHaveBeenCalled()
    expect(byTestId('search-idle')).toBeTruthy()
    expect(container!.textContent).toContain('输入关键词开始搜索')
  })

  it('300ms 防抖：299ms 内不请求，满 300ms 才检索', async () => {
    vi.useFakeTimers()
    try {
      await mount()
      await typeQuery('质心')
      expect(api.search).not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(299)
      })
      expect(api.search, '299ms 时不应已发请求').not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      await flush()
      expect(api.search).toHaveBeenCalledWith('质心')
      expect($all('[data-testid="search-result"]').length).toBe(3)
    } finally {
      await act(async () => {
        root?.unmount()
      })
      root = null
      container?.remove()
      container = null
      vi.useRealTimers()
    }
  })
})

describe('SearchPage · 结果渲染与交互', () => {
  it('Enter 立即检索：标题/路径/类型/高亮摘要 + 底部结果数说明', async () => {
    await mount()
    await typeQuery('质心')
    await pressEnter()
    expect(api.search).toHaveBeenCalledWith('质心')

    const cards = $all('[data-testid="search-result"]')
    expect(cards.length).toBe(3)
    expect(cards[0].getAttribute('data-kind')).toBe('document')
    expect(cards[1].getAttribute('data-kind')).toBe('module')
    expect(cards[2].getAttribute('data-kind')).toBe('attachment')

    expect(cards[0].textContent).toContain('碰撞动力学：质心系与动量')
    expect(cards[0].textContent).toContain('Articles/普通物理学/碰撞动力学.md')
    expect(cards[0].textContent, '摘要不应包含 frontmatter').not.toContain('tags:')
    const mark = cards[0].querySelector('mark')
    expect(mark, '摘要/标题应高亮命中词').toBeTruthy()
    expect(mark!.textContent).toBe('质心')

    expect(byTestId('search-footnote')!.textContent).toContain('共 3 条')
    expect(byTestId('search-footnote')!.textContent).toContain('单次上限 20 条')
  })

  it('点击文档结果 → onOpenArticle；模块 / 附件只读不跳转', async () => {
    const props = await mount()
    await searchNow('质心')
    const cards = $all('[data-testid="search-result"]')

    await clickEl(cards[0], '文档结果')
    expect(props.onOpenArticle).toHaveBeenCalledWith(RESULTS[0].rel_path)

    expect(cards[1].tagName, '模块结果应为只读容器').toBe('DIV')
    expect(cards[2].tagName, '附件结果应为只读容器').toBe('DIV')
    await clickEl(cards[1], '模块结果（只读）')
    await clickEl(cards[2], '附件结果（只读）')
    expect(props.onOpenArticle).toHaveBeenCalledTimes(1)
  })

  it('结果数超过上限：底部说明「显示前 N 条 · 共 M 条」', async () => {
    vi.mocked(api.search).mockResolvedValue({ query: '质心', count: 24, results: RESULTS })
    await mount()
    await searchNow('质心')
    expect(byTestId('search-footnote')!.textContent).toContain('显示前 3 条 · 共 24 条')
  })
})

describe('SearchPage · 类型筛选', () => {
  it('chips 展示各类型数量，点击按 kind 过滤，点「全部」恢复', async () => {
    await mount()
    await searchNow('质心')
    const chips = $all('[data-testid="kind-chip"]')
    expect(chips.length, '应有 全部/文档/模块/附件 四个筛选').toBe(4)
    expect(chips.map((c) => normalize(c.textContent ?? ''))).toEqual(['全部3', '文档1', '模块1', '附件1'])

    await clickEl(chips[2], '筛选「模块」')
    const filtered = $all('[data-testid="search-result"]')
    expect(filtered.length).toBe(1)
    expect(filtered[0].getAttribute('data-kind')).toBe('module')

    await clickEl($all('[data-testid="kind-chip"]')[0], '筛选「全部」')
    expect($all('[data-testid="search-result"]').length).toBe(3)
  })
})

describe('SearchPage · 状态（无结果/错误/Esc）', () => {
  it('无结果空态与「未输入」空态分离', async () => {
    vi.mocked(api.search).mockResolvedValue({ query: '不存在', count: 0, results: [] })
    await mount()
    await searchNow('不存在')
    expect(byTestId('search-empty'), '缺少无结果空态').toBeTruthy()
    expect(container!.textContent).toContain('没有找到与「不存在」相关的内容')
    expect(byTestId('search-idle')).toBeNull()
    expect(byTestId('search-results')).toBeNull()
  })

  it('搜索失败：错误态可重试，重试成功后展示结果', async () => {
    vi.mocked(api.search).mockRejectedValueOnce(new Error('index down'))
    await mount()
    await searchNow('质心')
    expect(byTestId('search-error'), '缺少搜索错误态').toBeTruthy()
    expect(container!.textContent).toContain('index down')

    await clickButton('重试')
    expect(byTestId('search-error')).toBeNull()
    expect($all('[data-testid="search-result"]').length).toBe(3)
  })

  it('Esc 清空输入并回到空态', async () => {
    await mount()
    await searchNow('质心')
    expect($all('[data-testid="search-result"]').length).toBe(3)

    await act(async () => {
      input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await flush()
    expect(input()!.value).toBe('')
    expect(byTestId('search-idle')).toBeTruthy()
  })
})

describe('SearchPage · 重建索引', () => {
  it('重建索引：调用 rebuildIndex，完成后重跑当前查询并提示统计', async () => {
    await mount()
    await searchNow('质心')
    expect(api.search).toHaveBeenCalledTimes(1)

    await clickButton('重建索引')
    expect(api.rebuildIndex).toHaveBeenCalledTimes(1)
    expect(api.search, '重建后应重跑当前查询').toHaveBeenCalledTimes(2)
    expect(container!.textContent).toContain('索引已重建：3 篇文档 · 2 个模块 · 1 个附件')
  })

  it('重建索引失败：给出可见提示', async () => {
    vi.mocked(api.rebuildIndex).mockRejectedValueOnce(new Error('index locked'))
    await mount()
    await clickButton('重建索引')
    expect(container!.textContent).toContain('重建索引失败：index locked')
  })
})
