/**
 * task-29：设置页「快捷键」区组件用例（录制 / 解绑 / 冲突拒绝 / Esc 取消 / 持久化往返）。
 *
 * 记录的是**用户可观测行为**：录制 → onBind(actionId, 规范串)；解绑 → onBind(id, 'none')；
 * 恢复默认 → onBind(id, '')；保留键与占用冲突 → 不写盘 + 明确提示。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import ShortcutsSection from './ShortcutsSection'
import { SHORTCUT_UNBOUND, setShortcutRecording } from '../../state/shortcuts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement
let onBind: ReturnType<typeof vi.fn<(actionId: string, spec: string) => void>>

beforeEach(() => {
  onBind = vi.fn<(actionId: string, spec: string) => void>()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  setShortcutRecording(false)
  vi.restoreAllMocks()
})

async function render(bindings: Record<string, string> = {}): Promise<void> {
  root = createRoot(container)
  await act(async () => {
    root!.render(<ShortcutsSection bindings={bindings} onBind={onBind} />)
  })
}

function el(selector: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(selector)
  if (!node) throw new Error(`未找到元素：${selector}`)
  return node
}

async function click(node: HTMLElement): Promise<void> {
  await act(async () => {
    node.click()
  })
}

/** 在 window 上派发真实 keydown（录制监听挂在 capture 阶段） */
async function press(init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

const row = (actionId: string) => `[data-testid="shortcut-row-${actionId}"]`
const binding = (actionId: string) => `[data-testid="shortcut-binding-${actionId}"]`
const feedback = (actionId: string) => `[data-testid="shortcut-feedback-${actionId}"]`

describe('ShortcutsSection — 动作列表与当前绑定', () => {
  it('渲染编辑器/应用两组动作，未自定义时显示内置默认键位', async () => {
    await render()

    expect(container.textContent).toContain('编辑器')
    expect(container.textContent).toContain('应用')
    expect(el(row('editor.bold'))).toBeTruthy()
    expect(el(row('doc.save'))).toBeTruthy()
    // 未自定义 → 展示内置默认（Mod+B 归一化后即展示值）
    expect(el(binding('editor.bold')).textContent).toContain('Mod+B')
    // task-35：doc.close 已定义并出现在设置页（默认不绑定 → 显示内置默认为空）
    const closeRow = el(row('doc.close'))
    expect(closeRow).toBeTruthy()
    expect(closeRow.textContent).toContain('关闭当前文档')
    expect(el(binding('doc.close')).textContent).toContain('（无）')
    // 保留键清单可见（原生菜单保留键）
    expect(container.querySelectorAll('[data-testid="reserved-key"]').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('Ctrl+N')
  })

  it('已自定义的绑定显示为「自定义」并展示规范串', async () => {
    await render({ 'editor.bold': 'Ctrl+Shift+B' })

    expect(el(binding('editor.bold')).textContent).toContain('Ctrl+Shift+B')
    expect(el(binding('editor.italic')).textContent).toContain('Mod+I') // 其它动作仍是内置默认
  })

  it('已解绑的绑定显示「（已解绑）」且解绑按钮禁用', async () => {
    await render({ 'editor.bold': SHORTCUT_UNBOUND })

    expect(el(binding('editor.bold')).textContent).toContain('已解绑')
    expect(el(`[data-testid="shortcut-unbind-editor.bold"]`) as HTMLButtonElement).toHaveProperty('disabled', true)
  })
})

describe('ShortcutsSection — 录制绑定', () => {
  it('改键：录制后按下组合键 → onBind(actionId, 规范串) 并给出成功反馈', async () => {
    await render()

    await click(el('[data-testid="shortcut-record-editor.bold"]'))
    expect(el(binding('editor.bold')).textContent).toContain('按下新键')

    await press({ key: 'b', ctrlKey: true, shiftKey: true })

    expect(onBind).toHaveBeenCalledWith('editor.bold', 'Ctrl+Shift+B')
    expect(el(feedback('editor.bold')).textContent).toContain('已绑定 Ctrl+Shift+B')
  })

  it('Esc 取消录制：不写盘，并提示已取消', async () => {
    await render()

    await click(el('[data-testid="shortcut-record-editor.bold"]'))
    await press({ key: 'Escape' })

    expect(onBind).not.toHaveBeenCalled()
    expect(el(feedback('editor.bold')).textContent).toContain('已取消录制')
    // 录制已结束：绑定展示恢复
    expect(el(binding('editor.bold')).textContent).not.toContain('按下新键')
  })

  it('冲突拒绝（保留键 Ctrl+N）：不写盘 + 提示保留键原因', async () => {
    await render()

    await click(el('[data-testid="shortcut-record-doc.save"]'))
    await press({ key: 'n', ctrlKey: true })

    expect(onBind).not.toHaveBeenCalled()
    const text = el(feedback('doc.save')).textContent ?? ''
    expect(text).toContain('保留键不可绑定')
    expect(text).toContain('新建文档')
  })

  it('冲突拒绝（键位已被其它动作占用）：不写盘 + 指出占用者', async () => {
    await render({ 'editor.italic': 'Ctrl+Shift+B' })

    await click(el('[data-testid="shortcut-record-editor.bold"]'))
    await press({ key: 'B', ctrlKey: true, shiftKey: true })

    expect(onBind).not.toHaveBeenCalled()
    expect(el(feedback('editor.bold')).textContent).toContain('斜体')
  })

  it('覆盖内置键位属「允许但告警」：写盘并提示将覆盖哪个动作', async () => {
    await render()

    await click(el('[data-testid="shortcut-record-editor.italic"]'))
    await press({ key: 'b', ctrlKey: true }) // Ctrl+B 是「加粗」的内置键位

    expect(onBind).toHaveBeenCalledWith('editor.italic', 'Ctrl+B')
    const text = el(feedback('editor.italic')).textContent ?? ''
    expect(text).toContain('覆盖内置键位')
    expect(text).toContain('加粗')
  })

  it('非法按键（纯修饰键 / 裸字母）不写盘并提示原因', async () => {
    await render()

    await click(el('[data-testid="shortcut-record-editor.bold"]'))
    await press({ key: 'Control', ctrlKey: true })
    expect(onBind).not.toHaveBeenCalled()
    expect(el(feedback('editor.bold')).textContent).toContain('非修饰键')

    await click(el('[data-testid="shortcut-record-editor.bold"]'))
    await press({ key: 'a' })
    expect(onBind).not.toHaveBeenCalled()
    expect(el(feedback('editor.bold')).textContent).toContain('修饰键')
  })
})

describe('ShortcutsSection — 解绑 / 恢复默认 / 持久化往返', () => {
  it('解绑写入墓碑值 none', async () => {
    await render()

    await click(el('[data-testid="shortcut-unbind-editor.bold"]'))

    expect(onBind).toHaveBeenCalledWith('editor.bold', SHORTCUT_UNBOUND)
    expect(el(feedback('editor.bold')).textContent).toContain('已解绑')
  })

  it('恢复默认写入空串（清除自定义 → 回退内置键位）', async () => {
    await render({ 'editor.bold': 'Ctrl+Shift+B' })

    await click(el('[data-testid="shortcut-reset-editor.bold"]'))

    expect(onBind).toHaveBeenCalledWith('editor.bold', '')
    expect(el(feedback('editor.bold')).textContent).toContain('已恢复内置默认')
  })

  it('持久化往返：父组件把保存后的设置回传 → 展示自定义 / 已解绑两种态', async () => {
    // 第一次渲染 = 保存前的空映射
    await render()
    expect(el(binding('editor.bold')).textContent).toContain('Mod+B')

    // 模拟 saveSettings 返回后的新设置（含自定义 + 墓碑）
    await act(async () => {
      root!.render(
        <ShortcutsSection bindings={{ 'editor.bold': 'Ctrl+Shift+B', 'doc.save': SHORTCUT_UNBOUND }} onBind={onBind} />,
      )
    })
    expect(el(binding('editor.bold')).textContent).toContain('Ctrl+Shift+B')
    expect(el(binding('doc.save')).textContent).toContain('已解绑')
  })
})
