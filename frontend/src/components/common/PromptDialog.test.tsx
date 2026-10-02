/**
 * `askConfirm` 行为测试（2026-09-15）。
 *
 * 为什么需要：原生 `window.confirm` 在 Tauri 下恒返回 Promise(truthy) → 确认被静默绕过。
 * 改自绘后必须**可量化验证**「真的弹了、点了真的生效」，而不是靠人工点。
 */
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __promptDialogStateForTests,
  __resetPromptDialogForTests,
  askConfirm,
  askPrompt,
  PromptRoot,
} from './PromptDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement

const dialog = () => container.querySelector('[role="dialog"]')
const buttonByText = (t: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement | undefined

async function mount() {
  // 模块级单例跨用例残留会污染下一个用例（上一个用例可能留下未回应的排队项）
  __resetPromptDialogForTests()
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

/**
 * F1（UI-3）：全局单例并发。
 *
 * 原缺陷：`activeDialog` 是模块级单例，`askPrompt/askConfirm` 直接覆盖它 —— 并发发起
 * （快速双击、两个动作同时弹确认）时后一次覆盖前一次：先发起的 Promise **永久悬挂**
 * （await 它的调用方永远卡住：删除流程不执行、按钮无响应），且被覆盖的弹窗内容与
 * 用户实际看到的不是同一个请求。关闭时也没有清空 `activeDialog`，留下已 settle 的悬挂引用。
 *
 * 修复策略 = **队列化**（而非「第二个请求立即以取消值返回」）：
 *  每条请求都必须拿到**真实的用户决定**。若第二个请求被自动判为「取消」，对 `askPrompt`
 *  而言调用方无法区分「用户点了取消」与「系统替我取消」——本模块存在的全部理由就是
 *  「确认/输入必须来自用户」，静默伪造一个否定结果会重新引入它要根治的那类静默绕过。
 *  队列化保证：先到的先弹，每个 Promise 都以用户决定 settle，且严格串行（同一时刻仅一个弹窗）。
 */
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
    expect(__promptDialogStateForTests()).toEqual({ active: 'prompt', queued: 1 })

    // 先到者 settle → 后到者依次弹出（旧实现：p1 永不 settle → 永久悬挂）
    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(p1).resolves.toBe('甲')
    expect(dialog()).toBeTruthy()
    expect(dialog()!.textContent).toContain('第二个')
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('乙')
    expect(__promptDialogStateForTests()).toEqual({ active: 'prompt', queued: 0 })

    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(p2).resolves.toBe('乙')
    expect(dialog()).toBeNull()
  })

  it('反例（UI-3 核心）：并发两个 askPrompt 都必须各自 settle —— 修前先发起的 Promise 永久悬挂', async () => {
    const HUNG = Symbol('HUNG')
    const within = <T,>(p: Promise<T>, ms = 300): Promise<T | typeof HUNG> =>
      Promise.race([p, new Promise<typeof HUNG>((r) => setTimeout(() => r(HUNG), ms))])

    let p1!: Promise<string | null>
    let p2!: Promise<string | null>
    await act(async () => {
      p1 = askPrompt('并发甲', '1')
      p2 = askPrompt('并发乙', '2')
    })

    // 用户只点得到当前可见的那个弹窗
    await act(async () => {
      buttonByText('确定')!.click()
    })
    // 修前：p1 已被 p2 覆盖 → 300ms 内永不 settle → 返回 HUNG → 断言红（「永久悬挂」的可证伪证据）
    await expect(within(p1)).resolves.toBe('1')
    // 修后：队列推进，第二个弹窗出现，点确定后 p2 也 settle
    expect(dialog()!.textContent).toContain('并发乙')
    await act(async () => {
      buttonByText('确定')!.click()
    })
    await expect(within(p2)).resolves.toBe('2')
    expect(__promptDialogStateForTests()).toEqual({ active: null, queued: 0 })
  })

  it('快速双击（两个 askConfirm）：互不覆盖，各自拿到自己的用户决定', async () => {
    let d1!: Promise<boolean>
    let d2!: Promise<boolean>
    await act(async () => {
      d1 = askConfirm('删除文档 A？', { confirmText: '删除', danger: true })
      d2 = askConfirm('删除文档 B？', { confirmText: '删除', danger: true })
    })
    expect(dialog()!.textContent).toContain('文档 A')
    expect(__promptDialogStateForTests()).toEqual({ active: 'confirm', queued: 1 })

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
    expect(__promptDialogStateForTests()).toEqual({ active: 'confirm', queued: 1 })

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
    expect(__promptDialogStateForTests()).toEqual({ active: null, queued: 0 })

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
    expect(__promptDialogStateForTests()).toEqual({ active: null, queued: 0 })
  })

  it('确认框关闭后同样清空；连续 3 次串行请求全部 settle（无悬挂）', async () => {
    const results: boolean[] = []
    await act(async () => {
      void askConfirm('第 1 问').then((v) => results.push(v))
      void askConfirm('第 2 问').then((v) => results.push(v))
      void askConfirm('第 3 问').then((v) => results.push(v))
    })
    expect(__promptDialogStateForTests()).toEqual({ active: 'confirm', queued: 2 })
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
    expect(__promptDialogStateForTests()).toEqual({ active: null, queued: 0 })
  })
})

