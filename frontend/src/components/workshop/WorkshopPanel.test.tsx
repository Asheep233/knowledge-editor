/**
 * UI 工坊 T23：控制面 UI 骨架测试（产品现有测试栈：react-dom/client + act，无 Testing Library）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkshopPanel, type InstalledPackView, type InstallPreviewView, type WorkshopAdapter } from './WorkshopPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PACKS: InstalledPackView[] = [
  { id: 'com.demo.hello', name: 'Hello', version: '2.0.0', active: true, previous: '1.0.0', capabilities: ['ui.shell'] },
]

const PREVIEW: InstallPreviewView = {
  token: 'stage-1',
  packId: 'com.demo.new',
  name: 'New Pack',
  version: '1.0.0',
  apiVersion: 1,
  source: 'downloaded',
  signature: 'missing',
  capabilities: [{ capability: 'ui.shell', risk: 'medium', summary: '替换应用周边 UI 外壳' }],
  warnings: ['该包来自下载且未签名；仅在你信任来源时继续'],
  blocked: false,
}

function makeAdapter(overrides: Partial<WorkshopAdapter> = {}): WorkshopAdapter {
  return {
    listInstalled: vi.fn(async () => PACKS),
    stageFromFile: vi.fn(async () => PREVIEW),
    confirmInstall: vi.fn(async () => undefined),
    cancelPreview: vi.fn(() => true),
    rollback: vi.fn(async () => undefined),
    recover: vi.fn(async () => ({ recovered: true, action: 'rollback-corrupt-active' })),
    recoverAll: vi.fn(async () => ({ checked: 2, safeMode: false, results: [] })),
    uninstall: vi.fn(async () => undefined),
    tierOf: vi.fn(async () => 'community' as const),
    grantTrust: vi.fn(async () => undefined),
    revokeTrust: vi.fn(async () => undefined),
    ...overrides,
  }
}

let root: Root | null = null
let container: HTMLDivElement

const flush = async (times = 2) => {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

const text = () => container.textContent ?? ''
const buttonByText = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement | undefined
const click = async (el: HTMLElement | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

async function mount(adapter: WorkshopAdapter) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<WorkshopPanel adapter={adapter} />)
  })
  await flush()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  container.remove()
})

describe('T23 创意工坊控制面 UI', () => {
  it('渲染已安装包与版本/回滚信息', async () => {
    await mount(makeAdapter())
    expect(text()).toContain('Hello')
    expect(text()).toContain('版本 2.0.0')
    expect(text()).toContain('可回滚到 1.0.0')
  })

  it('选择包 → 展示预览：身份/来源/签名/能力风险/警告', async () => {
    await mount(makeAdapter())
    await click(buttonByText('选择包并预览'))
    const preview = container.querySelector('[aria-label="安装预览"]')
    expect(preview).toBeTruthy()
    expect(preview!.textContent).toContain('com.demo.new')
    expect(preview!.textContent).toContain('downloaded')
    expect(preview!.textContent).toContain('medium')
    expect(preview!.textContent).toContain('ui.shell')
    expect(container.querySelector('[aria-label="安装警告"]')!.textContent).toContain('未签名')
  })

  it('确认安装调用 adapter.confirmInstall(token) 并刷新列表', async () => {
    const adapter = makeAdapter()
    await mount(adapter)
    await click(buttonByText('选择包并预览'))
    await click(buttonByText('确认安装'))
    expect(adapter.confirmInstall).toHaveBeenCalledWith('stage-1')
    expect(adapter.listInstalled).toHaveBeenCalledTimes(2)
    expect(text()).toContain('已安装 New Pack 1.0.0')
  })

  it('取消预览调用 cancelPreview 且不安装', async () => {
    const adapter = makeAdapter()
    await mount(adapter)
    await click(buttonByText('选择包并预览'))
    await click(buttonByText('取消'))
    expect(adapter.cancelPreview).toHaveBeenCalledWith('stage-1')
    expect(adapter.confirmInstall).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="安装预览"]')).toBeNull()
    expect(text()).toContain('已取消安装')
  })

  it('blocked 预览：确认按钮禁用并展示阻止原因', async () => {
    const blocked = { ...PREVIEW, blocked: true, blockReason: 'E_SIGNATURE: 包签名无效，禁止安装' }
    const adapter = makeAdapter({ stageFromFile: vi.fn(async () => blocked) })
    await mount(adapter)
    await click(buttonByText('选择包并预览'))
    const confirm = buttonByText('确认安装')!
    expect(confirm.disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('E_SIGNATURE')
    await click(confirm)
    expect(adapter.confirmInstall).not.toHaveBeenCalled()
  })

  it('回滚/恢复按钮调用 adapter 并显示结果', async () => {
    const adapter = makeAdapter()
    await mount(adapter)
    await click(buttonByText('回滚'))
    expect(adapter.rollback).toHaveBeenCalledWith('com.demo.hello')
    expect(text()).toContain('已回滚 com.demo.hello')
    await click(buttonByText('修复/恢复'))
    expect(adapter.recover).toHaveBeenCalledWith('com.demo.hello')
    expect(text()).toContain('已恢复（rollback-corrupt-active）')
  })

  it('检查/修复全部包：显示检查结果；safeMode 时显示警告', async () => {
    const adapter = makeAdapter({ recoverAll: vi.fn(async () => ({ checked: 3, safeMode: true, results: [] })) })
    await mount(adapter)
    await click(buttonByText('检查/修复全部包'))
    expect(adapter.recoverAll).toHaveBeenCalled()
    expect(text()).toContain('已检查 3 个包')
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('safe mode')
  })

  it('卸载按钮：内联二次确认后调用 adapter.uninstall 并刷新', async () => {
    const adapter = makeAdapter()
    await mount(adapter)
    await click(buttonByText('卸载'))
    expect(container.querySelector('[role="alertdialog"]')).toBeTruthy()
    expect(adapter.uninstall).not.toHaveBeenCalled()
    await click(buttonByText('确认卸载'))
    expect(adapter.uninstall).toHaveBeenCalledWith('com.demo.hello')
    expect(text()).toContain('已卸载 com.demo.hello')
  })

  it('卸载二次确认可取消（不调用 adapter）', async () => {
    const adapter = makeAdapter()
    await mount(adapter)
    await click(buttonByText('卸载'))
    await click(buttonByText('取消'))
    expect(adapter.uninstall).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('信任等级展示 + 授予/撤销信任调用 adapter 并刷新', async () => {
    let tier: 'community' | 'trusted' = 'community'
    const adapter = makeAdapter({
      tierOf: vi.fn(async () => tier),
      grantTrust: vi.fn(async () => {
        tier = 'trusted'
      }),
      revokeTrust: vi.fn(async () => {
        tier = 'community'
      }),
    })
    await mount(adapter)
    expect(text()).toContain('信任：community')
    await click(buttonByText('授予信任'))
    expect(adapter.grantTrust).toHaveBeenCalledWith('com.demo.hello', 'trusted')
    expect(text()).toContain('已将 com.demo.hello 设为 trusted')
    await click(buttonByText('撤销信任'))
    expect(adapter.revokeTrust).toHaveBeenCalledWith('com.demo.hello')
    expect(text()).toContain('已撤销 com.demo.hello 的信任')
  })

  it('签名状态展示（valid/invalid/missing 徽章）', async () => {
    const adapter = makeAdapter({
      listInstalled: vi.fn(async () => [{ ...PACKS[0], signature: 'invalid' as const }]),
    })
    await mount(adapter)
    expect(text()).toContain('签名：invalid')
  })

  it('W01：提供 stageFromZip 时显示 ZIP 按钮并进入预览', async () => {
    const adapter = makeAdapter({ stageFromZip: vi.fn(async () => PREVIEW) })
    await mount(adapter)
    await click(buttonByText('选择 ZIP 离线包'))
    expect(adapter.stageFromZip).toHaveBeenCalled()
    expect(text()).toContain('com.demo.new')
  })

  it('adapter 报错时展示可读错误', async () => {
    const adapter = makeAdapter({
      listInstalled: vi.fn(async () => {
        throw new Error('磁盘不可读')
      }),
    })
    await mount(adapter)
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('磁盘不可读')
  })
})

describe('W07 C1-4/C2-2/C3-5：启动恢复结果 UI 提示', () => {
  const rollbackStatus = {
    found: true,
    checked: 2,
    safeMode: false,
    generatedAt: 'SystemTime { t: 1 }',
    results: [
      { id: 'com.demo.a', recovered: true, action: 'rollback-corrupt-active' },
      { id: 'com.demo.b', recovered: true, action: 'cleanup-journal' },
      { id: 'com.demo.c', recovered: false, action: 'clean' },
    ],
  }

  it('有恢复动作 → 显示持久 notice（动作/详情/可关闭），不调用 recoverAll', async () => {
    const adapter = makeAdapter({ startupStatus: vi.fn(async () => rollbackStatus) })
    await mount(adapter)
    await flush(2)
    const notice = container.querySelector('[data-testid="startup-recover-notice"]')
    expect(notice).toBeTruthy()
    expect(notice!.textContent).toContain('已自动恢复 2 个包')
    expect(notice!.textContent).toContain('已回滚到上一版本')
    expect(notice!.textContent).toContain('已清理中断安装残留')
    expect(notice!.textContent).not.toContain('无需恢复')
    expect(notice!.textContent).toContain('共检查 2 个包')
    expect(adapter.startupStatus).toHaveBeenCalledTimes(1)
    expect(adapter.recoverAll).not.toHaveBeenCalled()
    // 关闭后不再显示
    await click(buttonByText('关闭'))
    expect(container.querySelector('[data-testid="startup-recover-notice"]')).toBeNull()
  })

  it('safeMode → notice 提示 + 既有 safeMode 横幅立即显示（预置 recoverStatus）', async () => {
    const adapter = makeAdapter({
      startupStatus: vi.fn(async () => ({
        found: true,
        checked: 1,
        safeMode: true,
        results: [{ id: 'com.demo.bad', recovered: false, action: 'corrupt-no-fallback' }],
      })),
    })
    await mount(adapter)
    await flush(2)
    expect(container.querySelector('[data-testid="startup-recover-notice"]')!.textContent).toContain('safe mode')
    expect(text()).toContain('有包无法自动恢复（safe mode）')
    expect(text()).toContain('损坏且无可用回退')
    expect(adapter.recoverAll).not.toHaveBeenCalled()
  })

  it('无启动恢复文件/无动作/无 safeMode → 不显示（不误报）', async () => {
    const notFound = makeAdapter({ startupStatus: vi.fn(async () => ({ found: false, checked: 0, safeMode: false, results: [] })) })
    await mount(notFound)
    await flush(2)
    expect(container.querySelector('[data-testid="startup-recover-notice"]')).toBeNull()
    expect(text()).not.toContain('有包无法自动恢复（safe mode）')

    if (root) {
      await act(async () => root!.unmount())
      root = null
    }
    container.remove()
    const cleanOnly = makeAdapter({
      startupStatus: vi.fn(async () => ({
        found: true,
        checked: 1,
        safeMode: false,
        results: [{ id: 'com.demo.x', recovered: false, action: 'clean' }],
      })),
    })
    await mount(cleanOnly)
    await flush(2)
    expect(container.querySelector('[data-testid="startup-recover-notice"]')).toBeNull()
  })

  it('旧构建无 startupStatus 能力 / 读取抛错 → 面板正常渲染、不误报', async () => {
    const legacy = makeAdapter()
    delete (legacy as { startupStatus?: unknown }).startupStatus
    await mount(legacy)
    expect(text()).toContain('已安装包')
    expect(container.querySelector('[data-testid="startup-recover-notice"]')).toBeNull()

    if (root) {
      await act(async () => root!.unmount())
      root = null
    }
    container.remove()
    const failing = makeAdapter({ startupStatus: vi.fn(async () => { throw new Error('E_UNKNOWN_COMMAND') }) })
    await mount(failing)
    await flush(2)
    expect(container.querySelector('[data-testid="startup-recover-notice"]')).toBeNull()
    expect(text()).not.toContain('E_UNKNOWN_COMMAND')
  })
})
