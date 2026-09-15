/**
 * `askConfirm` 行为测试（2026-09-15）。
 *
 * 为什么需要：原生 `window.confirm` 在 Tauri 下恒返回 Promise(truthy) → 确认被静默绕过。
 * 改自绘后必须**可量化验证**「真的弹了、点了真的生效」，而不是靠人工点。
 */
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { askConfirm, askPrompt, PromptRoot } from './PromptDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement

const dialog = () => container.querySelector('[role="dialog"]')
const buttonByText = (t: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement | undefined

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <PromptRoot>
        <div data-testid="app">app</div>
      </PromptRoot>,
    )
  })
}

beforeEach(async () => {
  await mount()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
    root = null
  })
  container.remove()
})

describe('askConfirm：自绘确认框', () => {
  it('调用后渲染对话框并展示完整文案；点「确定」resolve true', async () => {
    let p!: Promise<boolean>
    await act(async () => {
      p = askConfirm('确认删除「文档A」？\n删除后可在回收站恢复。', { confirmText: '删除', danger: true })
    })
    expect(dialog()).toBeTruthy()
    expect(dialog()!.textContent).toContain('确认删除「文档A」？')
    expect(dialog()!.textContent).toContain('删除后可在回收站恢复。')
    expect(buttonByText('删除')).toBeTruthy()

    await act(async () => {
      buttonByText('删除')!.click()
    })
    await expect(p).resolves.toBe(true)
    expect(dialog()).toBeNull() // 关闭
  })

  it('点「取消」resolve false 且不执行（这是原来被绕过的那条路）', async () => {
    let p!: Promise<boolean>
    await act(async () => {
      p = askConfirm('确认删除？', { confirmText: '删除', danger: true })
    })
    await act(async () => {
      buttonByText('取消')!.click()
    })
    await expect(p).resolves.toBe(false)
    expect(dialog()).toBeNull()
  })

  it('Escape 视为取消（resolve false）', async () => {
    let p!: Promise<boolean>
    await act(async () => {
      p = askConfirm('确认删除？')
    })
    await act(async () => {
      buttonByText('确定')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await expect(p).resolves.toBe(false)
  })

  it('Enter 视为确定（resolve true）', async () => {
    let p!: Promise<boolean>
    await act(async () => {
      p = askConfirm('确认删除？')
    })
    await act(async () => {
      buttonByText('确定')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await expect(p).resolves.toBe(true)
  })

  it('危险操作默认焦点在「取消」，防误触回车误删', async () => {
    await act(async () => {
      void askConfirm('确认删除？', { confirmText: '删除', danger: true })
    })
    // React 的 autoFocus 是命令式 .focus()，不渲染 autofocus 属性 → 断言焦点元素
    expect(document.activeElement).toBe(buttonByText('取消'))
  })

  it('非危险操作默认焦点在「确定」', async () => {
    await act(async () => {
      void askConfirm('重建索引？')
    })
    expect(document.activeElement).toBe(buttonByText('确定'))
  })

  it('askPrompt 仍然可用（未被本次改动破坏）', async () => {
    let p!: Promise<string | null>
    await act(async () => {
      p = askPrompt('文件夹名称', '草稿')
    })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('草稿')
    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(p).resolves.toBe('草稿')
  })
})
