/**
 * F1（UI-3）+ F5（IME）：PromptDialog 全局单例并发 / 键盘 IME 守卫。
 *
 * 文件位置说明：放在 `src/state/` 而非 `src/components/common/` —— 后者与
 * `PromptDialog.tsx` 同目录，正被并发队友的清理流程反复删除（本轮实测 3 次）。
 * 本文件仍只依赖 PromptDialog 的公开导出。
 *
 * 为什么另建文件（而非追加到 PromptDialog.test.tsx）：
 *   该文件与 `PromptDialog.tsx` 正由另一名队友（task-55 / R08：宿主未挂载时立即取消）并发修改，
 *   追加到既有文件的内容会被整体回滚（本轮实测两次）。本文件只依赖 PromptDialog 的导出，
 *   与该队友的测试文件互不覆盖，**不影响** `PromptDialog.test.tsx` 的既有 7 条用例。
 *
 * F1 原缺陷：`activeDialog` 是模块级单例，`askPrompt/askConfirm` 直接覆盖它 —— 并发发起
 * （快速双击、两个动作同时弹确认）时后一次覆盖前一次：先发起的 Promise **永久悬挂**，
 * 且被覆盖的弹窗内容与用户实际看到的不是同一个请求；关闭时也不清空 `activeDialog`，
 * 留下已 settle 的悬挂引用（宿主重新挂载后新请求会被这个幽灵占位永久排队）。
 *
 * 修复策略 = **队列化**（而非「第二个请求立即以取消值返回」），理由：
 *   本模块存在的全部理由就是「确认/输入必须来自用户」（见文件头背景：原生 confirm 被
 *   静默绕过的事故）。若第二个请求被系统自动判为「取消」，调用方无法区分「用户点了取消」
 *   与「系统替我取消」——对破坏性操作是一次伪造的否定决定，会重新引入静默语义。
 *   队列化保证：先到先弹、严格串行（同一时刻仅一个弹窗）、每个 Promise 都以**用户决定** settle。
 *
 * ⚠️ 与 R08 的协同：宿主（PromptHost）未挂载时仍按 R08 语义**立即以取消值结算**
 *    （`setterRef === null` 分支），队列只在宿主已挂载时生效。
 */
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { askConfirm, askPrompt, PromptRoot } from '../components/common/PromptDialog'
// 命名空间导入：测试钩子用 `?.()` 访问 —— 这样把本文件跑在**修复前**的实现上时
// 不会因「缺少导出」在收集阶段就炸掉整个文件（修复前应当是行为断言红，而不是加载失败）。
import * as promptDialogModule from '../components/common/PromptDialog'

const stateForTests = () => promptDialogModule.__promptDialogStateForTests?.()
const resetForTests = () => promptDialogModule.__resetPromptDialogForTests?.()

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement

const dialog = () => container.querySelector('[role="dialog"]')
const buttonByText = (t: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement | undefined

/** 构造带 IME 标记的键盘事件（happy-dom 的 init dict 不保证支持这两个字段） */
function imeKey(target: HTMLElement, key: string, kind: 'composing' | 'keyCode229'): void {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  if (kind === 'composing') Object.defineProperty(ev, 'isComposing', { value: true })
  else Object.defineProperty(ev, 'keyCode', { value: 229 })
  target.dispatchEvent(ev)
}

async function mount() {
  resetForTests()
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
  container?.remove()
})

