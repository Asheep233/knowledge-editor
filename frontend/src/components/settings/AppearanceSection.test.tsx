import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppearancePackage } from '../../appearance/model'
import { APPEARANCE_CONTRACT, EXAMPLE_APPEARANCE } from '../../appearance/model'
import AppearanceSection from './AppearanceSection'

const controller = vi.hoisted(() => ({
  state: { schemaVersion: 1 as const, current: null as AppearancePackage | null, previous: null as AppearancePackage | null },
  previewPackage: null as AppearancePackage | null,
  status: { mode: 'default' as 'default' | 'active' | 'preview' | 'fallback', reason: null as string | null, previewExpiresAt: null as number | null, rawAvailable: false },
  apply: vi.fn(),
  preview: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
  rollback: vi.fn(),
  export: vi.fn(),
  backup: vi.fn(),
}))

vi.mock('../../appearance/controller', () => ({
  getAppearanceState: () => controller.state,
  getAppearanceStatus: () => controller.status,
  getPreviewAppearance: () => controller.previewPackage,
  applyAppearance: controller.apply,
  previewAppearance: controller.preview,
  cancelAppearancePreview: controller.cancel,
  resetAppearance: controller.reset,
  rollbackAppearance: controller.rollback,
  exportAppearance: controller.export,
  exportAppearanceBackup: controller.backup,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null
let container: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks()
  controller.state = { schemaVersion: 1, current: null, previous: null }
  controller.status = { mode: 'default', reason: null, previewExpiresAt: null, rawAvailable: false }
  controller.previewPackage = null
  controller.preview.mockImplementation((pkg: AppearancePackage) => {
    controller.previewPackage = pkg
    controller.status = { ...controller.status, mode: 'preview', previewExpiresAt: Date.now() + 30_000 }
    window.dispatchEvent(new Event('ke:appearance-changed'))
    return controller.state
  })
  controller.cancel.mockImplementation(() => {
    controller.previewPackage = null
    controller.status = { ...controller.status, mode: controller.state.current ? 'active' : 'default', previewExpiresAt: null }
    window.dispatchEvent(new Event('ke:appearance-changed'))
  })
  controller.apply.mockImplementation(async (pkg: AppearancePackage) => {
    controller.state = { schemaVersion: 1, current: pkg, previous: controller.state.current }
    controller.previewPackage = null
    controller.status = { ...controller.status, mode: 'active', previewExpiresAt: null }
    window.dispatchEvent(new Event('ke:appearance-changed'))
    return controller.state
  })
  controller.reset.mockResolvedValue(controller.state)
  controller.rollback.mockResolvedValue(controller.state)
  controller.export.mockReturnValue(JSON.stringify(EXAMPLE_APPEARANCE))
  controller.backup.mockReturnValue('{"schemaVersion":99,"unrecognized":"preserved"}')
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function render() {
  root = createRoot(container)
  await act(async () => root!.render(<AppearanceSection />))
}

function button(text: string) {
  const found = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === text)
  if (!found) throw new Error(`找不到按钮：${text}`)
  return found
}

async function click(text: string) {
  await act(async () => button(text).click())
}

const textarea = () => container.querySelector('textarea')!
const previewBar = () => document.querySelector<HTMLElement>('[data-testid="appearance-preview-bar"]')

async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), value)
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function changed() {
  await act(async () => window.dispatchEvent(new Event('ke:appearance-changed')))
}

