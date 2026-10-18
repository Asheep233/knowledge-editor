/**
 * UI-01 回归守卫（v1.2.17 回归 → v1.2.18 修复）：导出按钮/下拉菜单不得被
 * 工具栏的横向滚动容器裁剪。
 *
 * 回归现场：v1.2.17 把*整条*工具栏根节点改成 `overflow-x-auto`（为修 1280px 下
 * 按钮被裁切）。导出按钮由 App 侧构造、经 `exportButton` prop 渲染在工具栏内，
 * 其下拉菜单是**同一容器内 `absolute` 定位**的子元素 —— 被滚动容器裁剪后菜单
 * 根本不可见，用户点「导出」感受为「没反应」。
 *
 * 修复：横向滚动只给左侧格式控件容器；右侧（保存状态/历史/导出）固定不滚动。
 * 本用例渲染**真实** EditorToolbar（仅 mock tiptap 上下文），断言：
 *  ① 存在且仅存在一个横向滚动容器（左侧格式控件）；
 *  ② 导出按钮不在该滚动容器内；
 *  ③ 导出按钮的祖先链上没有任何 overflow 裁剪容器（菜单可见）。
 * 回归时会因为 ②/③ 失败而直接变红 —— happy-dom 不模拟真实裁剪，所以用结构断言。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import EditorToolbar from './EditorToolbar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const H = vi.hoisted(() => ({
  editor: {
    isActive: () => false,
    can: () => ({ undo: () => false, redo: () => false }),
    chain: () => {
      const c = {
        focus: () => c,
        toggleBold: () => c,
        toggleItalic: () => c,
        toggleUnderline: () => c,
        toggleStrike: () => c,
        toggleCode: () => c,
        run: () => true,
      }
      return c
    },
    commands: { focus: () => undefined },
  },
}))

vi.mock('@tiptap/react', () => ({
  useCurrentEditor: () => ({ editor: H.editor }),
  useEditorState: (opts: { selector: (ctx: unknown) => unknown }) => opts.selector({ editor: H.editor }),
}))
vi.mock('../../api/client', () => ({
  getModule: vi.fn(async () => ({ content: '' })),
  listModules: vi.fn(async () => []),
  uploadAttachment: vi.fn(async () => ({ rel_path: 'Attachments/x' })),
}))
vi.mock('../../editor', () => ({ openMathEditorById: vi.fn() }))
vi.mock('../../editor/ke', () => ({ newId: () => 'test-id' }))
vi.mock('../../editor/upload', () => ({ attachmentNode: () => ({}) }))
vi.mock('../common/PromptDialog', () => ({ askPrompt: vi.fn(async () => null) }))

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
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

const CLIP_CLASSES = ['overflow-x-auto', 'overflow-y-auto', 'overflow-hidden', 'overflow-scroll']

async function renderToolbar(): Promise<void> {
  root = createRoot(container!)
  await act(async () => {
    root!.render(
      <EditorToolbar exportButton={<button type="button" data-testid="export-btn">导出</button>} />,
    )
  })
}

describe('UI-01 工具栏结构回归（导出菜单不得被滚动容器裁剪）', () => {
  it('导出按钮在右侧固定区，不在左侧横向滚动容器内', async () => {
    await renderToolbar()
    const exportBtn = container!.querySelector('[data-testid="export-btn"]') as HTMLElement
    expect(exportBtn, '未渲染 exportButton').toBeTruthy()

    const scrollers = Array.from(container!.querySelectorAll<HTMLElement>('*')).filter((el) =>
      CLIP_CLASSES.some((c) => String(el.className ?? '').includes(c)),
    )
    expect(scrollers.length, '应只有左侧格式控件一个横向滚动容器').toBe(1)
    expect(
      scrollers[0].contains(exportBtn),
      '导出按钮又回到滚动容器内：导出菜单会被裁剪（v1.2.17 回归）',
    ).toBe(false)
  })

  it('导出按钮祖先链无 overflow 裁剪容器（下拉菜单可见）', async () => {
    await renderToolbar()
    const exportBtn = container!.querySelector('[data-testid="export-btn"]') as HTMLElement
    const clipAncestors: string[] = []
    let cur: HTMLElement | null = exportBtn.parentElement
    while (cur) {
      const cls = String(cur.className ?? '')
      if (CLIP_CLASSES.some((c) => cls.includes(c))) clipAncestors.push(cls.slice(0, 80))
      cur = cur.parentElement
    }
    expect(clipAncestors, `导出按钮祖先链存在裁剪容器: ${clipAncestors.join(' | ')}`).toEqual([])
  })
})
