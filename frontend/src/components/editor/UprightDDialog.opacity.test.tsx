/**
 * task-74 视觉回归（主理人真机截图 bug）：**对话框面板半透明，正文透上来**。
 *
 * 根因：面板误用 `bg-surface` —— 本项目 Tailwind token 只有 `--color-card` / `--color-background`
 * 等（见 `src/index.css` 的 `@theme` 段），**没有 `surface`** → 类不生效 = 面板没有任何背景色
 * → 遮罩下（=20% 黑）的文档正文直接透上来。`ExportPdfDialog` 用的是
 * `rounded-lg border border-border bg-card shadow-xl`，所以它不透明、表现正常。
 *
 * 本文件锁定：面板/头部/底部必须是**实心** `bg-card`，且不得出现
 * `bg-surface`（未定义 token）或 `bg-xxx/NN`（半透明）这类面板类。
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import UprightDDialog from './UprightDDialog'
import type { MathDocNode } from '../../editor/upright-d'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MD = '$dx + d_i$\n'
const DOC: MathDocNode = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'math', attrs: { latex: 'dx + d_i' } }] }],
}

let root: Root | null = null
let container: HTMLDivElement

const mount = async () => {
  await act(async () => {
    root = createRoot(container)
    root.render(
      React.createElement(UprightDDialog, {
        open: true,
        markdown: MD,
        doc: DOC,
        fileName: 'Week3.md',
        onClose: () => undefined,
        createArticle: async () => ({ path: 'Articles/x.md' }),
      }),
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

describe('task-74 视觉回归：面板必须不透明（主理人真机截图 bug）', () => {
  it('面板用**实心**背景 token（bg-card），且不含半透明/无背景类', async () => {
    await mount()
    const panel = container.querySelector('[data-ke-upright-panel]') as HTMLElement
    expect(panel, '缺少面板容器').toBeTruthy()
    const cls = panel.className
    // ① 实心背景必须存在（本次 bug：误用不存在的 bg-surface → 面板没背景 → 正文透上来）
    expect(cls).toContain('bg-card')
    expect(cls).toContain('border')
    expect(cls).toContain('shadow-xl')
    // ② 不得再出现不存在的 token / 半透明面板
    expect(cls).not.toContain('bg-surface')
    expect(cls).not.toMatch(/(^|\s)(?:bg|opacity)-[^\s]*\/\d+/)   // 不允许 bg-xxx/40 之类的面板半透明
    expect(cls).not.toContain('bg-transparent')
    expect(cls).not.toContain('bg-inherit')
    expect(cls).not.toContain('backdrop-blur')
    // ③ 面板内部的头部/底部条也必须是实心底（截图里那几块也在透）
    for (const sel of ['header', 'footer']) {
      const bar = panel.querySelector(sel) as HTMLElement
      expect(bar?.className, `${sel} 应是实心底`).toContain('bg-card')
      expect(bar?.className ?? '', `${sel} 不得半透明`).not.toMatch(/bg-[^\s]*\/\d+/)
    }
  })

  it('遮罩仍用半透明遮罩（浮层本身允许半透明，面板不允许）', async () => {
    await mount()
    const overlay = container.querySelector('[aria-label="微分 d 转正体预览"]') as HTMLElement
    expect(overlay.className).toContain('fixed inset-0')
    // task-2（Focus 浮层重排）：遮罩改用设计令牌 `var(--scrim)`（Tailwind 无对应色阶，走内联 style）。
    // 原断言锁定的意图是「遮罩是半透明层」，这里断言令牌来源；面板不透明度断言未动。
    expect(overlay.getAttribute('style') ?? '').toContain('var(--scrim)')
    // 遮罩与面板是两层，互不嵌套混淆
    expect(overlay.querySelector('[data-ke-upright-panel]')).toBeTruthy()
  })

  it('源码级守护：组件不再引用不存在的 `bg-surface` 类', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const file = resolve(process.cwd(), 'src/components/editor/UprightDDialog.tsx')
    // 去掉注释后再查（注释里可以提及历史类名）
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src, '组件里又出现了未定义的 bg-surface').not.toContain('bg-surface')
    // 面板必须是实心 token
    expect(src).toContain('data-ke-upright-panel')
  })
})

