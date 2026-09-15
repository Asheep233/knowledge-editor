/** RightPanel「只放文档属性」净身回归（task-12）。
 *
 * 主理人裁决：附件能力的家 = 左栏 LeftSidebar 的「附件」区；右栏只放文档属性。
 * 因此本套件只断言两件事：
 *  ① 负向不变量：右栏**不再渲染任何附件小节**（无「附件」字样、无表头/行/详情/孤儿入口），
 *     且不再持有附件数据源（listAttachments/listOrphans/deleteAttachment 零调用）；
 *  ② 右栏既有能力未受影响：属性字段、大纲小节（可折叠）、历史快照卡片、收起右栏按钮。
 *
 * 附件区的等价用例全部迁至 LeftSidebar.test.tsx（见该文件「附件区（task-12 迁入）」describe）。
 * 组件只读展示（点击仅跳转回调），不写回任何文档内容。
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
let container: HTMLDivElement

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
  container.remove()
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function render(over: Partial<ComponentProps<typeof RightPanel>> = {}): Promise<void> {
  root = createRoot(container)
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
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
}

describe('RightPanel — 右栏零附件（task-12 净身）', () => {
  it('不渲染任何附件小节：无「附件」字样、无表头/行/详情/孤儿区块', async () => {
    await render()

    expect(container.textContent ?? '').not.toContain('附件')
    expect(container.querySelector('[data-testid="attachments-toggle"]')).toBeNull()
    expect(container.querySelector('[data-testid="orphan-badge"]')).toBeNull()
    expect(container.querySelector('[data-testid="orphans-block"]')).toBeNull()
    expect(container.querySelectorAll('[data-attachment]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-attachment-row]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-attachment-detail]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-ref-doc]')).toHaveLength(0)
  })

  it('不发起任何附件相关请求（右栏已不再持有附件数据源）', async () => {
    await render()

    expect(vi.mocked(api.listAttachments)).not.toHaveBeenCalled()
    expect(vi.mocked(api.listOrphans)).not.toHaveBeenCalled()
    expect(vi.mocked(api.deleteAttachment)).not.toHaveBeenCalled()

    // 非空证明：替身本身可被调用（避免「零调用」是替身失效造成的假绿）
    vi.mocked(api.listAttachments).mockResolvedValue({ count: 0, attachments: [] })
    await vi.mocked(api.listAttachments)()
    expect(vi.mocked(api.listAttachments)).toHaveBeenCalledTimes(1)
  })

  it('无文档（article=null）时也无附件入口，只显示「未打开文档」', async () => {
    await render({ article: null })

    expect(container.textContent).toContain('未打开文档')
    expect(container.textContent ?? '').not.toContain('附件')
  })
})

describe('RightPanel — 保留的右栏能力（属性 / 大纲 / 历史快照 / 收起）', () => {
  it('文档属性字段仍在：标题/标签/类型/字数/创建/修改/大小/保存位置/KE 版本', async () => {
    await render()

    const t = container.textContent ?? ''
    for (const label of ['标题', '标签', '类型', '字数', '创建时间', '修改时间', '大小', '保存位置', 'KE 版本']) {
      expect(t, `属性字段缺失：${label}`).toContain(label)
    }
    expect(t).toContain('1234') // 字数
    expect(t).toContain('2.0 KB') // 大小
    expect(t).toContain('Articles/主文档.md') // 保存位置
    expect(t).toContain('v3') // KE 版本
    expect(container.querySelector('button[aria-label="收起属性栏"]')).toBeTruthy()
  })

  it('大纲小节仍在且可折叠（默认展开 → 点标题收起）', async () => {
    await render()

    expect(container.textContent).toContain('大纲')
    expect(container.textContent).toContain('一级标题')
    expect(container.textContent).toContain('二级标题')

    const outlineToggle = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.trim().startsWith('大纲'),
    )!
    expect(outlineToggle).toBeTruthy()
    await click(outlineToggle)
    expect(container.textContent).not.toContain('一级标题')
  })

  it('历史快照卡片仍在：时间 + 「查看历史」可用', async () => {
    const onOpenHistory = vi.fn()
    await render({ onOpenHistory, lastSnapshotAt: '2026-09-15T12:00:00+08:00' })

    expect(container.textContent).toContain('历史快照')
    expect(container.textContent).toContain('2026')
    await click(findByText('查看历史')!)
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('收起右栏按钮仍调用 onCollapse', async () => {
    const onCollapse = vi.fn()
    await render({ onCollapse })

    await click(container.querySelector<HTMLButtonElement>('button[aria-label="收起属性栏"]')!)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })
})
