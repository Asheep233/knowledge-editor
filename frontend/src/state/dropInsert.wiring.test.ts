/**
 * F2 生产接线回归：drop 流程真的接上了 `shouldInsertDroppedFiles` / `runDropInsert`。
 *
 * 为什么需要（P3-20 未接线的实证）：`src/editor/index.ts` 的 `handleDrop` 旧实现把
 * `posAtCoords` 的取值放在上传循环**之外**：
 *   - 多文件拖拽 → 全部插到同一个 pos（后插的还插在先前插入的节点之前，顺序被反转）；
 *   - 上传期间切档 → 结果仍写进编辑器（此时编辑器已是另一篇文档）。
 * 纯函数（dropInsert.run.test.ts）与源码接线（本文件 S 组）两层都要钉住，
 * 否则「只改测试不改接线」。
 *
 * 本文件用**真实编辑器管线**（useKeEditor = 应用同一套扩展）触发 handleDrop，
 * 断言「文档里的节点顺序」这一返回值级事实（无需人工点鼠标）。
 */
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { setKeContent, useKeEditor } from '../editor'
import * as api from '../api/client'

// 只替换上传实现：其余 api/client 导出保持真实（nodeview 等在导入期会引用它们）
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, uploadAttachment: vi.fn() }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const readSrc = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const uploadResult = (name: string) => ({
  path: `attachments/files/${name}`,
  url: `/api/attachments/${name}`,
  category: 'files' as const,
  size: 4,
  name,
})

let root: Root | null = null
let container: HTMLDivElement | null = null
let editor: Editor | null = null

const Probe = () => {
  const ed = useKeEditor({ content: '', onUpdate: () => undefined })
  useEffect(() => {
    editor = ed
  }, [ed])
  return null
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function mountEditor(): Promise<Editor> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(Probe))
  })
  await flush()
  expect(editor, '未取得真实编辑器实例').toBeTruthy()
  return editor!
}

type DropHandler = (view: Editor['view'], event: DragEvent) => boolean | void

function handler(): DropHandler {
  const fn = editor!.view.someProp('handleDrop') as DropHandler | undefined
  expect(fn, 'editor/index.ts 未注册 handleDrop').toBeTruthy()
  return fn!
}

/** 构造最小 DragEvent 替身（handleDrop 只读 dataTransfer.files / clientX / clientY） */
function dropEvent(names: string[]): DragEvent {
  const files = names.map((n) => new File(['abcd'], n, { type: 'text/plain' }))
  return {
    dataTransfer: { files },
    clientX: 10,
    clientY: 20,
    preventDefault: () => undefined,
  } as unknown as DragEvent
}

/** 文档中 attach 节点的标题顺序（插入点是否逐个重取的返回值级证据） */
function attachTitles(ed: Editor): string[] {
  const out: string[] = []
  ed.state.doc.descendants((node) => {
    if (node.type.name === 'attach') out.push(String(node.attrs.title ?? ''))
    return true
  })
  return out
}

/** 文档顶层节点间隙（块级 attach 只能插在间隙里）——避免硬编码偏移被 markdown 解析细节影响 */
function gapPositions(ed: Editor): number[] {
  const out: number[] = []
  let pos = 0
  ed.state.doc.forEach((node) => {
    out.push(pos)
    pos += node.nodeSize
  })
  out.push(pos)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  editor = null
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  editor = null
  container?.remove()
  container = null
})

