/**
 * 自定义 marked tokenizers（KE 扩展语法 + 数学公式）。
 * 通过扩展字段 markdownTokenizer 注入：@tiptap/markdown 的 registerExtension
 * 会自动调用 registerTokenizer，将下列 tokenizer 注册进 marked 实例。
 *
 * 契约（参考 marked 官方扩展）：
 * - start(src): 返回第一个可能匹配位置，无匹配返回 -1
 * - tokenize(src, tokens, helpers): 从 start 位置起的子串上尝试匹配，
 *   返回 { type, raw, ... } 或 undefined（undefined 时 marked 回退默认规则）
 */

export interface MarkdownToken {
  type: string
  raw: string
  [key: string]: unknown
}

/** 行内公式 $...$（排除 $$ 与转义 \$；要求 LaTeX 非空） */
export const mathInlineTokenizer = {
  name: 'math_inline',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('$'),
  tokenize(src: string): MarkdownToken | undefined {
    if (!src.startsWith('$') || src.startsWith('$$')) return undefined
    const m = /^\$(?!\$)([\s\S]*?[^\\\s$])\$(?!\$)/.exec(src)
    if (!m || !m[1].trim()) return undefined
    return { type: 'math_inline', raw: m[0], latex: m[1].trim(), id: '' }
  },
}

/** 块级公式 $$...$$（独占行或单行，块级 token） */
export const mathBlockTokenizer = {
  name: 'math_block',
  level: 'block' as const,
  // 仅当 src 以 $$ 开头（独占行）时返回 0，否则 -1。
  // 关键：若返回非 0 位置，marked 会把行切开并把剩余部分交给默认 html 规则，
  // 导致行内 $ 符号等被错误消费。block 级 start 必须只在行首命中时返回 0。
  start: (src: string) => (src.startsWith('$$') ? 0 : -1),
  tokenize(src: string): MarkdownToken | undefined {
    const m = /^\$\$\n?([\s\S]*?)\n?\$\$\s*(?:\n|$)/.exec(src)
    if (!m) return undefined
    const latex = m[1].trim()
    if (!latex) return undefined
    return { type: 'math_block', raw: m[0], latex, id: '' }
  },
}

/**
 * KE 注释块 tokenizer 工厂：<!-- ke-{kind}: {json} -->（独占行）。
 * JSON 用括号平衡匹配（兼容 params 等嵌套对象），
 * 不会把后续的 ke-* 标记行吞进本 token（贪婪 [\s\S]*\} 在连续标记时会误吞）。
 */
export function keCommentTokenizer(kind: string) {
  return {
    name: `ke_${kind}`,
    level: 'block' as const,
    // 仅当 src 以 <!-- ke-{kind}: 开头（独占行）时返回 0，否则 -1。
    // 不能返回 indexOf('<!--')：那会把含行内 <!-- 的段落切开（如行内脚注标记），
    // 切开后的剩余部分会被 marked 默认 html 规则消费，inline tokenizer 永不执行。
    start: (src: string) => (new RegExp(`^<!--\\s*ke-${kind}:`).test(src) ? 0 : -1),
    tokenize(src: string): MarkdownToken | undefined {
      const startRe = new RegExp(`^<!--\\s*ke-${kind}:\\s*`)
      const m0 = startRe.exec(src)
      if (!m0) return undefined
      const bodyStart = m0[0].length
      if (src[bodyStart] !== '{') return undefined
      const jsonStr = matchBalancedJson(src, bodyStart)
      if (jsonStr === null) return undefined
      const rest = src.slice(bodyStart + jsonStr.length)
      const close = /^\s*-->\s*(?:\n|$)/.exec(rest)
      if (!close) return undefined
      let attrs: Record<string, unknown>
      try {
        attrs = JSON.parse(jsonStr) as Record<string, unknown>
      } catch {
        return undefined
      }
      if (typeof attrs !== 'object' || attrs === null) return undefined
      const raw = src.slice(0, bodyStart + jsonStr.length + close[0].length)
      return { type: `ke_${kind}`, raw, attrs }
    },
  }
}

