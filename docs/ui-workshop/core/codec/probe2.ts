/**
 * T08 第二阶段探针：product 扩展的 DOM 依赖分层（纯 Node，无 happy-dom/window）。
 *
 * 对每个 candidate 扩展做三件事并记录结果：
 *  1) 动态 import 该模块（是否在模块初始化就需要 window/document/React/MathLive）
 *  2) 加入 headless Editor 的 extensions，parse 该结构的目标 Markdown（是否抛错）
 *  3) 取回 getMarkdown()，检查关键 token 是否保留（frontmatter/未知 ke 标记/HTML/公式等）
 * 结果用于 T08 的扩展分层表：可直接无 DOM / 需要 shim / 必须 UI。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'

const moduleLoaders: Record<string, () => Promise<Record<string, unknown>>> = {
  'extensions/KeBlockJoin': () => import('../../../../frontend/src/editor/extensions/KeBlockJoin'),
  'extensions/ListExtension': () => import('../../../../frontend/src/editor/extensions/ListExtension'),
  'extensions/MathExtension': () => import('../../../../frontend/src/editor/extensions/MathExtension'),
  'extensions/MathBlockExtension': () => import('../../../../frontend/src/editor/extensions/MathBlockExtension'),
  'extensions/MathIdUniqueness': () => import('../../../../frontend/src/editor/extensions/MathIdUniqueness'),
  'extensions/NoteExtension': () => import('../../../../frontend/src/editor/extensions/NoteExtension'),
  'extensions/FootnoteExtension': () => import('../../../../frontend/src/editor/extensions/FootnoteExtension'),
  'extensions/FootnotesExtension': () => import('../../../../frontend/src/editor/extensions/FootnotesExtension'),
  'extensions/TableMarkdownExtension': () => import('../../../../frontend/src/editor/extensions/TableMarkdownExtension'),
  'extensions/GfmTableFallbackExtension': () => import('../../../../frontend/src/editor/extensions/GfmTableFallbackExtension'),
  'extensions/GenericFallbackExtension': () => import('../../../../frontend/src/editor/extensions/GenericFallbackExtension'),
  'extensions/HtmlPassthroughExtension': () => import('../../../../frontend/src/editor/extensions/HtmlPassthroughExtension'),
  'extensions/AttachmentExtension': () => import('../../../../frontend/src/editor/extensions/AttachmentExtension'),
  'extensions/VideoExtension': () => import('../../../../frontend/src/editor/extensions/VideoExtension'),
  'extensions/ModuleExtension': () => import('../../../../frontend/src/editor/extensions/ModuleExtension'),
  'extensions/ImageMarkdownExtension': () => import('../../../../frontend/src/editor/extensions/ImageMarkdownExtension'),
}

type Candidate = {
  name: string
  modules: string[]
  targetMd: string
  tokenChecks: string[]
}

const candidates: Candidate[] = [
  {
    name: 'KeDocument/KeBlockquote',
    modules: ['extensions/KeBlockJoin'],
    targetMd: '> 引用\n\n正文\n',
    tokenChecks: ['> 引用', '正文'],
  },
  {
    name: 'ListExtension(OrderedListParen/KeListItem)',
    modules: ['extensions/ListExtension'],
    targetMd: '1) 甲\n2) 乙\n',
    tokenChecks: ['1)', '甲'],
  },
  {
    name: 'MathExtension/MathBlockExtension',
    modules: ['extensions/MathExtension', 'extensions/MathBlockExtension', 'extensions/MathIdUniqueness'],
    targetMd: '行内 $E=mc^2$\n\n$$\n\\int_0^1 x^2\n$$\n',
    tokenChecks: ['$E=mc^2$', '$$'],
  },
  {
    name: 'NoteExtension',
    modules: ['extensions/NoteExtension'],
    targetMd: '<!-- ke-note: {"kind":"note","id":"n1","title":"T","tone":"blue"} -->\n内容\n<!-- /ke-note -->\n',
    tokenChecks: ['ke-note', '内容'],
  },
  {
    name: 'Footnote/Footnotes',
    modules: ['extensions/FootnoteExtension', 'extensions/FootnotesExtension'],
    targetMd: '正文[^1]\n\n[^1]: 注释内容\n',
    tokenChecks: ['[^1]', '注释内容'],
  },
  {
    name: 'TableMarkdown/GfmTableFallback',
    modules: ['extensions/TableMarkdownExtension', 'extensions/GfmTableFallbackExtension'],
    targetMd: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    tokenChecks: ['| a | b |', '| 1 | 2 |'],
  },
  {
    name: 'GenericFallback(unknown ke-*)',
    modules: ['extensions/GenericFallbackExtension'],
    targetMd: '<!-- ke-unknown: {"a":1} -->\n\n正文\n',
    tokenChecks: ['ke-unknown'],
  },
  {
    name: 'HtmlPassthrough',
    modules: ['extensions/HtmlPassthroughExtension'],
    targetMd: '<div data-x="1">raw</div>\n',
    tokenChecks: ['<div', 'raw'],
  },
  {
    name: 'Attachment/Video/Module',
    modules: ['extensions/AttachmentExtension', 'extensions/VideoExtension', 'extensions/ModuleExtension'],
    targetMd:
      '<!-- ke-attach: {"kind":"attach","id":"a1","src":"Attachments/files/sample.pdf"} -->\n\n' +
      '<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/demo.mp4"} -->\n',
    tokenChecks: ['ke-attach', 'Attachments/files/sample.pdf'],
  },
  {
    name: 'ImageMarkdown',
    modules: ['extensions/ImageMarkdownExtension'],
    targetMd: '![示例](Attachments/images/sample.png)\n',
    tokenChecks: ['![示例]', 'Attachments/images/sample.png'],
  },
]

async function loadModules(relPaths: string[]): Promise<{ mods: Record<string, unknown>[]; error?: string }> {
  const mods: Record<string, unknown>[] = []
  for (const rel of relPaths) {
    try {
      const loader = moduleLoaders[rel]
      if (!loader) throw new Error(`no loader for ${rel}`)
      mods.push(await loader())
    } catch (e) {
      return { mods, error: `import ${rel}: ${String((e as Error)?.message ?? e)}` }
    }
  }
  return { mods }
}

function collectExtensions(mods: Record<string, unknown>[]): unknown[] {
  const out: unknown[] = []
  for (const m of mods) {
    for (const [k, v] of Object.entries(m)) {
      if (/Extension$|^KeDocument$|^KeBlockquote$|^TaskList$|^TaskItem$/.test(k)) out.push(v)
      if (k === 'OrderedListParenExtension' || k === 'KeListItem') out.push(v)
    }
  }
  return out
}

async function main(): Promise<void> {
  const results: Array<Record<string, unknown>> = []
  for (const c of candidates) {
    const rec: Record<string, unknown> = { name: c.name, targetMd: c.targetMd.slice(0, 60) }
    try {
      const { mods, error } = await loadModules(c.modules)
      if (error) {
        rec.importError = error
        results.push(rec)
        continue
      }
      rec.importOk = true
      try {
        const editor = new Editor({
          extensions: [
            StarterKit,
            Markdown.configure({ indentation: { style: 'space', size: 2 } }),
            Table,
            TableRow,
            TableCell,
            TableHeader,
            ...(collectExtensions(mods) as never[]),
          ],
          content: c.targetMd,
          contentType: 'markdown',
        })
        const back = (editor as unknown as { getMarkdown: () => string }).getMarkdown()
        rec.parseOk = true
        rec.output = back
        rec.tokensKept = c.tokenChecks.map((t) => ({ token: t, kept: back.includes(t) }))
        rec.bytesEqual = back === c.targetMd
      } catch (e) {
        rec.parseError = String((e as Error)?.message ?? e)
      }
    } catch (e) {
      rec.unexpected = String((e as Error)?.message ?? e)
    }
    results.push(rec)
  }
  console.log(JSON.stringify(results, null, 2))
}

void main()
