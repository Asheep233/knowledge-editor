/**
 * T08 第三阶段：product 保存管线 roundtrip 字节台账（纯 Node / headless，无 DOM）。
 *
 * 镜像产品 WYSIWYG 保存链（EditorArea.tsx 约 1072–1078 行）：
 *   原始 frontmatter 区块 + headless editor 序列化正文
 *   → withFrontmatter(…, KE_VERSION)（保留字段/换行风格，仅更新 ke_version）
 *   → applyDocTraits(captureDocTraits(raw))（还原 BOM/CRLF）
 * 对 fixtures 与合成样本逐字节比较，输出 diff 台账（哪些字节稳定、哪些属于 canonical 化）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'

const SRC = '../../../../frontend/src/editor'

import { KeBlockquote, KeDocument } from '../../../../frontend/src/editor/extensions/KeBlockJoin'
import { OrderedListParenExtension, KeListItem } from '../../../../frontend/src/editor/extensions/ListExtension'
import { MathExtension } from '../../../../frontend/src/editor/extensions/MathExtension'
import { MathBlockExtension } from '../../../../frontend/src/editor/extensions/MathBlockExtension'
import { MathIdUniqueness } from '../../../../frontend/src/editor/extensions/MathIdUniqueness'
import { NoteExtension } from '../../../../frontend/src/editor/extensions/NoteExtension'
import { ModuleExtension } from '../../../../frontend/src/editor/extensions/ModuleExtension'
import { AttachmentExtension } from '../../../../frontend/src/editor/extensions/AttachmentExtension'
import { VideoExtension } from '../../../../frontend/src/editor/extensions/VideoExtension'
import { FootnoteExtension } from '../../../../frontend/src/editor/extensions/FootnoteExtension'
import { FootnotesExtension } from '../../../../frontend/src/editor/extensions/FootnotesExtension'
import { TableMarkdownExtension } from '../../../../frontend/src/editor/extensions/TableMarkdownExtension'
import { GfmTableFallbackExtension } from '../../../../frontend/src/editor/extensions/GfmTableFallbackExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from '../../../../frontend/src/editor/extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from '../../../../frontend/src/editor/extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from '../../../../frontend/src/editor/extensions/ImageMarkdownExtension'
import { normalizeGfmFootnotes } from '../../../../frontend/src/editor/gfm-footnote'
import { applyDocTraits, captureDocTraits, frontmatterBlockOf, KE_VERSION, stripFrontmatter, withFrontmatter } from '../../../../frontend/src/editor/ke'

function makeEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ document: false, blockquote: false, orderedList: false, listItem: false }),
      KeDocument,
      KeBlockquote,
      HtmlPassthroughExtension,
      HtmlPassthroughInlineExtension,
      GenericFallbackExtension,
      GenericFallbackInlineExtension,
      OrderedListParenExtension,
      KeListItem,
      TaskList,
      TaskItem,
      ImageMarkdownExtension,
      MathExtension,
      MathBlockExtension,
      MathIdUniqueness,
      NoteExtension,
      ModuleExtension,
      AttachmentExtension,
      VideoExtension,
      FootnoteExtension,
      FootnotesExtension,
      TableMarkdownExtension,
      GfmTableFallbackExtension,
      TableRow,
      TableCell,
      TableHeader,
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
    content,
    contentType: 'markdown',
  })
}

function saveRoundtrip(raw: string): string {
  const traits = captureDocTraits(raw)
  // BOM 在 stripFrontmatter 之前剥离（与产品 withFrontmatter 的 BOM 容忍一致；BOM 由 traits 还原）
  const text = raw.startsWith('\ufeff') ? raw.slice(1) : raw
  const fmBlock = frontmatterBlockOf(text)
  const body = stripFrontmatter(text).content
  // 注意：headless 下 `commands.setContent(md,{contentType:'markdown'})` 会走 elementFromString
  // （需要 DOM）；纯 Node codec 应使用构造函数 content 或 MarkdownManager.parse 直接解析。
  const editor = makeEditor(normalizeGfmFootnotes(body))
  const serialized = (editor as unknown as { getMarkdown: () => string }).getMarkdown()
  const merged = withFrontmatter(fmBlock ? fmBlock + serialized : serialized, KE_VERSION)
  return applyDocTraits(merged, traits)
}

function firstDiff(a: string, b: string): { offset: number; line: number; a: string; b: string } | null {
  if (a === b) return null
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const line = a.slice(0, i).split('\n').length
  const lineStart = a.lastIndexOf('\n', i - 1) + 1
  const lineEnd = a.indexOf('\n', i)
  const aLine = a.slice(lineStart, lineEnd === -1 ? a.length : lineEnd)
  const bStart = Math.max(0, i - 80)
  return { offset: i, line, a: aLine.slice(0, 120), b: b.slice(bStart, bStart + 160) }
}

const SYNTHETIC: Array<{ name: string; raw: string }> = [
  {
    name: 'frontmatter-custom',
    raw: '---\ntitle: 自定义\ntags:\n  - a\n  - b\nke_version: 1\n---\n\n# 标题\n\n正文\n',
  },
  { name: 'crlf', raw: '---\r\ntitle: CRLF\r\n---\r\n\r\n# 标题\r\n\r\n正文\r\n' },
  { name: 'bom', raw: '\ufeff---\ntitle: BOM\n---\n\n# 标题\n\n正文\n' },
  { name: 'unknown-ke', raw: '---\ntitle: U\n---\n\n<!-- ke-unknown: {"a":1} -->\n\n正文\n' },
  { name: 'math-sqrt', raw: '---\ntitle: M\n---\n\n公式 $\\sqrt{\\frac{a^2+b^2}{2}}$ 与\n\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n' },
]

function main(): void {
  const fixturesDir = join(process.cwd(), 'docs/ui-workshop/fixtures')
  const fixtures = readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ name: f, raw: readFileSync(join(fixturesDir, f), 'utf8') }))
  const out: Array<Record<string, unknown>> = []
  for (const item of [...fixtures, ...SYNTHETIC]) {
    try {
      const saved = saveRoundtrip(item.raw)
      const saved2 = saveRoundtrip(saved)
      const saved3 = saveRoundtrip(saved2)
      const unknownKe = ['ke-note', 'ke-attach', 'ke-video', 'ke-module', 'ke-unknown'].filter((k) => item.raw.includes(k))
      out.push({
        name: item.name,
        bytesEqual: saved === item.raw,
        fixedPoint: saved === saved2,
        fixedPoint2: saved2 === saved3,
        fixedPointDiff: saved === saved2 ? null : firstDiff(saved, saved2),
        canonicalDelta: saved === item.raw ? 0 : saved.length - item.raw.length,
        inputBytes: Buffer.byteLength(item.raw),
        outputBytes: Buffer.byteLength(saved),
        firstDiff: firstDiff(item.raw, saved),
        keTokens: unknownKe.map((k) => ({ token: k, kept: saved.includes(k) })),
        bom: captureDocTraits(item.raw).bom,
        eol: captureDocTraits(item.raw).eol,
        outputHead: saved.slice(0, 120).replace(/\r/g, '\\r'),
      })
    } catch (e) {
      out.push({ name: item.name, error: String((e as Error)?.stack ?? e) })
    }
  }
  console.log(JSON.stringify(out, null, 2))
}

main()
