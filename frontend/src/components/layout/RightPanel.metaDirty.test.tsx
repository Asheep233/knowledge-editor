/**
 * F4：外部元信息更新不得静默丢弃用户正在编辑的属性表单。
 *
 * 为什么另建文件：`RightPanel.test.tsx` 正被并发队友改动/回滚（本轮实测我的追加被整段回滚）；
 * 本文件自带替身与脚手架，独立成立。
 *
 * 原缺陷（RightPanel.tsx「切换文档时同步元信息表单」的 useEffect）：依赖
 * `[article?.id, article?.title, article?.tags]`，只要 title/tags 变化就无条件
 * `setTitle/setTags` —— 用户在右栏改了标题（未点保存）时，只要文档元信息被外部刷新
 * （编辑器页眉改标题、保存回包、文件系统事件），输入就被**静默覆盖**，
 * 用户以为已改好的内容消失且没有任何提示。
 *
 * 修复语义：
 *  - 非 dirty：照旧同步（外部更新即时可见）；
 *  - dirty：**保留用户输入** + 显示「文档已更新，当前编辑未保存」+「放弃并刷新」出口；
 *  - 切档（id 变化）：无条件重置（新文档不存在「未提交修改」）；
 *  - 保存按钮语义不变：dirty 时才出现，点了保存用户当前输入。
 */
