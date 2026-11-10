/**
 * 2026-11-10 用户实测「重开页面后粗体变成字面 `**`」的根因修复。
 *
 * 场景：粗体文本以**标点结尾**、且紧邻一个字母/数字（无空格）时，序列化会产出
 * `**a.**b` 这类 CommonMark **非法强调**（闭合 `**` 前是标点、后是词字符 → 不满足
 * right-flanking）→ 下次解析回退成字面 `**a.**b` 文本；再保存时 `*` 被转义成 `\*\*`
 * → 永久稳定成本文字符。例：`**注意。**接下来……`。
 *
 * 修复：序列化前规范化 JSON —— 把「会导致非法强调边界」的首/尾标点移出标记范围
 * （标点保留为普通文本，文字一个不少；只是标点不再加粗/斜体）。因此：
 *  - 输出始终是合法 Markdown（下次打开仍是粗体）；
 *  - 幂等：再次序列化时边界已合法，不再改动；
 *  - 对合法 Markdown 零行为变化（全部既有严格往返测试不受影响）。
 *
 * 适用标记：bold / italic / strike（`**`、`*`、`~~` 都有同类 flanking 规则）。
 */
import type { JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'

/** CommonMark 标点：ASCII 标点 + Unicode P 类 */
const PUNCT_CHAR = /[\p{P}\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/u
/** 「词字符」：字母/数字（含 CJK），用于判断强调边界是否紧邻词 */
const WORD_CHAR = /[\p{L}\p{N}]/u

const FLANKING_MARKS = new Set(['bold', 'italic', 'strike'])

type Mark = { type: string; attrs?: Record<string, unknown> }
type TextJson = JSONContent & { type: 'text'; text: string; marks?: Mark[] }

function isText(node: JSONContent): node is TextJson {
  return node?.type === 'text' && typeof (node as TextJson).text === 'string'
}

function hasMark(node: JSONContent, markType: string): boolean {
  const marks = (node as TextJson).marks
  return Array.isArray(marks) && marks.some((m) => m.type === markType)
}

function marksWithout(node: JSONContent, markType: string): Mark[] {
  const marks = (node as TextJson).marks
  return (marks ?? []).filter((m) => m.type !== markType)
}

function leadingPunctRun(text: string): string {
  let i = 0
  while (i < text.length && PUNCT_CHAR.test(text[i])) i++
  return text.slice(0, i)
}

function trailingPunctRun(text: string): string {
  let i = text.length
  while (i > 0 && PUNCT_CHAR.test(text[i - 1])) i--
  return text.slice(i)
}

function cloneNode(node: JSONContent): JSONContent {
  return node && typeof node === 'object' ? JSON.parse(JSON.stringify(node)) : node
}

/** 规范化一个「含行内节点」的 content 数组里的强调边界。 */
function normalizeInlineArray(nodes: JSONContent[], markType: string): JSONContent[] {
  const out: JSONContent[] = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    if (!isText(node) || !hasMark(node, markType)) {
      out.push(node)
      i++
      continue
    }
    // 找到同一标记的连续文本 run [i, end)
    let end = i
    while (end + 1 < nodes.length && isText(nodes[end + 1]) && hasMark(nodes[end + 1], markType)) end++
    const run = nodes.slice(i, end + 1).map(cloneNode) as TextJson[]

    // —— 开边界：run 首字符是标点，且前一个兄弟以词字符结尾 → 标点移出标记 ——
    const prev = i > 0 ? nodes[i - 1] : null
    if (prev && isText(prev) && run.length > 0) {
      const first = run[0]
      const leading = leadingPunctRun(first.text)
      const prevTail = prev.text.slice(-1)
      if (leading && WORD_CHAR.test(prevTail)) {
        first.text = first.text.slice(leading.length)
        out.push({ type: 'text', text: leading, ...(marksWithout(first, markType).length ? { marks: marksWithout(first, markType) } : {}) })
      }
    }

    // —— 闭边界：run 末字符是标点，且后一个兄弟以词字符开头 → 标点移出标记 ——
    const next = end + 1 < nodes.length ? nodes[end + 1] : null
    let trailing = ''
    if (next && isText(next) && WORD_CHAR.test(next.text[0] ?? '')) {
      const last = run[run.length - 1]
      trailing = trailingPunctRun(last.text)
      if (trailing) last.text = last.text.slice(0, last.text.length - trailing.length)
    }

    for (const textNode of run) {
      if (textNode.text.length > 0) out.push(textNode)
    }
    if (trailing) {
      const lastMarks = marksWithout(run[run.length - 1], markType)
      out.push({ type: 'text', text: trailing, ...(lastMarks.length ? { marks: lastMarks } : {}) })
    }
    i = end + 1
  }
  return out
}

function normalizeContent(content: JSONContent[], parentType?: string): JSONContent[] {
  let nodes = content.map(cloneNode)
  if (parentType && parentType !== 'codeBlock') {
    for (const markType of FLANKING_MARKS) nodes = normalizeInlineArray(nodes, markType)
  }
  return nodes.map((node) => normalizeNode(node))
}

function normalizeNode(node: JSONContent): JSONContent {
  if (!node || typeof node !== 'object') return node
  const copy = cloneNode(node)
  if (Array.isArray(copy.content)) {
    copy.content = normalizeContent(copy.content, typeof node.type === 'string' ? node.type : undefined)
  }
  return copy
}

/**
 * 序列化前的强调边界规范化（纯函数，便于单测）。
 * 输入 doc JSON（或任意节点），返回深拷贝后的规范化 JSON。
 */
export function normalizeEmphasisBoundaries<T extends JSONContent | JSONContent[]>(doc: T): T {
  if (Array.isArray(doc)) return doc.map(normalizeNode) as T
  return normalizeNode(doc as JSONContent) as T
}

interface SerializeTarget {
  serialize?: (doc: JSONContent | JSONContent[]) => string
}

const proto = MarkdownManager.prototype as unknown as SerializeTarget
const originalSerialize = proto.serialize
if (typeof originalSerialize === 'function') {
  proto.serialize = function patchedSerialize(doc) {
    return originalSerialize.call(this, normalizeEmphasisBoundaries(doc))
  }
}