describe('F1：并发请求队列化（全局单例不再覆盖 / 不再悬挂）', () => {
  it('并发两次 askPrompt：先到的在前台，后到的排队；关闭后依次弹出，两个 Promise 都 settle', async () => {
    let p1!: Promise<string | null>
    let p2!: Promise<string | null>
    await act(async () => {
      p1 = askPrompt('第一个', '甲')
      p2 = askPrompt('第二个', '乙')
    })

    // 先到者仍在前台（旧实现：被第二个覆盖 → 断言红）
    expect(dialog()!.textContent).toContain('第一个')
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('甲')
    expect(stateForTests()).toEqual({ active: 'prompt', queued: 1 })

    // 先到者 settle → 后到者依次弹出（旧实现：p1 永不 settle → 永久悬挂）
    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(p1).resolves.toBe('甲')
    expect(dialog()).toBeTruthy()
    expect(dialog()!.textContent).toContain('第二个')
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('乙')
    expect(stateForTests()).toEqual({ active: 'prompt', queued: 0 })

    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(p2).resolves.toBe('乙')
    expect(dialog()).toBeNull()
  })

  it('快速双击（两个 askConfirm）：互不覆盖，各自拿到自己的用户决定', async () => {
    let d1!: Promise<boolean>
    let d2!: Promise<boolean>
    await act(async () => {
      d1 = askConfirm('删除文档 A？', { confirmText: '删除', danger: true })
      d2 = askConfirm('删除文档 B？', { confirmText: '删除', danger: true })
    })
    expect(dialog()!.textContent).toContain('文档 A')
    expect(stateForTests()).toEqual({ active: 'confirm', queued: 1 })

    // 第一个：确认；第二个：取消 —— 两次决定互不串扰
    await act(async () => {
      buttonByText('删除')!.click()
    })
    await expect(d1).resolves.toBe(true)
    expect(dialog()!.textContent).toContain('文档 B')
    await act(async () => {
      buttonByText('取消')!.click()
    })
    await expect(d2).resolves.toBe(false)
    expect(dialog()).toBeNull()
  })

  it('混合类型（先 confirm 后 prompt）也严格串行，不丢请求', async () => {
    let d!: Promise<boolean>
    let p!: Promise<string | null>
    await act(async () => {
      d = askConfirm('先确认')
      p = askPrompt('再输入', '填充')
    })
    expect(dialog()!.textContent).toContain('先确认')
    expect(stateForTests()).toEqual({ active: 'confirm', queued: 1 })

    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(d).resolves.toBe(true)
    expect(dialog()!.textContent).toContain('再输入')
    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(p).resolves.toBe('填充')
  })

  it('Escape 取消当前项后队列继续推进（取消不吞掉排队请求）', async () => {
    let d1!: Promise<boolean>
    let d2!: Promise<boolean>
    await act(async () => {
      d1 = askConfirm('第一问')
      d2 = askConfirm('第二问')
    })
    await act(async () => {
      buttonByText('确定')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await expect(d1).resolves.toBe(false)
    expect(dialog()!.textContent).toContain('第二问')
    await act(async () => {
      buttonByText('确定')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await expect(d2).resolves.toBe(true)
  })

  it('关闭后 activeDialog 必须清空：再次发起立即渲染（不留已 settle 的悬挂引用）', async () => {
    let p1!: Promise<string | null>
    await act(async () => {
      p1 = askPrompt('第一次', 'A')
    })
    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(p1).resolves.toBe('A')

    // 直接断言模块级单例已清空（已 settle 的对话框不得继续占位）
    expect(stateForTests()).toEqual({ active: null, queued: 0 })

    // 行为等价证明：清空后新请求立即在前台（若残留悬挂引用，新请求会被当成「排队」永不弹出）
    let p2!: Promise<string | null>
    await act(async () => {
      p2 = askPrompt('第二次', 'B')
    })
    expect(dialog()).toBeTruthy()
    expect(dialog()!.textContent).toContain('第二次')
    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(p2).resolves.toBe('B')
    expect(stateForTests()).toEqual({ active: null, queued: 0 })
  })

  it('确认框关闭后同样清空；连续 3 次串行请求全部 settle（无悬挂）', async () => {
    const results: boolean[] = []
    await act(async () => {
      void askConfirm('第 1 问').then((v) => results.push(v))
      void askConfirm('第 2 问').then((v) => results.push(v))
      void askConfirm('第 3 问').then((v) => results.push(v))
    })
    expect(stateForTests()).toEqual({ active: 'confirm', queued: 2 })
    for (const label of ['第 1 问', '第 2 问', '第 3 问']) {
      expect(dialog()!.textContent).toContain(label)
      await act(async () => {
        buttonByText('确定')!.click()
      })
    }
    await act(async () => {
      await Promise.resolve()
    })
    expect(results).toEqual([true, true, true])
    expect(dialog()).toBeNull()
    expect(stateForTests()).toEqual({ active: null, queued: 0 })
  })
})

describe('F5：对话框键盘处理经过 shouldIgnoreKeyEvent（IME 组合中不误触发）', () => {
  it('askPrompt：组合中 Enter 不关弹窗、不提交；组合结束后 Enter 正常确定', async () => {
    let p!: Promise<string | null>
    await act(async () => {
      p = askPrompt('文件夹名称', '草稿')
    })
    const input = container.querySelector('input') as HTMLInputElement

    await act(async () => {
      imeKey(input, 'Enter', 'composing')
    })
    expect(dialog(), 'isComposing=true 的回车把弹窗关掉了（用户只是上屏候选词）').toBeTruthy()

    await act(async () => {
      imeKey(input, 'Enter', 'keyCode229')
    })
    expect(dialog(), 'keyCode=229 的回车把弹窗关掉了').toBeTruthy()

    // 非组合态的真实回车 → 正常确定
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await expect(p).resolves.toBe('草稿')
    expect(dialog()).toBeNull()
  })

  it('askPrompt：组合中 Escape 不取消弹窗（Escape 本意是取消组词）', async () => {
    let p!: Promise<string | null>
    await act(async () => {
      p = askPrompt('文件夹名称', '草稿')
    })
    const input = container.querySelector('input') as HTMLInputElement

    await act(async () => {
      imeKey(input, 'Escape', 'composing')
    })
    expect(dialog(), 'isComposing=true 的 Escape 取消了弹窗').toBeTruthy()

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await expect(p).resolves.toBeNull()
  })

  it('askConfirm：组合中 Enter 不误触「确定」（危险操作不得被 IME 回车绕过）', async () => {
    let d!: Promise<boolean>
    await act(async () => {
      d = askConfirm('确认删除？', { confirmText: '删除', danger: true })
    })
    await act(async () => {
      imeKey(buttonByText('删除')!, 'Enter', 'composing')
    })
    expect(dialog(), '组合中的回车触发了「删除」').toBeTruthy()

    await act(async () => {
      buttonByText('删除')!.click()
    })
    await expect(d).resolves.toBe(true)
  })

  it('askConfirm：组合中 Escape 不误触「取消」', async () => {
    let d!: Promise<boolean>
    await act(async () => {
      d = askConfirm('确认删除？', { confirmText: '删除', danger: true })
    })
    await act(async () => {
      imeKey(buttonByText('取消')!, 'Escape', 'composing')
    })
    expect(dialog()).toBeTruthy()

    // 非组合态的真实点击：确认按钮文案是「删除」（confirmText 自定义）
    await act(async () => {
      buttonByText('删除')!.click()
    })
    await expect(d).resolves.toBe(true)
  })
})
