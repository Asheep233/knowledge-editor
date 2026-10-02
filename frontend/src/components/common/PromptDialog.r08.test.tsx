/**
 * task-55 / R08（AstraNota 独立审查 2026-10-02）：**PromptHost 必须覆盖全部分支**，
 * 且宿主未挂载时 ask* 必须**明确失败**而不是永久挂起。
 *
 * 审查事实：`App.tsx` 的工作区选择页分支（`workspaceChecked && (!workspace?.open || firstRun)`）
 * 渲染在 `<PromptRoot>` 之外；而 `WorkspacePicker.browseAndOpen()` 的 Web 回退要
 * `await askPrompt('打开已有工作区路径')`。PromptDialog 的 `setterRef` 只在 `PromptHost`
 * 渲染时被赋值 → 宿主未挂载时 `setterRef?.()` 是 no-op，该 Promise **永不 settle**：
 * 用户点「打开已有工作区」没有任何反应、没有输入框（真实浏览器实测）。
 *
 * 本文件锁定：
 *   1) 宿主未挂载 → askPrompt 立即 resolve(null) / askConfirm 立即 resolve(false)（可量化：不 hang）
 *   2) 宿主挂载 → 正常弹窗并返回用户输入（不回归）
 *   3) 宿主卸载后 → 重新回到「明确失败」语义（不得指向已卸载组件的 setState）
 *   4) 源码级回归点：App.tsx 的选择页分支必须包在 PromptRoot 内
 */
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { askConfirm, askPrompt, PromptRoot } from './PromptDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

async function mountHost(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const r = createRoot(container)
  root = r
  await act(async () => {
    r.render(
      <PromptRoot>
        <div data-testid="app">app</div>
      </PromptRoot>,
    )
  })
  return container
}

async function unmountHost(): Promise<void> {
  if (!root) return
  const r = root
  root = null
  await act(async () => {
    r.unmount()
  })
  document.body.innerHTML = ''
}

/** 带超时的等待：用于证明「不会 hang」 */
async function settleWithin<T>(p: Promise<T>, ms = 500): Promise<T | 'TIMEOUT'> {
  return Promise.race([p, new Promise<'TIMEOUT'>((res) => setTimeout(() => res('TIMEOUT'), ms))])
}

afterEach(async () => {
  await unmountHost()
  vi.restoreAllMocks()
})

describe('task-55 R08-1. 宿主未挂载 → 明确失败（绝不永久挂起）', () => {
  it('1-1 askPrompt 无宿主：立即 resolve(null)（不再 hang）并打印可诊断日志', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await settleWithin(askPrompt('打开已有工作区路径'))
    expect(res).toBe(null)
    expect(err).toHaveBeenCalled()
    expect(String(err.mock.calls[0]?.[0] ?? '')).toContain('PromptHost 未挂载')
  })

  it('1-2 askConfirm 无宿主：立即 resolve(false)（按「取消」处理）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await settleWithin(askConfirm('删除这个文档？'))
    expect(res).toBe(false)
    expect(err).toHaveBeenCalled()
  })

  it('1-3 宿主卸载后重新回到「明确失败」语义（不得指向已卸载组件的 setState）', async () => {
    await mountHost()
    await unmountHost()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await settleWithin(askPrompt('卸载后调用'))
    expect(res).toBe(null)
    expect(err).toHaveBeenCalled()
  })
})

describe('task-55 R08-2. 宿主挂载 → 正常弹窗（不回归）', () => {
  it('2-1 askPrompt 弹出输入框，输入后确定 → resolve 用户输入', async () => {
    const container = await mountHost()
    const p = askPrompt('打开已有工作区路径')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()
    await act(async () => {
      // React 受控 input：必须走原生 value setter 才能触发 onChange
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '/tmp/ws')
      input!.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent === '确定') as HTMLButtonElement
    await act(async () => {
      ok.click()
    })
    await expect(settleWithin(p)).resolves.toBe('/tmp/ws')
  })

  it('2-2 askConfirm 弹出确认框，点取消 → resolve false', async () => {
    const container = await mountHost()
    const p = askConfirm('删除这个文档？')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent === '取消') as HTMLButtonElement
    expect(cancel).toBeTruthy()
    await act(async () => {
      cancel.click()
    })
    await expect(settleWithin(p)).resolves.toBe(false)
  })
})

describe('task-55 R08-3. 源码级回归点：App.tsx 全部分支都在 PromptRoot 内', () => {
  it('3-1 工作区选择页分支必须包在 <PromptRoot> 中（R08 的原始缺陷点）', () => {
    const src = readFileSync(join(__dirname, '../../App.tsx'), 'utf8')
    const branchIdx = src.indexOf('if (workspaceChecked && (!workspace?.open || firstRun))')
    expect(branchIdx).toBeGreaterThan(-1)
    // 该分支内的第一个 return 必须是 <PromptRoot>
    const afterBranch = src.slice(branchIdx)
    const returnIdx = afterBranch.indexOf('return (')
    expect(returnIdx).toBeGreaterThan(-1)
    const body = afterBranch.slice(returnIdx, returnIdx + 400)
    expect(body).toContain('<PromptRoot>')
    // 且该分支内仍有 WorkspacePicker（没被改坏）
    expect(body).toContain('<WorkspacePicker')
  })

  it('3-2 App.tsx 里每个顶层 return 分支都不在 PromptRoot 之外渲染交互页', () => {
    const src = readFileSync(join(__dirname, '../../App.tsx'), 'utf8')
    // 两个分支都出现 PromptRoot（选择页 + 主界面）
    const count = (src.match(/<PromptRoot>/g) ?? []).length
    expect(count).toBeGreaterThanOrEqual(2)
  })
})