/**
 * 信息块（note）tokenizer：支持两种格式。
 * 1) 包裹格式（新）：<!-- ke-note: {json} -->\n内容...\n<!-- /ke-note -->
 *    内容（开始标记与结束标记之间的 markdown）随 token.content 交给 parseMarkdown 解析，
 *    使信息块内容成为 PM 可编辑内容（可在块内插入脚注上标等 inline 节点）。
 * 2) 自闭合格式（旧，v0~v3）：<!-- ke-note: {json} -->（content/text 在 json attr 中）
 *    标记 selfClosed: true，由 parseMarkdown 将 content/text 迁移为文本子节点。
 */
export const keNoteTokenizer = {
  name: 'ke_note',
  level: 'block' as const,
  start: (src: string) => (/^<!--\s*ke-note:/.test(src) ? 0 : -1),
  tokenize(src: string): MarkdownToken | undefined {
    const m0 = /^<!--\s*ke-note:\s*/.exec(src)
    if (!m0) return undefined
    const bodyStart = m0[0].length
    if (src[bodyStart] !== '{') return undefined
    const jsonStr = matchBalancedJson(src, bodyStart)
    if (jsonStr === null) return undefined
    const rest = src.slice(bodyStart + jsonStr.length)
    const close = /^\s*-->\s*(?:\n|$)/.exec(rest)
    if (!close) return undefined
    let attrs: Record<string, unknown>
    try {
      attrs = JSON.parse(jsonStr) as Record<string, unknown>
    } catch {
      return undefined
    }
    if (typeof attrs !== 'object' || attrs === null) return undefined
    const headLen = bodyStart + jsonStr.length + close[0].length
    const contentSrc = src.slice(headLen)
    const endTag = '<!-- /ke-note -->'
    const endIdx = contentSrc.indexOf(endTag)
    if (endIdx < 0) {
      // 自闭合（旧格式）：content/text 存于 attr，无块内内容
      const raw = src.slice(0, headLen)
      return { type: 'ke_note', raw, attrs, selfClosed: true }
    }
    // 包裹格式：开始标记后、结束标记前为块内内容
    let inner = contentSrc.slice(0, endIdx)
    // 去掉内容首尾的空白行，保证 parseMarkdown 解析干净
    inner = inner.replace(/^\s*\n/, '').replace(/\s+$/, '')
    const raw = src.slice(0, headLen + endIdx + endTag.length)
    return { type: 'ke_note', raw, attrs, content: inner }
  },
}

/**
 * 从 src[start]（必须是 '{'）开始做括号平衡匹配，返回完整 JSON 字符串。
 * 正确处理字符串内的 { } 与转义，兼容嵌套对象/数组。
 */
function matchBalancedJson(src: string, start: number): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

/** 脚注引用 inline tokenizer：<!-- ke-footnote: {json} -->（行内，渲染为上标 [n]） */
export const footnoteTokenizer = {
  name: 'ke_footnote',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('<!--'),
  tokenize(src: string): MarkdownToken | undefined {
    // 非贪婪匹配到第一个 }（footnote JSON 无嵌套，单行紧凑）
    const m = /^<!--\s*ke-footnote:\s*(\{[\s\S]*?\})\s*-->/.exec(src)
    if (!m) return undefined
    let attrs: Record<string, unknown>
    try {
      attrs = JSON.parse(m[1]) as Record<string, unknown>
    } catch {
      return undefined
    }
    if (typeof attrs !== 'object' || attrs === null) return undefined
    return { type: 'ke_footnote', raw: m[0], attrs }
  },
}

/**
 * 表格 tokenizer（GFM 风格，块级）。
 * 支持带首尾 | 的标准表格；第一行必须是表头，第二行必须是分隔行（|-|-|）。
 * start 宽松（行首含 |），tokenize 严格校验，非表格行会回退给 marked 默认规则。
 */
