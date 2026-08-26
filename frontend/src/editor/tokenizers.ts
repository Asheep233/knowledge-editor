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

/** 转义感知的表格行拆分（P1-4）：`\|` 视为单元格内容中的字面 |，不参与列分割。
 * 序列化侧写 `\|` 转义，解析侧必须能识别回读，否则 `| a | b \| c |` 会被错切成 3 列。 */
function parseTableRow(line: string): string[] | null {
  const t = line.trim()
  if (!t.startsWith('|') || !t.endsWith('|')) return null
  const body = t.slice(1, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && body[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  return cells
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
    const re = /<!--\s*ke-footnote-item:\s*(\{[\s\S]*?\})\s*-->/g
    let m: RegExpExecArray | null
    while ((m = re.exec(inner)) !== null) {
      try {
        const obj = JSON.parse(m[1]) as Record<string, unknown>
        if (obj && typeof obj === 'object') items.push(obj)
      } catch {
        // 单个条目损坏：忽略该条目，但区域整体保留（其他条目不丢）
      }
    }
    return { type: 'ke_footnotes', raw, items }
  },
}

/**
 * 任意 ke-* 标记兜底 tokenizer（块级 + 行内）。
 * - 不再用负向前瞻排除已知 kind（P1-3）：fallback 在 marked 扩展数组中最后执行
 *   （最先注册 → unshift 后排在数组末尾），能走到这里说明具体 ke-* tokenizer
 *   （note/module/attach/video/footnote/footnotes）已全部返回 undefined——
 *   因此「已知 kind + 损坏 JSON」也走 fallback 原文保留，不再静默丢弃。
 * - kind 允许连字符/数字（如 ke-future-block、ke-x2:），确保任意未来标记可保留。
 * - 保留原始 raw，保存时原样输出，保证旧编辑器不破坏未来版本文档。
 */
const KE_PATTERN = `^<!--\\s*ke-[a-z][a-z0-9-]*:`

export const keFallbackTokenizer = {
  name: 'ke_fallback',
  level: 'block' as const,
  start: (src: string) => (new RegExp(KE_PATTERN).test(src) ? 0 : -1),
  tokenize(src: string): MarkdownToken | undefined {
    // 独占行约束（P1-3）：块级 ke-* 注释必须自成一行，不得吞并段落。
    // 已知 kind 的有效标记已由各自 tokenizer 消费，能走到这里说明 kind 未知或 JSON 损坏：
    // 保留原始文本。
    const lines = src.split('\n')
    if (!new RegExp(KE_PATTERN).test(lines[0])) return undefined
    // 首行含 `-->` 但行尾不是 `-->`：这是行内标记混在段落里（如段落开头的 ke-footnote 上标），
    // 交给 inline tokenizer，块级 fallback 不得跨行吞并后续正文/footnotes 区域。
    if (lines[0].includes('-->') && !/-->\s*$/.test(lines[0])) return undefined
    // 逐行扫描到第一个以 `-->`（仅尾随空白）结尾的行作为闭合（兼容多行未知标记）。
    let acc = ''
    for (let i = 0; i < lines.length; i++) {
      acc += (i === 0 ? '' : '\n') + lines[i]
      if (/-->\s*$/.test(lines[i])) return { type: 'ke_fallback', raw: acc.replace(/\s*$/, '') }
    }
    return undefined
  },
}

/** 通用 fallback（行内）：行内出现的任何 ke-* 注释（含损坏 JSON）保留原样 */
export const keFallbackInlineTokenizer = {
  name: 'ke_fallback_inline',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('<!--'),
  tokenize(src: string): MarkdownToken | undefined {
    // 非贪婪匹配到第一个 -->。有效 inline kind（ke-footnote）已由具体 tokenizer 消费。
    const m = new RegExp(`${KE_PATTERN}[\\s\\S]*?-->`).exec(src)
    if (!m) return undefined
    return { type: 'ke_fallback_inline', raw: m[0] }
  },
}

/**
 * 普通 HTML 注释保真 tokenizer（块级，独占行）：`<!-- 普通注释 -->`。
 * 非 ke-* 标记（ke-* 由具体扩展或 fallback 消费）；保留原始 raw，round-trip 不丢。
 */
export const htmlCommentBlockTokenizer = {
  name: 'html_comment',
  level: 'block' as const,
  start: (src: string) => (src.startsWith('<!--') ? 0 : -1),
  tokenize(src: string): MarkdownToken | undefined {
    const m = /^<!--(?!\s*ke-)[\s\S]*?-->\s*(?:\n|$)/.exec(src)
    if (!m) return undefined
    return { type: 'html_comment', raw: m[0].replace(/\s*$/, '') }
  },
}

/**
 * 完整 HTML 块保真 tokenizer（块级）：`<div class="x">内容</div>`。
 * 行首开标签 + 同名闭标签；内容区限长，避免无闭标签时把整篇文档吞进 raw。
 * 非 `<tag...>` 开头（段落、列表、ke-* 注释等）不受影响。
 */
export const htmlBlockTokenizer = {
  name: 'html_block',
  level: 'block' as const,
  start: (src: string) => (src.startsWith('<') ? 0 : -1),
  tokenize(src: string): MarkdownToken | undefined {
    const m = /^<([a-z][\w-]*)\b[^>]*>[\s\S]{0,8192}?<\/\1>\s*(?:\n|$)/.exec(src)
    if (!m) return undefined
    return { type: 'html_block', raw: m[0].replace(/\s*$/, '') }
  },
}

/** 普通 HTML 注释保真 tokenizer（行内）：段落中的 `<!-- 注释 -->` 保留原样 */
export const htmlCommentInlineTokenizer = {
  name: 'html_comment_inline',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('<!--'),
  tokenize(src: string): MarkdownToken | undefined {
    const m = /^<!--(?!\s*ke-)[\s\S]*?-->/.exec(src)
    if (!m) return undefined
    return { type: 'html_comment_inline', raw: m[0] }
  },
}
