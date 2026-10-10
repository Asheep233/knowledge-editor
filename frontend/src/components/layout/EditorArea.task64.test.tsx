/**
 * task-64（第三份外部审查）P1 三连之 A01/A12 回归套件。
 *  - **A01**：源码模式工具栏命令 → 隐藏 ProseMirror 用旧正文发 PUT，删掉刚保存的新段落。
 *    入口（工具栏正文命令整体禁用 + 快捷键命令守卫）与保存通道（PM saveFn 执行时校验）双重拦截。
 *  - **A12**：A 文档上传附件期间切到 B → 结果不得插入 B、不得落盘，并给出「回到发起文档」的明确提示。
 * A13（草稿恢复被旧界面覆盖）见 `src/App.recoveryReload.test.tsx`。
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import type { ArticleMeta } from '../../types'

const CS = vi.hoisted(() => ({
  md: '',
  onUpdate: null as null | (() => void),
  insertCalls: [] as unknown[],
  setKeContentCalls: [] as string[],
  confirmMessages: [] as string[],
  alerts: [] as string[],
  autosaveMs: 1,
  requests: [] as Array<{ method: string; url: string; body: unknown }>,
  hangUpload: false,
  uploadRelease: null as null | (() => void),
  uploadStarted: 0,
}))

vi.mock('@tiptap/react', () => ({
  EditorContext: { Provider: (props: { children?: unknown }) => props.children },
  EditorContent: () => null,
}))
vi.mock('../../editor', () => ({
  useKeEditor: (opts: { onUpdate?: () => void }) => {
    CS.onUpdate = opts.onUpdate ?? null
    return {
      getMarkdown: () => CS.md,
      setEditable: () => undefined,
      get isEditable() {
        return true
      },
      isFocused: false,
      schema: {
        nodes: {
          attach: { create: (attrs: unknown) => ({ type: 'attach', attrs }) },
          video: { create: (attrs: unknown) => ({ type: 'video', attrs }) },
        },
      },
      commands: { focus: () => undefined, setContent: () => undefined, command: () => undefined },
      chain: () => {
        const chain = {
          focus: () => chain,
          insertContent: (node: unknown) => {
            CS.insertCalls.push(node)
            return chain
          },
          run: () => true,
        }
        return chain
      },
    }
  },
  setKeContent: (_ed: unknown, md: string) => {
    // 真实实现会把正文载入编辑器（此后 getMarkdown() 返回该正文）——mock 必须等价
    CS.setKeContentCalls.push(md)
    CS.md = md
  },
}))
vi.mock('../../settings', () => ({ getAutosaveIntervalMs: () => CS.autosaveMs }))
vi.mock('../editor/EditorToolbar', () => ({
  default: (props: { onToggleViewMode?: () => void }) => (
    <button type="button" data-testid="toggle" onClick={props.onToggleViewMode}>
      toggle
    </button>
  ),
  stripModuleTitle: (s: string) => s,
}))
vi.mock('../editor/TableBubbleMenu', () => ({ default: () => null }))
vi.mock('../editor/MathEditorModal', () => ({ default: () => null }))
vi.mock('../editor/nodeviews/MathNodeView', () => ({ MATH_EDIT_EVENT: 'ke:math-edit' }))
vi.mock('../common/PromptDialog', () => ({
  askConfirm: async (msg: string) => {
    CS.confirmMessages.push(msg)
    return true
  },
  askPrompt: async () => null,
  PromptRoot: (props: { children?: unknown }) => props.children,
  PromptHost: () => null,
  usePrompt: () => async () => null,
}))
// A12：只替换 uploadAttachment（可挂起），其余 API 走真实实现 + fetch 桩
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return {
    ...actual,
    uploadAttachment: async (file: File) => {
      CS.uploadStarted += 1
      if (CS.hangUpload) await new Promise<void>((r) => (CS.uploadRelease = r))
      return {
        path: `Attachments/${file.name}`,
        name: file.name,
        category: 'files',
        size: 1,
      }
    },
  }
})

const EditorArea = (await import('./EditorArea')).default
const { guardBodyCommands } = await import('./EditorArea')
const { __resetViewModeForTest, getViewMode } = await import('../../state/viewMode')
const { runAction, registerActionHandler, __clearActionHandlers } = await import('../../state/shortcuts')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: '200',
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

function installFetch(): void {
  ;(globalThis as { fetch: unknown }).fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined
    } catch {
      body = undefined
    }
    CS.requests.push({ method, url, body })
    if (method === 'DELETE') return jsonResponse(undefined)
    return jsonResponse({
      id: 'Articles/a.md',
      path: 'Articles/a.md',
      title: 'a',
      content: (body as { content?: string })?.content ?? '',
      tags: [],
      meta: {},
      word_count: 1,
      updated_at: '2026-01-01T00:00:00Z',
    })
  })
}

const article = (id: string, title: string, content: string): ArticleMeta => ({
  id,
  path: id,
  title,
  content,
  tags: [],
  word_count: 1,
  updated_at: '2026-01-01T00:00:00Z',
})

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

const RAW = `---\nke_version: 1\ntitle: a\n---\n\nBASELINE_OLD\n\n$x+1$\n`

function tree(current: ArticleMeta) {
  return <EditorArea article={current} loading={false} onNewArticle={() => undefined} onSaved={() => undefined} />
}

async function render(current: ArticleMeta): Promise<void> {
  CS.md = current.content
  root = createRoot(container)
  await act(async () => {
    root!.render(tree(current))
  })
  await settle()
}

async function rerender(next: ArticleMeta): Promise<void> {
  await act(async () => {
    root!.render(tree(next))
  })
  await settle()
}

async function enterSource(): Promise<void> {
  await act(async () => {
    ;(container.querySelector('[data-testid="toggle"]') as HTMLButtonElement).click()
  })
  await settle()
}

function textarea(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('[data-testid="source-textarea"]')
  if (!el) throw new Error('未进入源码模式')
  return el
}

async function typeInSource(next: string): Promise<void> {
  const el = textarea()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const PUTS = () => CS.requests.filter((r) => r.method === 'PUT')
const contents = () => PUTS().map((r) => String((r.body as { content?: string }).content ?? ''))

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  CS.requests = []
  CS.insertCalls = []
  CS.setKeContentCalls = []
  CS.confirmMessages = []
  CS.alerts = []
  CS.uploadStarted = 0
  CS.uploadRelease = null
  CS.hangUpload = false
  CS.md = ''
  installFetch()
  localStorage.clear()
  __clearActionHandlers()
  __resetViewModeForTest('wysiwyg')
  ;(window as unknown as { alert: (msg?: unknown) => void }).alert = (msg?: unknown) => {
    CS.alerts.push(String(msg ?? ''))
  }
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
  __clearActionHandlers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('task-64 A01：源码态下正文命令不得让隐藏 PM 覆盖源码编辑', () => {
  it('A01-① 源码保存后，隐藏 PM 的 update（工具栏程序命令等价物）不得再入队 PUT', async () => {
    await render(article('Articles/a.md', 'a', RAW))
    await enterSource()
    expect(getViewMode()).toBe('source')

    await typeInSource(`BASELINE_OLD\n\nSOURCE_NEW_MUST_SURVIVE\n\n$x+1$\n`)
    await settle(50)
    const afterSource = contents()
    expect(afterSource.length).toBeGreaterThan(0)
    expect(afterSource[afterSource.length - 1]).toContain('SOURCE_NEW_MUST_SURVIVE')

    const before = PUTS().length
    await act(async () => {
      CS.onUpdate?.()
    })
    await settle(50)

    expect(PUTS().length, '源码态下 PM update 不得产生任何新 PUT').toBe(before)
    expect(
      contents().some((c) => c.includes('BASELINE_OLD') && !c.includes('SOURCE_NEW_MUST_SURVIVE')),
      '任何 PUT 都不得用旧 PM 正文覆盖源码编辑',
    ).toBe(false)
  })

  it('A01-② 保存通道双重校验：切到源码前入队、切后才执行的 PM 保存同样作废', async () => {
    await render(article('Articles/a.md', 'a', RAW))
    await act(async () => {
      CS.onUpdate?.() // 正文态：入队一次未决 PM 保存
    })
    await enterSource() // 切换时 flush 落盘（合法），此后 PM 通道必须让位
    const baseline = PUTS().length
    await settle(100)
    expect(PUTS().length, '进入源码后不得再有 PM 通道写入').toBe(baseline)
  })

  it('A01-③ 命令入口守卫：源码态下 editor.* handler 不分派，应用级动作不受影响', async () => {
    const calls: string[] = []
    const guarded = guardBodyCommands({
      'editor.bold': () => calls.push('bold'),
      'doc.save': () => calls.push('save'),
    })
    registerActionHandler('editor.bold', guarded['editor.bold'])
    registerActionHandler('doc.save', guarded['doc.save'])

    __resetViewModeForTest('source')
    runAction('editor.bold')
    runAction('doc.save')
    expect(calls, '源码态：正文命令被拦，应用级动作照常').toEqual(['save'])

    __resetViewModeForTest('wysiwyg')
    runAction('editor.bold')
    expect(calls).toEqual(['save', 'bold'])
  })

  it('A01-④ 工具栏入口源码级守卫：正文命令组被 fieldset 整体禁用', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/editor/EditorToolbar.tsx'), 'utf8')
    expect(src, '正文命令组必须包在可整体禁用的容器里').toMatch(/data-testid="body-commands"/)
    expect(src, '源码态必须整体禁用正文命令').toMatch(/disabled=\{viewMode === 'source'\}/)
  })
})

describe('task-64 A12：异步上传期间切档，结果不得插入另一篇', () => {
  async function pickFile(name: string): Promise<void> {
    await act(async () => {
      runAction('editor.image.insert')
    })
    await settle()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('未找到上传用 file input')
    Object.defineProperty(input, 'files', { value: [new File(['x'], name, { type: 'text/plain' })], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
  }

  it('A12-① 上传挂起期间切到 B → 不插入、不落盘，并给出明确提示', async () => {
    await render(article('Articles/a.md', 'A 文档', RAW))
    CS.hangUpload = true
    await pickFile('from-A.txt')
    expect(CS.uploadStarted, '上传已发起（挂起中）').toBe(1)

    await rerender(article('Articles/b.md', 'B 文档', `---\nke_version: 1\ntitle: b\n---\n\nB 正文\n`))
    await act(async () => {
      CS.uploadRelease?.()
    })
    await settle(50)

    expect(CS.insertCalls, '上传结果绝不得插入当前（B）编辑器').toEqual([])
    expect(
      contents().filter((c) => c.includes('ke-attach')),
      '也不得把附件引用写进 B 的磁盘内容',
    ).toEqual([])
    expect(CS.alerts.join('\n'), '必须给出「回到发起文档处理」的明确提示').toContain('A 文档')
  })

  it('A12-② 同文档未切档：上传完成后正常插入（不误伤正常路径）', async () => {
    await render(article('Articles/a.md', 'A 文档', RAW))
    await pickFile('same-doc.txt')
    await settle(50)
    expect(CS.insertCalls.length, '同文档上传应正常插入').toBe(1)
    expect(CS.alerts).toEqual([])
  })
})

describe('task-68 U01：启动恢复的同档重载契约（App 先换 article、再推进 reloadToken）', () => {
  const BASELINE = `---\nke_version: 1\ntitle: a\n---\n\nRECOVERY_BASELINE\n`
  const RECOVERED = `---\nke_version: 1\ntitle: a\n---\n\nRECOVERY_NEW_normal\n`

  it('U01-① 正文通道：重载后编辑器内容 = 恢复正文；Ctrl+S 的 PUT 载荷也是恢复正文（不回退基线）', async () => {
    await render(article('Articles/a.md', 'a', BASELINE))
    expect(CS.setKeContentCalls.join('\n')).toContain('RECOVERY_BASELINE')
    CS.setKeContentCalls = []
    CS.requests = []

    // App 修复后的顺序：先把 article 换成恢复后内容（磁盘已恢复），再推进装载代次
    await act(async () => {
      root!.render(
        <EditorArea
          article={article('Articles/a.md', 'a', RECOVERED)}
          loading={false}
          onNewArticle={() => undefined}
          onSaved={() => undefined}
          reloadToken={1}
        />,
      )
    })
    await settle()
    expect(CS.setKeContentCalls.join('\n'), '编辑器必须重载为恢复正文').toContain('RECOVERY_NEW_normal')

    // 「恢复 → 不编辑 → 保存」：PUT 必须是恢复正文
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await settle(50)
    const last = contents().at(-1) ?? ''
    expect(last, '保存不得把恢复结果覆盖回基线').toContain('RECOVERY_NEW_normal')
    expect(last).not.toContain('RECOVERY_BASELINE')
  })

  it('U01-③ 反例（证明顺序判据非空）：先推进代次、后换 article → 编辑器停在基线（旧实现时序）', async () => {
    await render(article('Articles/a.md', 'a', BASELINE))
    CS.setKeContentCalls = []
    // 旧时序第一步：代次先推进，article 仍是基线
    await act(async () => {
      root!.render(
        <EditorArea
          article={article('Articles/a.md', 'a', BASELINE)}
          loading={false}
          onNewArticle={() => undefined}
          onSaved={() => undefined}
          reloadToken={1}
        />,
      )
    })
    await settle()
    // 旧时序第二步：article 换成恢复内容，但 id 未变、代次也未再变 → effect 不重跑
    await act(async () => {
      root!.render(
        <EditorArea
          article={article('Articles/a.md', 'a', RECOVERED)}
          loading={false}
          onNewArticle={() => undefined}
          onSaved={() => undefined}
          reloadToken={1}
        />,
      )
    })
    await settle()
    const reloaded = CS.setKeContentCalls.join('\n')
    expect(reloaded, '旧时序：重载用的是基线').toContain('RECOVERY_BASELINE')
    expect(reloaded, '旧时序：恢复正文永远不会载入编辑器（= 审计 restored UI retains old content）').not.toContain(
      'RECOVERY_NEW_normal',
    )
  })

  it('U01-② 源码通道：重载后 textarea = 恢复正文；源码保存的 PUT 也是恢复正文', async () => {
    __resetViewModeForTest('source')
    await render(article('Articles/a.md', 'a', BASELINE))
    expect(textarea().value).toContain('RECOVERY_BASELINE')
    CS.requests = []

    await act(async () => {
      root!.render(
        <EditorArea
          article={article('Articles/a.md', 'a', RECOVERED)}
          loading={false}
          onNewArticle={() => undefined}
          onSaved={() => undefined}
          reloadToken={1}
        />,
      )
    })
    await settle()
    expect(textarea().value, '源码 textarea 必须重载为恢复正文').toContain('RECOVERY_NEW_normal')

    await typeInSource(`${textarea().value}续写一行\n`)
    await settle(50)
    const last = contents().at(-1) ?? ''
    expect(last, '源码保存不得把恢复结果覆盖回基线').toContain('RECOVERY_NEW_normal')
    expect(last).not.toContain('RECOVERY_BASELINE')
  })
})