export const tableTokenizer = {
  name: 'ke_table',
  level: 'block' as const,
  start: (src: string) => (/^[^\n]*\|/.test(src) ? 0 : -1),
  tokenize(src: string): MarkdownToken | undefined {
    const lines = src.split('\n')
    const header = parseTableRow(lines[0])
    if (!header || header.length === 0) return undefined
    const sep = parseTableRow(lines[1])
    if (!sep || sep.some((c) => !/^:?-{3,}:?$/.test(c.trim()))) return undefined
    const rows: string[][] = []
    let i = 2
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) break
      const r = parseTableRow(line)
      if (!r) break
      rows.push(r)
      i++
    }
    const raw = lines.slice(0, i).join('\n')
    return {
      type: 'ke_table',
      raw,
      headers: header.map((c) => c.trim()),
      rows: rows.map((r) => r.map((c) => c.trim())),
    }
  },
}

/**
 * 解析表格行：按「未转义的 |」分割列，`\|` 视为单元格内的字面量管道符（P1-4）。
 * 注意：`\|` 在解析时被还原为 `|`（文本节点内容是真正的 `|`），
 * 序列化端再统一把 `|` 转义回 `\|`，保证往返列数不变。
 */
function parseTableRow(line: string): string[] | null {
  const t = line.trim()
  if (!t.startsWith('|') || !t.endsWith('|')) return null
  const inner = t.slice(1, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '\\' && inner[i + 1] === '|') {
      cur += '|' // 还原转义的管道符
      i++
    } else if (ch === '|') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

/**
 * 脚注区域 tokenizer（块级）：
 * <!-- ke-footnotes:start -->
 * <!-- ke-footnote-item: {"id":"..","n":1,"text":".."} -->
 * <!-- ke-footnotes:end -->
 *
 * 注意：block 扩展的 tokenize 会被 marked 在每个 block 循环直接调用（不先查 start），
 * 因此 tokenize 必须自行校验 src 以 start 标记开头，否则会误吞到文档任意位置的 end 标记。
 */
export const footnotesBlockTokenizer = {
  name: 'ke_footnotes',
  level: 'block' as const,
  start: (src: string) => (/^<!--\s*ke-footnotes:start\s*-->/.test(src) ? 0 : -1),
  tokenize(src: string): MarkdownToken | undefined {
    if (!/^<!--\s*ke-footnotes:start\s*-->/.test(src)) return undefined
    const endTag = '<!-- ke-footnotes:end -->'
    const endIdx = src.indexOf(endTag)
    if (endIdx < 0) return undefined
    const raw = src.slice(0, endIdx + endTag.length)
    const inner = raw.slice(raw.indexOf('-->') + 3, raw.lastIndexOf(endTag))
    const items: Array<Record<string, unknown>> = []
    // P2-17：条目文本可能包含 `}`（甚至紧跟 ` --> `）。非贪婪匹配会在文本内的 `}`
    // 处截断，导致整条脚注丢失。这里先按括号平衡匹配（正确跳过字符串内的 `}`），
    // 失败再回退非贪婪（兼容旧版不规范序列化）。
    const marker = '<!-- ke-footnote-item:'
    let pos = inner.indexOf(marker)
    while (pos >= 0) {
      const after = pos + marker.length
      const parsed = parseFootnoteItem(inner, after)
      if (parsed) {
        items.push(parsed.obj)
        pos = inner.indexOf(marker, parsed.end)
      } else {
        // 单个条目损坏：忽略该条目，但区域整体保留（其他条目不丢）
        pos = inner.indexOf(marker, after)
      }
    }
    return { type: 'ke_footnotes', raw, items }
  },
}

/**
 * 从 `<!-- ke-footnote-item:` 之后的位置解析一个脚注条目 JSON 对象。
 * 先试 matchBalancedJson（正确处理字符串内 `}` 与转义），失败再试非贪婪（旧版容错）。
 * 返回 { obj, end }（end 为条目整体结束下标，含尾部 -->），失败返回 null。
 */
function parseFootnoteItem(src: string, start: number): { obj: Record<string, unknown>; end: number } | null {
  let bodyStart = start
  while (bodyStart < src.length && /\s/.test(src[bodyStart])) bodyStart++
  if (src[bodyStart] !== '{') return null
  // 1) 括号平衡匹配：跳过字符串内的 `}`，得到完整对象
  const balanced = matchBalancedJson(src, bodyStart)
  if (balanced !== null) {
    const rest = bodyStart + balanced.length
    const close = /^\s*-->/.exec(src.slice(rest))
    if (close) {
      try {
        const obj = JSON.parse(balanced) as Record<string, unknown>
        if (obj && typeof obj === 'object') return { obj, end: rest + close[0].length }
      } catch {
        // 平衡匹配得到但 JSON 损坏：回退非贪婪
      }
    }
  }
  // 2) 旧版容错：非贪婪匹配到第一个 `} --> `（文本含裸 `}` 的不规范序列化）
  const greedy = /^\{[\s\S]*?\}\s*-->/.exec(src.slice(bodyStart))
  if (greedy) {
    try {
      const obj = JSON.parse(greedy[0].replace(/\s*-->$/, '')) as Record<string, unknown>
      if (obj && typeof obj === 'object') return { obj, end: bodyStart + greedy[0].length }
    } catch {
      return null
    }
  }
  return null
}

/**
 * 兜底 tokenizer（块级 + 行内）：保留未被具体扩展消费的 ke-* 注释原文。
 * - 命中范围：任意 `<!-- ke-...: ` 注释（含已知 kind + 未知 kind）。
 * - 依赖注册顺序：@tiptap/markdown 通过 marked.use + unshift 注册 tokenizer，
 *   后注册的先执行；GenericFallback 是最先注册的，因此其 tokenizer 最后执行。
 *   于是：具体 ke-* tokenizer（keNote / keComment / footnote / footnotes）先执行，
 *   能正常解析的已知 kind 会被它们消费；只有解析失败（JSON 损坏 / 括号不匹配）
 *   的已知 kind 或未知 kind 才会落到本 fallback，按原文保留。
 * - kind 允许连字符/数字（如 ke-future-block、ke-x2:），确保任意标记可保留。
 */
// 行内兜底：匹配任意 ke-* 注释（含已知 kind + footnote），用于「已知 kind + 损坏 JSON」保留。
const KE_INLINE_CATCH_PATTERN = `^<!--\\s*ke-[a-z][a-z0-9-]*:`
// 块级兜底：排除 footnote（footnote/footnotes/footnote-item 前缀）——footnote 是行内 token，
// 允许块级兜底匹配它会把段落开头的行内脚注引用整块吞掉。note/module/attach/video 等
// 块级已知 kind 仍允许命中，用于「块级已知 kind + 损坏 JSON」的兜底保留。
const KE_BLOCK_CATCH_PATTERN = `^<!--\\s*ke-(?!footnote)[a-z][a-z0-9-]*:`

export const keFallbackTokenizer = {
  name: 'ke_fallback',
  level: 'block' as const,
  start: (src: string) => (new RegExp(KE_BLOCK_CATCH_PATTERN).test(src) ? 0 : -1),
  tokenize(src: string): MarkdownToken | undefined {
    // 非贪婪匹配到行尾的 -->（独占行）。已知块级 kind 已由各自 tokenizer 消费，
    // 能走到这里说明 kind 未知或 JSON 损坏：保留原始文本。
    const m = new RegExp(`${KE_BLOCK_CATCH_PATTERN}[\\s\\S]*?-->\\s*(?:\\n|$)`).exec(src)
    if (!m) return undefined
    return { type: 'ke_fallback', raw: m[0].replace(/\s*$/, '') }
  },
}

/** 通用 fallback（行内）：行内出现的未知 ke-* 注释保留原样 */
export const keFallbackInlineTokenizer = {
  name: 'ke_fallback_inline',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('<!--'),
  tokenize(src: string): MarkdownToken | undefined {
    // 非贪婪匹配到第一个 -->。行内已知 kind（ke-footnote）由具体 tokenizer 先执行，
    // 能走到这里说明是未知 kind 或已知 kind + 损坏 JSON：按原文保留。
    const m = new RegExp(`${KE_INLINE_CATCH_PATTERN}[\\s\\S]*?-->`).exec(src)
    if (!m) return undefined
    return { type: 'ke_fallback_inline', raw: m[0] }
  },
}

/**
 * 普通 HTML 保真 tokenizer（P1-2）：
 * 保留不被任何扩展消费的「普通 HTML 注释」`<!-- ... -->`（非 ke-* 命名空间）与
 * 「HTML 块」（如 `<div class="x">内容</div>`）。这些默认被 marked 归为 html token，
 * 随后被 DOMParser 丢弃（注释整体丢失，块仅保留文本）。
 * 这里注册为块级/行内 tokenizer，命中后按 raw 原样保留。
 */

/** 行内格式化标签（这些在块级出现时由 marked 正常按段落/行内处理，不做块级保真） */
const HTML_INLINE_TAGS = new Set([
  'em', 'strong', 'b', 'i', 'u', 'a', 'code', 'span', 'br', 'img', 'del', 'ins',
  'mark', 'small', 'sub', 'sup', 'kbd', 's', 'abbr', 'cite', 'q', 'samp', 'var', 'time', 'wbr',
])

function isPlainHtmlComment(src: string): boolean {
  return /^<!--/.test(src) && !/^<!--\s*ke-/.test(src)
}

/** 块级 HTML：注释或块级元素（tag 非行内格式化标签、非 ke-*）。 */
export const htmlPassthroughBlockTokenizer = {
  name: 'html_passthrough',
  level: 'block' as const,
  start: (src: string) => {
    if (isPlainHtmlComment(src)) return 0
    if (/^<[a-zA-Z]/.test(src)) {
      const tag = (/^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(src) ?? [])[1]
      if (tag && !HTML_INLINE_TAGS.has(tag.toLowerCase())) return 0
    }
    return -1
  },
  tokenize(src: string): MarkdownToken | undefined {
    if (isPlainHtmlComment(src)) {
      const m = /^<!--[\s\S]*?-->\s*(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'html_passthrough', raw: m[0].replace(/\s*$/, '') }
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/.exec(src)
    if (!open) return undefined
    const tag = open[1].toLowerCase()
    if (HTML_INLINE_TAGS.has(tag)) return undefined
    // 同一标签的匹配结束标签；若无闭合（跨块）则退化为整行。
    const closeRe = new RegExp(`</${open[1]}>`)
    const endTag = closeRe.exec(src)
    if (endTag) {
      const raw = src.slice(0, endTag.index + endTag[0].length)
      return { type: 'html_passthrough', raw }
    }
    // 无闭合标签：仅保留整行（到行尾）
    const line = /^<[a-zA-Z][^>]*>[^\n]*\n?/.exec(src)
    if (!line) return undefined
    return { type: 'html_passthrough', raw: line[0].replace(/\s*$/, '') }
  },
}

/** 行内 HTML：段落中出现的普通 HTML 注释（非 ke-*）原样保留。 */
export const htmlPassthroughInlineTokenizer = {
  name: 'html_passthrough_inline',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('<!--'),
  tokenize(src: string): MarkdownToken | undefined {
    if (!isPlainHtmlComment(src)) return undefined
    const m = /^<!--[\s\S]*?-->/.exec(src)
    if (!m) return undefined
    return { type: 'html_passthrough_inline', raw: m[0] }
  },
}