describe('F2 真实编辑器：多文件 drop 逐个重取插入点', () => {
  it('两个文件：每个文件插入前重新取 posAtCoords，节点按 a→b 顺序落位（旧实现同点插入 → b 反插到 a 前面）', async () => {
    const ed = await mountEditor()
    await act(async () => {
      setKeContent(ed, 'A\n\nB\n\nC\n')
    })
    vi.mocked(api.uploadAttachment).mockImplementation(async (f) => uploadResult(f.name))

    // posAtCoords 每次调用返回一个位置：第一个间隙 →（插入一个块节点后）下一个间隙
    const first = gapPositions(ed)[1]
    const positions = [first, first + 1]
    const posAtCoords = vi
      .spyOn(ed.view, 'posAtCoords')
      .mockImplementation(() => ({ pos: positions.shift() ?? first + 1, inside: -1 }))

    const handled = handler()(ed.view, dropEvent(['a.txt', 'b.txt']))
    expect(handled).toBe(true)
    await flush()

    expect(vi.mocked(api.uploadAttachment)).toHaveBeenCalledTimes(2)
    expect(posAtCoords, '每个文件插入前都必须重新取 view.posAtCoords（旧实现只在循环外取一次）').toHaveBeenCalledTimes(2)
    expect(attachTitles(ed), '两个文件落在同一位置 → 后插入的 b 反插到 a 之前').toEqual(['a.txt', 'b.txt'])
  })

  it('上传期间切档（setKeContent 载入另一篇）：在途结果丢弃，不写进新文档', async () => {
    const ed = await mountEditor()
    await act(async () => {
      setKeContent(ed, 'A\n\nB\n')
    })

    let release!: () => void
    vi.mocked(api.uploadAttachment).mockImplementation(
      (f) =>
        new Promise((resolve) => {
          release = () => resolve(uploadResult(f.name))
        }),
    )

    const handled = handler()(ed.view, dropEvent(['a.txt']))
    expect(handled).toBe(true)

    // 上传尚未返回时切档（生产里 = EditorArea 的 setKeContent）
    await act(async () => {
      setKeContent(ed, 'D\n\nE\n')
    })
    release()
    await flush()

    expect(attachTitles(ed), '过期的上传结果被插进了切档后的文档').toEqual([])
  })

  it('同一文档内上传完成后正常插入（对照：不切档不得被误丢弃）', async () => {
    const ed = await mountEditor()
    await act(async () => {
      setKeContent(ed, 'A\n\nB\n')
    })
    vi.mocked(api.uploadAttachment).mockImplementation(async (f) => uploadResult(f.name))
    vi.spyOn(ed.view, 'posAtCoords').mockReturnValue({ pos: gapPositions(ed)[1], inside: -1 })

    handler()(ed.view, dropEvent(['only.txt']))
    await flush()

    expect(attachTitles(ed)).toEqual(['only.txt'])
  })
})

describe('F2 源码接线（防「只改测试不改接线」）', () => {
  const src = readSrc('../editor/index.ts')

  it('handleDrop 调用 runDropInsert，并把「当前文档令牌」与「逐文件重新取位」传进去', () => {
    const region = src.slice(src.indexOf('handleDrop'))
    expect(region, 'handleDrop 未接线 runDropInsert').toMatch(/runDropInsert\(/)
    expect(region, '未取 drop 时的文档令牌').toMatch(/docIdAtDrop:\s*currentDropDocToken\(\)/)
    expect(region, '未在每个文件前重读当前文档令牌').toMatch(/readCurrentDocId:\s*\(\)\s*=>\s*currentDropDocToken\(\)/)
    expect(region, '未在每个文件前重新取 posAtCoords').toMatch(/readCurrentPos:[\s\S]{0,200}view\.posAtCoords\(/)
    // 旧实现：循环外固定一个 pos，循环里复用 → 该常量取值必须已消失
    expect(region, '仍存在「循环外固定 pos」的旧实现').not.toMatch(/const pos\s*=\s*\n?\s*view\.posAtCoords/)
  })

  it('setKeContent（唯一生产载入入口）换发文档令牌：切档/重载使在途 drop 过期', () => {
    const region = src.slice(src.indexOf('export function setKeContent'), src.indexOf('export function clearMdDocCache'))
    expect(region, 'setKeContent 未换发令牌 → 上传期间切档无法识别').toMatch(/rotateDropDocToken\(\)/)
  })
})
