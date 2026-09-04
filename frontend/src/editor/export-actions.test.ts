/**
 * 导出动作回归测试（v1.0.2 导出菜单"点击无反应"修复）。
 *
 * 背景：Tauri WebView2 下 a[download]+blob 为静默下载，且同一会话第 2 次起的
 * 程序化下载被多下载策略静默丢弃。修复 = 共享路径 saveOrDownload（原生另存为优先）。
 * 本测试锁死：
 *   1) 三种导出模式各自调用正确的保存路径与参数（mock saveOrDownload）；
 *   2) saveOrDownload 在支持 File System Access 的环境走 showSaveFilePicker；
 *   3) 不支持/异常时回退 downloadBlob（mock 验证 blob 与文件名透传）。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { ModuleExtension } from './extensions/ModuleExtension'
import { AttachmentExtension } from './extensions/AttachmentExtension'
import { VideoExtension } from './extensions/VideoExtension'
import { FootnoteExtension } from './extensions/FootnoteExtension'
import { FootnotesExtension } from './extensions/FootnotesExtension'
import type { ArticleMeta } from '../types'

// ---- 环境准备 ----
const saved: Array<{ blob: Blob; filename: string }> = []
const exportPackageMock = vi.hoisted(() => vi.fn())

vi.mock('../api/client', () => ({
  exportPackage: (...args: unknown[]) => exportPackageMock(...(args as [never])),
}))
vi.mock('./import-export', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./import-export')>()
  return {
    ...orig,
    saveOrDownload: vi.fn(async (blob: Blob, filename: string) => {
      saved.push({ blob, filename })
    }),
  }
})
import { keExportPayload, packageExportAndSave, plainExportPayload, runExport } from './export-actions'
import { saveOrDownload } from './import-export'

const EXT = [
  StarterKit,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  ImageMarkdownExtension,
  MathExtension,
  MathBlockExtension,
  NoteExtension,
  ModuleExtension,
  AttachmentExtension,
  VideoExtension,
  FootnoteExtension,
  FootnotesExtension,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
]

function makeEditor(md: string): Editor {
  return new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
}

const ARTICLE = {
  id: 'Articles/导出示例.md',
  path: 'Articles/导出示例.md',
  title: '导出示例',
  content: '',
  tags: ['示例', '验证'],
  meta: {},
} as ArticleMeta

const MD = [
  '# 导出示例',
  '',
  '<!-- ke-note: {"id":"n1","label":"提示"} -->',
  '信息内容',
  '<!-- /ke-note -->',
  '',
  '<!-- ke-attach: {"kind":"attach","id":"a1","type":"image","src":"Attachments/images/f.png","title":"图"} -->',
  '',
  '正文脚注[^1]。',
  '',
  '<!-- ke-footnote: {"id":"f1","n":1} -->',
  '',
  '<!-- ke-footnotes:start -->',
  '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"脚注定义"} -->',
  '<!-- ke-footnotes:end -->',
].join('\n')

beforeEach(() => {
  saved.length = 0
  exportPackageMock.mockReset()
})

describe('导出动作：三种模式各走正确保存路径与参数', () => {
  it('KE 格式：withFrontmatter 载荷 + 文件名 slug.md，经 runExport 保存', async () => {
    const ed = makeEditor(MD)
    const target = keExportPayload(ed, '导出示例')
    ed.destroy()
    expect(target.filename).toBe('导出示例.md')
    const text = await target.blob.text()
    expect(text).toContain('ke_version: 1')
    expect(text).toContain('<!-- ke-note:')
    await runExport(target)
    expect(saved).toHaveLength(1)
    expect(saved[0].filename).toBe('导出示例.md')
    expect(await saved[0].blob.text()).toBe(text)
  })

  it('普通 Markdown：无 ke_version/已知 ke-* 标记 + 标准 frontmatter，经 runExport 保存', async () => {
    const ed = makeEditor(MD)
    const target = plainExportPayload(ed, ARTICLE)
    ed.destroy()
    expect(target.filename).toBe('导出示例.md')
    const text = await target.blob.text()
    expect(text).not.toContain('ke_version')
    expect(text).not.toContain('<!-- ke-note:')
    expect(text).not.toContain('ke-footnotes:start')
    expect(text).toContain('title: 导出示例')
    expect(text).toContain('tags:')
    expect(text).toContain('> **提示**')
    expect(text).toContain('[^1]: 脚注定义')
    await runExport(target)
    expect(saved).toHaveLength(1)
    expect(saved[0].filename).toBe('导出示例.md')
  })

  it('文档包：调 exportPackage（标题/正文/引用提取）并把返回的 blob+文件名交给保存', async () => {
    exportPackageMock.mockResolvedValue({
      blob: new Blob(['ZIPDATA'], { type: 'application/zip' }),
      filename: '导出示例_export.zip',
    })
    const ed = makeEditor(MD)
    const md = ed.getMarkdown()
    ed.destroy()
    await packageExportAndSave('导出示例', md)
    expect(exportPackageMock).toHaveBeenCalledTimes(1)
    const arg = exportPackageMock.mock.calls[0][0]
    expect(arg.title).toBe('导出示例')
    expect(arg.md).toBe(md)
    // 引用了 Attachments/images/f.png → refs 应包含（含图片引用提取）
    expect(arg.refs).toContain('Attachments/images/f.png')
    expect(saved).toHaveLength(1)
    expect(saved[0].filename).toBe('导出示例_export.zip')
    expect(await saved[0].blob.text()).toBe('ZIPDATA')
  })
})

describe('saveOrDownload：原生另存为优先 + 回退（共享路径修复点）', () => {
  // 这三个用例针对「真实实现」（vi.mock 工厂只替换了命名空间导出，这里取原模块）
  let realIE: typeof import('./import-export')
  let realDownload: typeof saveOrDownload
  beforeAll(async () => {
    realIE = await vi.importActual<typeof import('./import-export')>('./import-export')
    realDownload = realIE.saveOrDownload
  })
  it('支持 showSaveFilePicker 时：以 suggestedName 打开原生另存为并写入内容', async () => {
    const writes: Blob[] = []
    const picker = vi.fn(async () => ({
      createWritable: async () => ({
        write: async (d: Blob) => {
          writes.push(d)
        },
        close: async () => undefined,
      }),
    }))
    const orig = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker
    try {
      await realDownload(new Blob(['HELLO'], { type: 'text/markdown' }), 'a.md')
      expect(picker).toHaveBeenCalledWith({ suggestedName: 'a.md' })
      expect(writes).toHaveLength(1)
      expect(await writes[0].text()).toBe('HELLO')
    } finally {
      ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = orig
    }
  })

  it('用户取消（AbortError）时静默返回且不触发回退下载', async () => {
    const picker = vi.fn(async () => {
      throw new DOMException('cancel', 'AbortError')
    })
    const urlSpy = vi.spyOn(URL, 'createObjectURL')
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker
    try {
      await realDownload(new Blob(['X']), 'b.md')
      expect(urlSpy).not.toHaveBeenCalled() // 未走静默下载回退
    } finally {
      ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = undefined
      urlSpy.mockRestore()
    }
  })

  it('不支持 API 或无 API 时回退 downloadBlob，blob 与文件名透传', async () => {
    const urlSpy = vi.spyOn(URL, 'createObjectURL')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = undefined
    try {
      const blob = new Blob(['FALLBACK'], { type: 'text/markdown' })
      await realDownload(blob, 'c.md')
      expect(urlSpy).toHaveBeenCalledTimes(1)
      expect(urlSpy.mock.calls[0][0]).toBe(blob)
      expect(revokeSpy).toHaveBeenCalledTimes(1) // 下载完成后释放
    } finally {
      urlSpy.mockRestore()
      revokeSpy.mockRestore()
    }
  })
})
