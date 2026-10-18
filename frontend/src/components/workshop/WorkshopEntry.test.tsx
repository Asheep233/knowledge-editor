/** UI 工坊 T23：工坊入口（flag 关闭零渲染；开启后打开面板）。 */
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkshopEntry } from './WorkshopEntry'
import type { WorkshopAdapter } from './WorkshopPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeAdapter(): WorkshopAdapter {
  return {
    listInstalled: vi.fn(async () => []),
    stageFromFile: vi.fn(async () => null),
    confirmInstall: vi.fn(async () => undefined),
    cancelPreview: vi.fn(() => true),
    rollback: vi.fn(async () => undefined),
    recover: vi.fn(async () => ({ recovered: false, action: 'clean' })),
  }
}

let root: Root | null = null
let container: HTMLDivElement

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function mount(el: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(el)
  })
  await flush()
}

const buttonByText = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement | undefined

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

describe('T23 工坊入口', () => {
  it('flag 关闭时零渲染（既有 App 不受影响）', async () => {
    await mount(<WorkshopEntry enabled={false} adapter={makeAdapter()} />)
    expect(container.innerHTML).toBe('')
  })

  it('flag 开启显示入口，点击打开面板并加载已安装包', async () => {
    const adapter = makeAdapter()
    await mount(<WorkshopEntry enabled adapter={adapter} />)
    const entry = buttonByText('创意工坊')
    expect(entry).toBeTruthy()
    await act(async () => {
      entry!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.textContent).toContain('已安装包')
    expect(adapter.listInstalled).toHaveBeenCalled()
  })

  it('点击关闭后对话框消失', async () => {
    await mount(<WorkshopEntry enabled adapter={makeAdapter()} />)
    await act(async () => {
      buttonByText('创意工坊')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    await act(async () => {
      buttonByText('关闭')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
