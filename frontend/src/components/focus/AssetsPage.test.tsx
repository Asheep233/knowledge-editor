/**
 * Focus 资料页（AssetsPage）行为测试。
 *
 * 覆盖：
 *  ① 附件网格渲染（图片/视频缩略图、其它类型扩展名标签、名称/大小/引用徽章）；
 *  ② 副标题统计（附件数/总大小/未引用数）+ 未引用提示条；
 *  ③ 类型 chips 筛选、仅看未引用筛选；
 *  ④ 上传（<input type=file> → uploadAttachment 逐个上传 → 刷新 + 结果反馈）；
 *  ⑤ 孤儿附件删除（askConfirm 确认；被引用附件不出现删除按钮；取消不删除；失败提示）；
 *  ⑥ 加载中 / 加载失败 + 重试 / 空态 / refreshToken 刷新。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import * as api from '../../api/client'
import type { AttachmentItem, AttachmentListPayload } from '../../types'
import { AssetsPage } from './AssetsPage'
import type { FocusPageProps } from './pageTypes'

const promptMocks = vi.hoisted(() => ({
  askPrompt: vi.fn(async (_title?: string, _defaultValue?: string) => null as string | null),
  askConfirm: vi.fn(async (_msg: string, _opts?: unknown) => true as boolean),
}))
vi.mock('../common/PromptDialog', () => ({
  askPrompt: promptMocks.askPrompt,
  askConfirm: promptMocks.askConfirm,
  usePrompt: () => promptMocks.askPrompt,
  PromptHost: () => null,
  PromptRoot: ({ children }: { children: unknown }) => children,
}))

vi.mock('../../api/client', () => ({
  attachmentUrl: (rel: string) => `/api/att/${rel}`,
  listAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ATTACHMENTS: AttachmentItem[] = [
  {
    rel_path: 'Attachments/images/示意图.png',
    name: '示意图.png',
    category: 'images',
    size: 12 * 1024,
    mtime: '2026-10-12T03:00:00Z',
    referenced_by: ['Articles/甲.md', 'Articles/乙.md'],
  },
  {
    rel_path: 'Attachments/videos/慢动作.mp4',
    name: '慢动作.mp4',
    category: 'videos',
    size: 18.6 * 1024 * 1024,
    mtime: '2026-10-11T03:00:00Z',
    referenced_by: [],
  },
  {
    rel_path: 'Attachments/files/Ref-2024.pdf',
    name: 'Ref-2024.pdf',
    category: 'files',
    size: 1.8 * 1024 * 1024,
    mtime: '2026-10-10T03:00:00Z',
    referenced_by: ['Articles/甲.md'],
  },
  {
    rel_path: 'Attachments/files/验证.py',
    name: '验证.py',
    category: 'files',
    size: 2100,
    mtime: '2026-10-09T03:00:00Z',
    referenced_by: [],
  },
]

function payload(items: AttachmentItem[] = ATTACHMENTS): AttachmentListPayload {
  return { count: items.length, attachments: items }
}

let root: Root | null = null
let container: HTMLDivElement

function byTestId(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}
function text(): string {
  return container.textContent ?? ''
}
function allButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}
function buttonByText(label: string): HTMLButtonElement | undefined {
  return allButtons().find((b) => (b.textContent ?? '').replace(/\s+/g, '').includes(label.replace(/\s+/g, '')))
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

async function mount(overrides: Partial<FocusPageProps> = {}): Promise<FocusPageProps> {
  const props: FocusPageProps = {
    onNavigate: vi.fn(),
    onOpenArticle: vi.fn(),
    onNewArticle: vi.fn(),
    refreshToken: 0,
    ...overrides,
  }
  await act(async () => {
    root = createRoot(container)
    root.render(<AssetsPage {...props} />)
  })
  await settle()
  return props
}

async function rerender(props: FocusPageProps): Promise<void> {
  await act(async () => {
    root!.render(<AssetsPage {...props} />)
  })
  await settle()
}

async function click(el: Element | null | undefined, label: string): Promise<void> {
  expect(el, `未找到可点击元素：${label}`).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  promptMocks.askConfirm.mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.mocked(api.listAttachments).mockResolvedValue(payload())
  vi.mocked(api.deleteAttachment).mockResolvedValue({ deleted: 'ok' })
  vi.mocked(api.uploadAttachment).mockImplementation(async (file: File) => ({
    path: `Attachments/images/${file.name}`,
    url: `/api/att/Attachments/images/${file.name}`,
    category: 'images' as const,
    size: file.size,
    name: file.name,
  }))
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

describe('AssetsPage · 数据渲染', () => {
  it('渲染附件网格：图片/视频缩略图、扩展名标签、名称/大小/引用徽章', async () => {
    await mount()
    expect(api.listAttachments).toHaveBeenCalledTimes(1)
    // 副标题：4 个附件 · 总大小 · 2 个未被引用
    expect(text()).toContain('4 个附件')
    expect(text()).toContain('2 个未被引用')
    // 图片缩略图 + 引用徽章
    const img = byTestId('asset-thumb-img-Attachments/images/示意图.png') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('/api/att/Attachments/images/示意图.png')
    expect(byTestId('asset-ref-Attachments/images/示意图.png')?.textContent).toContain('已引用 2')
    // 视频缩略图
    expect(byTestId('asset-thumb-video-Attachments/videos/慢动作.mp4')).toBeTruthy()
    expect(byTestId('asset-unref-Attachments/videos/慢动作.mp4')?.textContent).toContain('未引用')
    // 其它类型显示扩展名
    expect(text()).toContain('PDF')
    expect(text()).toContain('PY')
    // 文件大小
    expect(text()).toContain('12.0 KB')
    expect(text()).toContain('2.1 KB')
    // 未引用提示条
    expect(byTestId('orphan-note')?.textContent).toContain('2 个附件未被任何文档引用')
    // 底部保护说明
    expect(text()).toContain('被引用的附件受保护')
  })

  it('chips 显示分类数量，点击切换分类筛选', async () => {
    await mount()
    const chips = ['全部 4', '图片 1', '视频 1', '文件 2']
    for (const chip of chips) expect(buttonByText(chip), `缺少 chip ${chip}`).toBeTruthy()
    await click(buttonByText('图片'), '图片 chip')
    expect(byTestId('asset-card-Attachments/images/示意图.png')).toBeTruthy()
    expect(byTestId('asset-card-Attachments/files/Ref-2024.pdf')).toBeNull()
    await click(buttonByText('文件'), '文件 chip')
    expect(byTestId('asset-card-Attachments/files/Ref-2024.pdf')).toBeTruthy()
    expect(byTestId('asset-card-Attachments/videos/慢动作.mp4')).toBeNull()
  })

  it('「仅看未引用」只显示 referenced_by 为空的附件，再点恢复', async () => {
    await mount()
    const toggle = byTestId('orphans-only')
    await click(toggle, '仅看未引用')
    expect(toggle?.getAttribute('aria-pressed')).toBe('true')
    expect(byTestId('asset-card-Attachments/videos/慢动作.mp4')).toBeTruthy()
    expect(byTestId('asset-card-Attachments/files/验证.py')).toBeTruthy()
    expect(byTestId('asset-card-Attachments/images/示意图.png')).toBeNull()
    await click(toggle, '仅看未引用（再次点击）')
    expect(byTestId('asset-card-Attachments/images/示意图.png')).toBeTruthy()
  })

  it('提示条内「只看未引用」快捷入口生效', async () => {
    await mount()
    await click(buttonByText('只看未引用'), '提示条快捷入口')
    expect(byTestId('asset-card-Attachments/images/示意图.png')).toBeNull()
    expect(byTestId('asset-card-Attachments/files/验证.py')).toBeTruthy()
  })

  it('refreshToken 变化触发重新取数', async () => {
    const props = await mount()
    await rerender({ ...props, refreshToken: 2 })
    expect(api.listAttachments).toHaveBeenCalledTimes(2)
  })
})

describe('AssetsPage · 加载/错误/空态', () => {
  it('加载中显示占位文案，完成后渲染网格', async () => {
    let resolveList: ((v: AttachmentListPayload) => void) | null = null
    vi.mocked(api.listAttachments).mockImplementation(
      () => new Promise<AttachmentListPayload>((resolve) => {
        resolveList = resolve
      }),
    )
    await act(async () => {
      root = createRoot(container)
      root.render(
        <AssetsPage onNavigate={vi.fn()} onOpenArticle={vi.fn()} onNewArticle={vi.fn()} refreshToken={0} />,
      )
    })
    expect(byTestId('loading-state')?.textContent).toContain('加载中')
    await act(async () => {
      resolveList?.(payload())
    })
    await settle()
    expect(byTestId('assets-grid')).toBeTruthy()
  })

  it('加载失败显示错误态，点重试恢复', async () => {
    vi.mocked(api.listAttachments).mockRejectedValueOnce(new Error('backend down'))
    await mount()
    expect(byTestId('error-state')?.textContent).toContain('附件加载失败')
    await click(buttonByText('重试'), '重试按钮')
    expect(byTestId('assets-grid')).toBeTruthy()
    expect(api.listAttachments).toHaveBeenCalledTimes(2)
  })

  it('空态：没有附件时显示引导与上传入口', async () => {
    vi.mocked(api.listAttachments).mockResolvedValue(payload([]))
    await mount()
    expect(byTestId('empty-state')?.textContent).toContain('还没有附件')
    expect(byTestId('upload-attachment')).toBeTruthy()
  })

  it('筛选无结果时显示空结果态', async () => {
    vi.mocked(api.listAttachments).mockResolvedValue(payload([ATTACHMENTS[0]]))
    await mount()
    await click(byTestId('orphans-only'), '仅看未引用')
    expect(byTestId('empty-state')?.textContent).toContain('没有匹配的附件')
  })
})

describe('AssetsPage · 上传', () => {
  it('选择文件 → 逐个 uploadAttachment → 刷新列表并提示成功', async () => {
    vi.mocked(api.listAttachments)
      .mockResolvedValueOnce(payload())
      .mockResolvedValueOnce(
        payload([
          ...ATTACHMENTS,
          { ...ATTACHMENTS[0], rel_path: 'Attachments/images/新图.png', name: '新图.png', referenced_by: [] },
        ]),
      )
    await mount()
    const input = byTestId('asset-upload-input') as HTMLInputElement
    const files = [new File(['aaa'], '新图.png', { type: 'image/png' })]
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(api.uploadAttachment).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.uploadAttachment).mock.calls[0][0].name).toBe('新图.png')
    expect(api.listAttachments).toHaveBeenCalledTimes(2)
    expect(byTestId('page-status')?.textContent).toContain('已上传')
    expect(byTestId('asset-card-Attachments/images/新图.png')).toBeTruthy()
  })

  it('上传失败：给出错误反馈，不崩溃', async () => {
    vi.mocked(api.uploadAttachment).mockRejectedValue(new Error('413 文件过大'))
    await mount()
    const input = byTestId('asset-upload-input') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'too-big.png')], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(byTestId('page-status')?.textContent).toContain('失败')
  })
})

describe('AssetsPage · 孤儿删除', () => {
  it('未引用附件有删除按钮；确认后 deleteAttachment 并刷新', async () => {
    await mount()
    // 被引用附件不出现删除按钮
    expect(byTestId('asset-delete-Attachments/images/示意图.png')).toBeNull()
    const del = byTestId('asset-delete-Attachments/videos/慢动作.mp4')
    expect(del).toBeTruthy()
    await click(del, '删除未引用附件')
    expect(promptMocks.askConfirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(promptMocks.askConfirm).mock.calls[0][0]).toContain('慢动作.mp4')
    expect(api.deleteAttachment).toHaveBeenCalledWith('Attachments/videos/慢动作.mp4')
    expect(api.listAttachments).toHaveBeenCalledTimes(2)
    expect(byTestId('page-status')?.textContent).toContain('已删除附件')
  })

  it('取消确认不删除', async () => {
    promptMocks.askConfirm.mockResolvedValue(false)
    await mount()
    await click(byTestId('asset-delete-Attachments/files/验证.py'), '删除未引用附件')
    expect(api.deleteAttachment).not.toHaveBeenCalled()
    expect(api.listAttachments).toHaveBeenCalledTimes(1)
  })

  it('删除失败（如后端判定仍被引用）：提示错误', async () => {
    vi.mocked(api.deleteAttachment).mockRejectedValue(new Error('409 附件被引用，禁止删除'))
    await mount()
    await click(byTestId('asset-delete-Attachments/files/验证.py'), '删除未引用附件')
    expect(byTestId('page-status')?.textContent).toContain('删除失败')
  })
})