/**
 * F5：IME（输入法）组合输入中不得响应 Enter/Escape。
 *
 * 场景：中文/日文输入法组词时按回车 = **上屏候选词**（keydown 带 isComposing=true 或
 * keyCode=229）。对话框若不检查，会在用户只是想上屏时把弹窗关掉并提交半截输入
 * （或对 Escape 同理：Escape 本意是取消组词，却把整个对话框取消）。
 */
describe('F5：对话框键盘处理经过 shouldIgnoreKeyEvent（IME 组合中不误触发）', () => {
  /** 构造带 IME 标记的键盘事件（happy-dom 的 init dict 不保证支持这两个字段） */
  function imeKey(target: HTMLElement, key: string, kind: 'composing' | 'keyCode229'): void {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    if (kind === 'composing') Object.defineProperty(ev, 'isComposing', { value: true })
    else Object.defineProperty(ev, 'keyCode', { value: 229 })
    target.dispatchEvent(ev)
  }

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

    // 修补（保全测试笔误）：本用例 confirmText='删除'，弹窗里没有「确定」按钮
    // （原断言点 buttonByText('确定') → undefined.click()，与 IME 守卫无关，修前修后都必红）
    await act(async () => {
      buttonByText('删除')!.click()
    })
    await expect(d).resolves.toBe(true)
  })
})

/**
 * F1 × R08 交界：宿主卸载时的未决请求必须被结算。
 *
 * R08 只覆盖了「宿主从未挂载」（setterRef === null）。但「宿主挂载过、弹窗还没答完就卸载」
 * （App 分支切换 / 关闭工作区）此前没有任何结算路径：setterRef 被清空、React 树消失，
 * 前台与队列里的 Promise **永久悬挂** —— 与本工单「不得留下永久挂起的 Promise」冲突。
 * 卸载时必须按「取消」明确结算（并打印可诊断日志），而不是静默丢弃。
 */
describe('F1×R08：宿主卸载不得留下永久挂起的 Promise', () => {
  it('卸载时前台 + 排队请求都按取消结算（不 hang）；卸载后回到 R08 明确失败', async () => {
    const HUNG = Symbol('HUNG')
    const within = <T,>(p: Promise<T>, ms = 300): Promise<T | typeof HUNG> =>
      Promise.race([p, new Promise<typeof HUNG>((r) => setTimeout(() => r(HUNG), ms))])
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    let p1!: Promise<string | null>
    let c2!: Promise<boolean>
    await act(async () => {
      p1 = askPrompt('卸载前甲', '甲')
      c2 = askConfirm('卸载前乙')
    })
    expect(__promptDialogStateForTests()).toEqual({ active: 'prompt', queued: 1 })

    // 模拟宿主卸载（App 分支切换 / 关闭工作区）
    await act(async () => {
      root!.unmount()
      root = null
    })

    await expect(within(p1)).resolves.toBeNull()
    await expect(within(c2)).resolves.toBe(false)
    expect(__promptDialogStateForTests()).toEqual({ active: null, queued: 0 })

    // 卸载后新请求仍走 R08「明确失败」（不 hang）
    await expect(within(askPrompt('卸载后'))).resolves.toBeNull()
    const msgs = err.mock.calls.map((c) => String(c[0]))
    expect(msgs.some((m) => m.includes('PromptHost 未挂载'))).toBe(true)
  })
})