describe('AppearanceSection', () => {
  it('拒绝无效 JSON，错误显示在表单中，预览与应用均不写入', async () => {
    await render()
    await type('{broken')
    await click('预览 30 秒')
    await click('应用外观')

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('有效 JSON')
    expect(controller.preview).not.toHaveBeenCalled()
    expect(controller.apply).not.toHaveBeenCalled()
    expect(textarea().value).toBe('{broken')
  })

  it('示例可预览 30 秒，状态事件及预览过期保留用户草稿', async () => {
    vi.useFakeTimers()
    await render()
    await click('载入示例')
    await click('预览 30 秒')

    expect(controller.preview).toHaveBeenCalledWith(EXAMPLE_APPEARANCE, 30_000)
    expect(previewBar()?.textContent).toContain('30 秒后自动恢复')
    expect(previewBar()?.parentElement).toBe(document.body)
    expect(previewBar()?.hasAttribute('data-ke-toolbar')).toBe(true)
    container.style.display = 'none'
    // 视觉断言同步（Focus §4）：预览确认条硬编码 hex 已改为设计令牌，断言值随之改为令牌字符串。
    expect(previewBar()?.style.backgroundColor).toBe('var(--card)')
    expect(previewBar()?.style.color).toBe('var(--foreground)')
    await act(async () => vi.advanceTimersByTime(1000))
    expect(previewBar()?.textContent).toContain('29 秒后自动恢复')
    await type('未完成的下一份草稿')
    controller.status = { ...controller.status, mode: 'default', previewExpiresAt: null }
    controller.previewPackage = null
    await changed()

    expect(textarea().value).toBe('未完成的下一份草稿')
    expect(previewBar()).toBeNull()
  })

  it('确认条应用当前真实预览包，SDK替换预览后不会应用过时草稿', async () => {
    await render()
    await click('载入示例')
    await click('预览 30 秒')
    const replaced = { ...EXAMPLE_APPEARANCE, id: 'sdk-preview', name: 'SDK 新预览' }
    controller.previewPackage = replaced
    await changed()
    await click('保留此外观')

    expect(controller.apply).toHaveBeenCalledWith(replaced)
    expect(previewBar()).toBeNull()
    expect(JSON.parse(textarea().value)).toEqual(EXAMPLE_APPEARANCE)
  })

  it('确认条保存失败时继续显示预览与错误，可取消返回设置', async () => {
    controller.apply.mockRejectedValue(new Error('保存失败，请重试'))
    await render()
    await click('载入示例')
    await click('预览 30 秒')
    await click('保留此外观')

    expect(previewBar()?.querySelector('[role="alert"]')?.textContent).toContain('保存失败，请重试')
    expect(controller.status.mode).toBe('preview')
    expect(button('保留此外观').disabled).toBe(false)
    await click('取消预览')
    expect(previewBar()).toBeNull()
    expect(controller.cancel).toHaveBeenCalledOnce()
    expect(JSON.parse(textarea().value)).toEqual(EXAMPLE_APPEARANCE)
  })

  it('关闭设置时取消预览', async () => {
    await render()
    await click('载入示例')
    await click('预览 30 秒')
    await act(async () => root!.unmount())
    root = null

    expect(controller.cancel).toHaveBeenCalledOnce()
  })

  it('校验通过后应用，保存失败时保留草稿并显示原因', async () => {
    controller.apply.mockRejectedValue(new Error('磁盘已满'))
    await render()
    await click('载入示例')
    await click('应用外观')

    expect(controller.apply).toHaveBeenCalledWith(EXAMPLE_APPEARANCE)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('磁盘已满')
    expect(JSON.parse(textarea().value)).toEqual(EXAMPLE_APPEARANCE)
    expect(button('应用外观').disabled).toBe(false)
  })

  it('当前外观存在时可回滚到默认，恢复默认按钮有固定高对比颜色', async () => {
    controller.state.current = EXAMPLE_APPEARANCE
    controller.status.mode = 'active'
    await render()

    expect(button('回滚上一个').disabled).toBe(false)
    // 视觉断言同步（Focus §4）：恢复默认按钮的固定高对比色改为令牌（--foreground / --card），
    // 仍以 inline style 表达；断言值同步为令牌字符串（仅视觉断言更新，行为断言未改）。
    expect(button('恢复默认').style.color).toBe('var(--foreground)')
    expect(button('恢复默认').style.backgroundColor).toBe('var(--card)')
    await click('回滚上一个')
    expect(controller.rollback).toHaveBeenCalledOnce()
  })

  it('不兼容时解释回退，并按原样导出原始备份', async () => {
    controller.status = { mode: 'fallback', reason: '接口版本不兼容', previewExpiresAt: null, rawAvailable: true }
    let exported: Blob | undefined
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      exported = value as Blob
      return 'blob:appearance-test'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await render()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('接口版本不兼容')
    await click('导出原始备份')

    expect(controller.backup).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
    expect(await exported!.text()).toBe('{"schemaVersion":99,"unrecognized":"preserved"}')
  })

  it('导入文件只载入并校验，不会直接应用', async () => {
    await render()
    const input = container.querySelector('input[type="file"]')!
    const file = new File([JSON.stringify(EXAMPLE_APPEARANCE)], 'sage.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))

    expect(JSON.parse(textarea().value)).toEqual(EXAMPLE_APPEARANCE)
    expect(container.textContent).toContain('已载入 sage.json')
    expect(controller.apply).not.toHaveBeenCalled()
    expect(controller.preview).not.toHaveBeenCalled()
  })

  it('拒绝超过大小限制的文件，保留原有草稿', async () => {
    await render()
    await type('保留草稿')
    const input = container.querySelector('input[type="file"]')!
    const file = new File(['x'.repeat(APPEARANCE_CONTRACT.maxBytes + 1)], 'large.json')
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('不能超过')
    expect(textarea().value).toBe('保留草稿')
    expect(controller.apply).not.toHaveBeenCalled()
  })
})
