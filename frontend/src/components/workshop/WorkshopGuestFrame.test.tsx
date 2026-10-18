/** UI 工坊 A7：guest 宿主 UI（blocked/启用路径；产品测试栈 react-dom/client + act）。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PACK_API_VERSION, type PackManifest } from '../../core/packs/manifest'
import type { GuestHostBackend } from '../../core/packs/guestHost'
import { WorkshopGuestFrame } from './WorkshopGuestFrame'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MANIFEST: PackManifest = {
  id: 'com.demo.guest',
  name: 'Guest Demo',
  version: '1.0.0',
  apiVersion: PACK_API_VERSION,
  capabilities: ['ui.shell', 'context.read'],
  entry: { html: 'index.html' },
  commands: [],
  assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
}

function backend(): GuestHostBackend {
  return {
    verify: vi.fn(async () => true),
    readManifest: vi.fn(async () => MANIFEST),
    deactivate: vi.fn(async () => undefined),
    recover: vi.fn(async () => ({ recovered: true, action: 'clean' })),
    loadEntry: vi.fn(async () => ({ html: '<!doctype html><html><body>guest</body></html>', assets: {} })),
    reportSession: vi.fn(async () => undefined),
  }
}

let root: Root | null = null
let container: HTMLDivElement

const flush = async (times = 3) => {
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

async function mount(tier: 'trusted' | 'community') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<WorkshopGuestFrame packId="com.demo.guest" version="1.0.0" tier={tier} backend={backend()} />)
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

describe('A7 WorkshopGuestFrame', () => {
  it('community 等级能力不允许 → 显示错误、不渲染 iframe', async () => {
    await mount('community')
    await click(buttonByText('启用 guest'))
    expect(text()).toMatch(/E_CAPABILITY_TIER/)
    expect(text()).toContain('guest：failed')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('trusted 等级启用 → active + 能力显示 + iframe 渲染', async () => {
    await mount('trusted')
    await click(buttonByText('启用 guest'))
    expect(text()).toContain('guest：active')
    expect(text()).toContain('ui.shell, context.read')
    expect(container.querySelector('iframe')).not.toBeNull()
  })
})