import { act, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import RightPanel from './RightPanel'
import * as api from '../../api/client'
import type { ArticleMeta } from '../../types'

vi.mock('../../api/client', () => ({
  attachmentUrl: (rel: string) => `/api/attachments/${rel}`,
  deleteAttachment: vi.fn(),
  listAttachments: vi.fn(),
  listOrphans: vi.fn(),
  updateArticleMeta: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mkArticle(): ArticleMeta {
  return {
    id: 'Articles/主文档.md',
    path: 'Articles/主文档.md',
    title: '主文档',
    content: '# 一级标题\n\n## 二级标题\n\n正文',
    created_at: '2026-09-14T08:30:00+08:00',
    updated_at: '2026-09-15T10:00:00+08:00',
    size: 2048,
    word_count: 1234,
    tags: ['标签A'],
    meta: { ke_version: 3 },
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

const NOTICE = '文档已更新，当前编辑未保存'

beforeEach(() => {
  vi.clearAllMocks()
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
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function render(over: Partial<ComponentProps<typeof RightPanel>> = {}): Promise<void> {
  root = createRoot(container!)
  const props: ComponentProps<typeof RightPanel> = { article: mkArticle(), ...over }
  await act(async () => {
    root!.render(<RightPanel {...props} />)
  })
  await settle()
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
  })
  await settle()
}

function findByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
}

async function typeTitle(v: string): Promise<void> {
  const input = container!.querySelector('input') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

async function rerenderArticle(article: ArticleMeta): Promise<void> {
  await act(async () => {
    root!.render(<RightPanel article={article} />)
  })
  await settle()
}

const titleInput = (): HTMLInputElement => container!.querySelector('input') as HTMLInputElement

describe('F4 — 外部元信息更新 vs 未提交编辑', () => {
  it('dirty 时外部改标题：保留用户输入 + 可见提示（旧实现静默覆盖）', async () => {
    await render()
    await typeTitle('我正在改的标题')
    expect(findByText('保存属性'), '输入后应进入 dirty（保存按钮出现）').toBeTruthy()

    // 外部更新（编辑器页眉保存 / 保存回包 / fs 事件都会走到这里）
    await rerenderArticle({ ...mkArticle(), title: '外部改过的标题' })

    expect(titleInput().value, '用户未保存的输入被外部更新静默覆盖').toBe('我正在改的标题')
    expect(container!.textContent, '缺少「未保存」可见提示').toContain(NOTICE)
    expect(findByText('放弃并刷新'), '缺少「放弃并刷新」出口').toBeTruthy()
  })

  it('dirty 时外部改标签：保留用户标签 + 提示', async () => {
    await render()
    await typeTitle('我的标题')
    await rerenderArticle({ ...mkArticle(), tags: ['外部新标签'] })

    expect(titleInput().value).toBe('我的标题')
    expect(container!.textContent).toContain(NOTICE)
    expect(container!.textContent, '用户标签被覆盖').toContain('#标签A')
    expect(container!.textContent).not.toContain('#外部新标签')
  })

  it('非 dirty 时外部更新：照旧同步表单，不显示提示', async () => {
    await render()
    await rerenderArticle({ ...mkArticle(), title: '外部改过的标题', tags: ['外部新标签'] })

    expect(titleInput().value).toBe('外部改过的标题')
    expect(container!.textContent).toContain('#外部新标签')
    expect(container!.textContent).not.toContain(NOTICE)
    expect(findByText('放弃并刷新')).toBeUndefined()
  })

  it('仅用户自己输入（article 未变）不得误报「文档已更新」', async () => {
    await render()
    await typeTitle('只改了一个字')
    expect(container!.textContent).not.toContain(NOTICE)
    expect(findByText('保存属性')).toBeTruthy()
  })

  it('同标题新数组引用（内容相同）不得误报「外部更新」', async () => {
    await render()
    await typeTitle('我的标题')
    await rerenderArticle({ ...mkArticle(), tags: [...(mkArticle().tags ?? [])] })
    expect(container!.textContent).not.toContain(NOTICE)
    expect(titleInput().value).toBe('我的标题')
  })

  it('「放弃并刷新」：丢弃本地输入、采用外部值、提示消失、保存按钮消失', async () => {
    await render()
    await typeTitle('将被放弃的标题')
    await rerenderArticle({ ...mkArticle(), title: '外部改过的标题' })
    expect(container!.textContent).toContain(NOTICE)

    await click(findByText('放弃并刷新')!)

    expect(titleInput().value).toBe('外部改过的标题')
    expect(container!.textContent).not.toContain(NOTICE)
    expect(findByText('保存属性'), '放弃后不应仍处于 dirty').toBeUndefined()
  })

  it('切档（id 变化）：无未提交修改语义 → 无条件重置为新媒体，不提示', async () => {
    await render()
    await typeTitle('旧文档的未保存标题')
    await rerenderArticle({ ...mkArticle(), id: 'Articles/另一篇.md', path: 'Articles/另一篇.md', title: '另一篇' })

    expect(titleInput().value).toBe('另一篇')
    expect(container!.textContent).not.toContain(NOTICE)
    expect(findByText('保存属性'), '切档后不应残留上一篇的 dirty 状态').toBeUndefined()
  })

  it('保存按钮语义不变：dirty 时保存的是用户当前输入', async () => {
    vi.mocked(api.updateArticleMeta).mockResolvedValue({ ...mkArticle(), title: '我改的标题' })
    await render()
    await typeTitle('我改的标题')

    await click(findByText('保存属性')!)

    expect(vi.mocked(api.updateArticleMeta)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.updateArticleMeta).mock.calls[0][0]).toBe('Articles/主文档.md')
    expect(vi.mocked(api.updateArticleMeta).mock.calls[0][1]).toMatchObject({ title: '我改的标题' })
  })

  it('保存成功后父组件回写同名标题：不得误报「文档已更新」（自愈路径）', async () => {
    const saved = { ...mkArticle(), title: '我改的标题' }
    vi.mocked(api.updateArticleMeta).mockResolvedValue(saved)
    await render()
    await typeTitle('我改的标题')
    await click(findByText('保存属性')!)
    // App 侧 onMetaUpdate 回写 article（本用例省略 onMetaUpdate，直接模拟父组件回写）
    await rerenderArticle(saved)

    expect(titleInput().value).toBe('我改的标题')
    expect(container!.textContent).not.toContain(NOTICE)
  })

  it('F5 附带：标签输入组合输入中按 Enter 不加标签（IME 上屏不得误触发）', async () => {
    await render()
    const tagInput = container!.querySelectorAll('input')[1] as HTMLInputElement
    expect(tagInput, '未找到标签输入框').toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(tagInput, '新标签')
      tagInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()

    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'isComposing', { value: true })
    await act(async () => {
      tagInput.dispatchEvent(ev)
    })
    await settle()
    expect(container!.textContent, '组合输入中的回车把半截输入加成了标签').not.toContain('#新标签')

    // 非组合态：正常加标签（非空对照）
    await act(async () => {
      tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    await settle()
    expect(container!.textContent).toContain('#新标签')
  })
})
