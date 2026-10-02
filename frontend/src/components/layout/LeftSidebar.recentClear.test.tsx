/**
 * F3：「最近更新 → 清空」失败时不得产生 unhandled rejection，且必须有可见提示。
 *
 * 为什么另建文件：`LeftSidebar.test.tsx` 正被并发队友改动/回滚（本轮实测我的追加被整段回滚）；
 * 本文件自带替身与脚手架，独立成立。
 *
 * 原实现（LeftSidebar.tsx「最近更新」→「清空」）：
 *   `void clearRecentDocuments().then(refreshAll)`
 * 后端 down / 请求失败时 Promise rejected 且无 catch → unhandled rejection（控制台报错；
 * 用户只看到「点了没反应」）。修复 = `.catch(...)` + 可见提示（本文件既有约定 window.alert）。
 */
import { act, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import LeftSidebar from './LeftSidebar'
import * as api from '../../api/client'

// PromptDialog：本用例不关心弹窗实现，替身掉（与 LeftSidebar.test.tsx 同款）
vi.mock('../common/PromptDialog', () => ({
  askConfirm: vi.fn(async () => true),
  askPrompt: vi.fn(async () => null),
  usePrompt: () => vi.fn(async () => null),
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

vi.mock('../../api/client', () => ({
  attachmentUrl: (rel: string) => `/api/attachments/${rel}`,
  clearRecentDocuments: vi.fn(),
  createDocIn: vi.fn(),
  createFolder: vi.fn(),
  deleteArticle: vi.fn(),
  deleteAttachment: vi.fn(),
  deleteFolder: vi.fn(),
  getFilesByTag: vi.fn(),
  getRecentDocuments: vi.fn(),
  getTags: vi.fn(),
  getTree: vi.fn(),
  listAttachments: vi.fn(),
  listModules: vi.fn(),
  listOrphans: vi.fn(),
  movePath: vi.fn(),
  rebuildIndex: vi.fn(),
  renameDoc: vi.fn(),
  renameFolder: vi.fn(),
  search: vi.fn(),
  listTrash: vi.fn(),
  restoreTrash: vi.fn(),
  purgeTrash: vi.fn(),
  clearTrash: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RECENT = { rel_path: 'Articles/甲.md', title: '甲', opened_at: '2026-09-15T10:00:00+08:00' }

let root: Root | null = null
let container: HTMLDivElement | null = null
let alertSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  alertSpy = vi.fn()
  ;(window as unknown as { alert: unknown }).alert = alertSpy
  vi.mocked(api.getTree).mockResolvedValue({ root: '/ws', articles: [], modules: [], attachments: { images: [], videos: [], files: [] } })
  vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: [RECENT] })
  vi.mocked(api.getTags).mockResolvedValue({ tags: [] })
  vi.mocked(api.listModules).mockResolvedValue({ count: 0, modules: [] })
  vi.mocked(api.listTrash).mockResolvedValue({ count: 0, items: [] })
  vi.mocked(api.listAttachments).mockResolvedValue({ count: 0, attachments: [] })
  vi.mocked(api.listOrphans).mockResolvedValue({ count: 0, orphans: [] })
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

async function render(props: Partial<ComponentProps<typeof LeftSidebar>> = {}): Promise<void> {
  root = createRoot(container!)
  const full: ComponentProps<typeof LeftSidebar> = { activeId: null, onOpenArticle: vi.fn(), ...props }
  await act(async () => {
    root!.render(<LeftSidebar {...full} />)
  })
  await settle()
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
  })
  await settle()
}

async function openRecent(): Promise<void> {
  await render()
  await click(findButton('最近更新')!)
  expect(container!.textContent).toContain('甲')
}

describe('F3 — 清空最近文档失败的错误处理', () => {
  it('后端失败：给出可见提示，且不产生 unhandled rejection', async () => {
    const seen: unknown[] = []
    const onUnhandled = (r: unknown): void => {
      seen.push(r)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      await openRecent()
      vi.mocked(api.clearRecentDocuments).mockRejectedValue(new Error('backend down'))

      await click(findButton('清空')!)
      // 让 then/catch 与 Node 的 unhandledRejection 判定各跑一轮
      await settle()
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(seen, `出现未处理的 rejection：${String(seen[0])}`).toEqual([])
      expect(alertSpy, '清空失败却没有任何用户可见反馈').toHaveBeenCalled()
      expect(String(alertSpy.mock.calls[0]?.[0] ?? '')).toContain('清空最近文档失败')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('成功路径不变：仍然刷新「最近更新」列表', async () => {
    await openRecent()
    vi.mocked(api.clearRecentDocuments).mockResolvedValue(undefined)
    vi.mocked(api.getRecentDocuments).mockResolvedValue({ documents: [] })

    await click(findButton('清空')!)

    expect(vi.mocked(api.clearRecentDocuments)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.getRecentDocuments).mock.calls.length).toBeGreaterThan(1) // refreshAll 触发
  })

  it('源码级守卫：清空链路必须带 catch', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/layout/LeftSidebar.tsx'), 'utf8')
    expect(src, 'clearRecentDocuments 又变回无 catch 的悬空 Promise').toMatch(
      /clearRecentDocuments\(\)[\s\S]{0,300}?\.catch\(/,
    )
  })
})
