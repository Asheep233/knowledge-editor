/**
 * 导出为普通 Markdown（朴素 Markdown，plain export）。
 *
 * 目标：把 KE 方言文档降级为「任何 Markdown 工具都能干净渲染」的单文件 .md：
 * - 不含 ke_version 与任何 ke-* 注释标记；
 * - 信息块/模块/附件/视频/脚注按设计表降级为标准 Markdown；
 * - 未知或损坏的 ke-* 标记、普通 HTML、数学公式、标准 Markdown 原样保留。
 *
 * 纯函数、零网络、零副作用（与 import-export.ts 的纯函数风格一致）。
 * 设计文档：docs/knowledge-editor-plain-export-design.md
 */

import type { ArticleMeta } from '../types'

export interface PlainMeta {
  /** 导出 frontmatter 的 title（省略则不写该键） */
  title?: string
  /** 导出 frontmatter 的标签列表 */
  tags?: string[]
  created?: string
  updated?: string
}

/** 应删除的 frontmatter 键：ke_version、ke-module 定义块（大小写不敏感） */
function isDroppedFrontmatterKey(key: string): boolean {
  const k = key.trim().toLowerCase()
  return k === 'ke_version' || k === 'ke-module' || k === 'ke_module'
}

/** 文件名字段兜底：从相对路径取 basename */
function basename(p: string): string {
  const s = String(p ?? '').split(/[\\/]/).pop() ?? ''
  const dot = s.lastIndexOf('.')
  return dot > 0 ? s.slice(0, dot) : s
}

/** 从 src 起点（必须是 '{'）做括号平衡匹配，返回完整 JSON 字符串（兼容嵌套与字符串内 `}`）。 */
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

/** 解析 ke 注释：已知 kind（note/module/attach/video/footnote）的 JSON；失败返回 null。 */
function parseKeComment(text: string): { kind: string; attrs: Record<string, unknown> } | null {
  const m = /^<!--\s*(ke-[a-z][a-z0-9-]*):\s*/.exec(text.trim())
  if (!m) return null
  const bodyStart = m[0].length
  if (text.trim()[bodyStart] !== '{') return null
  const jsonStr = matchBalancedJson(text.trim(), bodyStart)
  if (jsonStr === null) return null
  const rest = text.trim().slice(bodyStart + jsonStr.length)
  if (!/^\s*-->/.test(rest)) return null
  try {
    const attrs = JSON.parse(jsonStr) as Record<string, unknown>
    if (typeof attrs !== 'object' || attrs === null) return null
    return { kind: m[1], attrs }
  } catch {
    return null
  }
}

/** YAML 标量安全序列化（标题含 `: # "` 等特殊字符时加引号转义）。 */
function yamlScalar(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v)
  const bad = /[:#/?&*!|>'"%@`{}[\],]|^\s|\s$|^[-+.]|^---$|^---\s/.test(s)
  if (!bad) return s
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 标准 frontmatter 的键行（title/tags/created/updated；全部为空时不生成）。 */
function standardFrontmatterLines(meta: PlainMeta): string[] {
  const lines: string[] = []
  const title = yamlScalar(meta.title)
  if (title !== null) lines.push(`title: ${title}`)
  const tags = Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).trim()).filter(Boolean) : []
  if (tags.length > 0) {
    lines.push('tags:')
    for (const t of tags) lines.push(`  - ${t}`)
  }
  if (meta.created) lines.push(`created: ${yamlScalar(meta.created) ?? meta.created}`)
  if (meta.updated) lines.push(`updated: ${yamlScalar(meta.updated) ?? meta.updated}`)
  return lines
}

/** 前导 frontmatter 块按「顶层键组」切分（删除/替换键时保持其它键逐字节）。 */
function splitLeadingFm(body: string): { fmLines: string[] | null; rest: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n+)+/.exec(body)
  if (!m) return { fmLines: null, rest: body }
  const lines = m[1].split('\n')
  const groups: Array<{ key: string; raw: string[] }> = []
  let cur: { key: string; raw: string[] } | null = null
  for (const line of lines) {
    const km = /^([A-Za-z_][\w-]*)\s*:/.exec(line)
    if (km && !line.startsWith(' ') && !line.startsWith('\t')) {
      cur = { key: km[1], raw: [line] }
      groups.push(cur)
    } else if (cur) {
      cur.raw.push(line)
    }
  }
  // 还原为「去掉闭合 --- 后」的形式：groups 逐组
  const flat: string[] = []
  for (const g of groups) flat.push(...g.raw)
  return { fmLines: flat, rest: body.slice(m[0].length) }
}

/** 移除 KE frontmatter 键后是否已标准化的判断（供 withPlainFrontmatter 合并）。 */
function removeFmGroups(fmLines: string[], dropKeys: Set<string>): string[] {
  const groups: Array<{ key: string; raw: string[] }> = []
  let cur: { key: string; raw: string[] } | null = null
  for (const line of fmLines) {
    const km = /^([A-Za-z_][\w-]*)\s*:/.exec(line)
    if (km && !line.startsWith(' ') && !line.startsWith('\t')) {
      cur = { key: km[1], raw: [line] }
      groups.push(cur)
    } else if (cur) {
      cur.raw.push(line)
    }
  }
  const out: string[] = []
  for (const g of groups) {
    if (!dropKeys.has(g.key.toLowerCase())) out.push(...g.raw)
  }
  return out
}

/**
 * 编排好的标准前端 frontmatter（不含 ke_version），与正文合并为最终输出。
 * - 正文无 frontmatter：直接前置标准键（title/tags/created/updated；空则不生成）；
 * - 正文已有 frontmatter：合并（更新标准键、删除 ke_version/ke-module，其余键逐字节保留）——
 *   保证 plainMarkdown 幂等（对输出再跑一次结果不变）。
 */
export function withPlainFrontmatter(body: string, meta: PlainMeta): string {
  const std = standardFrontmatterLines(meta)
  const { fmLines, rest } = splitLeadingFm(body)
  if (fmLines === null) {
    if (std.length === 0) return body
    return `---\n${std.join('\n')}\n---\n\n${body}`
  }
  // 已有 fm：删除 KE 键 + 标准键组，再把标准键插在最前（其它键逐字节保留）
  const kept = removeFmGroups(fmLines, new Set(['title', 'tags', 'created', 'updated', 'ke_version', 'ke-module', 'ke_module']))
  const merged = [...std, ...kept]
  if (merged.length === 0) return rest
  return `---\n${merged.join('\n')}\n---\n\n${rest}`
}

/**
 * 剥离 KE frontmatter 键，返回去头后的正文（保留保留键，键序不变）。
 * 规则（设计表）：
 * - 删除：ke_version、ke-module 定义块；
 * - 保留：title / tags / created / updated（及其它非 KE 键）；
 * - 全部删除后移除整个 --- 块。
 */
export function stripKeFrontmatter(md: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/.exec(md)
  if (!m) return md
  const keep: string[] = []
  let count = 0
  for (const line of m[1].split('\n')) {
    const km = /^(ke-[\w-]+|ke_[\w-]+|[A-Za-z_][\w-]*)\s*:/.exec(line)
    if (km && isDroppedFrontmatterKey(km[1])) {
      count++
      continue
    }
    keep.push(line)
  }
  const body = md.slice(m[0].length)
  if (count === 0) return md // 无删除项：不动 frontmatter
  // 剩余键是否可渲染为行内键值形式（块列表行属于上一个键，原样保留）
  const head = keep.join('\n').trim()
  if (!head) return body // 删空：移除整个 --- 块
  return `---\n${keep.join('\n')}\n---\n\n${body}`
}

/** 脚注区域 → [^n]: text 定义行（按 n 升序；多行文本续行缩进 4 空格）。 */
function downgradeFootnotesRegion(md: string): { out: string; items: Array<{ n: number; text: string }> } {
  const startTag = '<!-- ke-footnotes:start -->'
  const endTag = '<!-- ke-footnotes:end -->'
  const startIdx = md.indexOf(startTag)
  if (startIdx < 0) return { out: md, items: [] }
  const endIdx = md.indexOf(endTag, startIdx)
  if (endIdx < 0) return { out: md, items: [] }
  const regionEnd = endIdx + endTag.length
  const inner = md.slice(startIdx + startTag.length, endIdx)
  const items: Array<{ n: number; text: string }> = []
  const re = /<!--\s*ke-footnote-item:\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner)) !== null) {
    const bodyStartPos = m.index + m[0].length
    if (inner[bodyStartPos] !== '{') continue
    const jsonStr = matchBalancedJson(inner, bodyStartPos)
    if (jsonStr === null) continue
    const rest = inner.slice(bodyStartPos + jsonStr.length)
    if (!/^\s*-->/.test(rest)) continue
    try {
      const obj = JSON.parse(jsonStr) as Record<string, unknown>
      if (obj && typeof obj === 'object' && obj.text != null) {
        items.push({
          n: Number(obj.n ?? 0),
          text: String(obj.text),
        })
      }
    } catch {
      /* 损坏条目：忽略（该条目作为未知保留由外层处理） */
    }
  }
  if (items.length === 0) return { out: md, items: [] }
  items.sort((a, b) => (a.n || 0) - (b.n || 0))
  const lines: string[] = []
  for (const it of items) {
    const textLines = it.text.split('\n')
    lines.push(`[^${it.n}]: ${textLines[0] ?? ''}`)
    for (const tl of textLines.slice(1)) lines.push(tl.trim() ? `    ${tl.trim()}` : '    ')
  }
  return { out: md.slice(0, startIdx) + lines.join('\n') + md.slice(regionEnd), items }
}

/** 单个 ke 注释的降级（已知 kind）；不命中返回 null（保持原样）。 */
function downgradeKeComment(kind: string, attrs: Record<string, unknown>): string | null {
  const src = typeof attrs.src === 'string' ? attrs.src.trim() : ''
  switch (kind) {
    case 'ke-module': {
      const name = typeof attrs.name === 'string' && attrs.name.trim() ? attrs.name.trim() : '未命名模块'
      return `> 模块：${name}`
    }
    case 'ke-attach': {
      const type = String(attrs.type ?? 'file')
      const title = typeof attrs.title === 'string' && attrs.title.trim() ? attrs.title.trim() : ''
      const caption = typeof attrs.caption === 'string' && attrs.caption.trim() ? attrs.caption.trim() : ''
      const label = title || basename(src)
      if (type === 'image') {
        const alt = title || caption || basename(src)
        const imgLine = src ? `![${alt}](${src})` : `![${alt}]()`
        return caption && caption !== alt ? `${imgLine}\n\n${caption}` : imgLine
      }
      return src ? `[${label}](${src})` : `[${label}]()`
    }
    case 'ke-video': {
      const title = typeof attrs.title === 'string' && attrs.title.trim() ? attrs.title.trim() : ''
      const label = title || basename(src)
      return src ? `[${label}](${src})` : `[${label}]()`
    }
    default:
      return null
  }
}

/**
 * KE 方言 → 朴素 Markdown 的节点降级（纯字符串变换，保持非 KE 内容逐字节不变）。
 *
 * 逐条规则（详见 docs/knowledge-editor-plain-export-design.md）：
 * - ke-note → `> **{label|title|信息}**{（author）}` + 内容逐行 `> ` 前缀（包裹格式与自闭合格式均支持）；
 * - ke-module → `> 模块：{name}`；
 * - ke-attach：image → 图片（alt=title||caption||文件名）+ 图注行（有 caption 时）；file/video → `[title](src)`；
 * - ke-video → `[title](src)`；
 * - ke-footnote → `[^n]`；ke-footnotes 区域 → `[^n]: text` 定义行（按 n 升序，多行缩进 4 空格）；
 * - `<!-- ke-version ... -->` 文档级注释 → 删除；
 * - 未知/损坏的 ke-*（含大小写变体 ke-NOTE）→ 原样保留。
 */
export function downgradeKeNodes(md: string): string {
  let out = md

  // 1) 脚注区域 → 定义行（一次性，提升为文档级）
  const region = downgradeFootnotesRegion(out)
  out = region.out

  // 2) 行内 ke-footnote → [^n]；独立成行的位置型标记 → 删除整行（避免孤立 [^n] 引用）
  out = out
    .split('\n')
    .map((line) => {
      const standalone = /^\s*<!--\s*ke-footnote:\s*({[\s\S]*?})\s*-->\s*$/.exec(line)
      if (standalone) return null
      return line.replace(/<!--\s*ke-footnote:\s*({[\s\S]*?})\s*-->/g, (raw, jsonStr) => {
        try {
          const obj = JSON.parse(jsonStr) as Record<string, unknown>
          const n = Number(obj?.n ?? 0)
          return Number.isFinite(n) ? `[^${n}]` : raw
        } catch {
          return raw
        }
      })
    })
    .filter((l): l is string => l !== null)
    .join('\n')

  // 3) ke-note 包裹格式（头尾标记 + 块内内容）→ 块引用
  out = out.replace(
    /<!--\s*ke-note:\s*({[\s\S]*?})\s*-->\s*\n?\s*([\s\S]*?)\s*\n?\s*<!--\s*\/ke-note\s*-->/g,
    (raw, jsonStr, inner) => {
      const parsed = parseKeComment(`<!-- ke-note: ${jsonStr} -->`)
      if (!parsed) return raw
      const a = parsed.attrs
      const label =
        (typeof a.label === 'string' && a.label.trim()) ||
        (typeof a.title === 'string' && a.title.trim()) ||
        '信息'
      const author = typeof a.author === 'string' && a.author.trim() ? `（${a.author.trim()}）` : ''
      const lines: string[] = [`> **${label}**${author}`]
      const content = inner ?? ''
      for (const line of content.split('\n')) lines.push(line.trim() ? `> ${line}` : '>')
      return lines.join('\n')
    },
  )

  // 4) 自闭合 / 单行 ke-note、ke-module、ke-attach、ke-video：按行处理
  out = out
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      const d = parseKeComment(trimmed)
      if (!d) return line
      if (d.kind === 'ke-note') {
        // 自闭合：内容在 attrs.content / attrs.text
        const a = d.attrs
        const hasInlineBody =
          (typeof a.content === 'string' && a.content.trim()) || (typeof a.text === 'string' && a.text.trim())
        if (!hasInlineBody) {
          const returned = downgradeKeComment(d.kind, a)
          if (returned) return returned
        }
        const text =
          (typeof a.content === 'string' && a.content) || (typeof a.text === 'string' && a.text) || ''
        const label =
          (typeof a.label === 'string' && a.label.trim()) ||
          (typeof a.title === 'string' && a.title.trim()) ||
          '信息'
        const author = typeof a.author === 'string' && a.author.trim() ? `（${a.author.trim()}）` : ''
        if (!text.trim()) return `> **${label}**${author}`
        const lines: string[] = [`> **${label}**${author}`]
        for (const l of text.split('\n')) lines.push(l.trim() ? `> ${l}` : '>')
        return lines.join('\n')
      }
      const returned = downgradeKeComment(d.kind, d.attrs)
      return returned ?? line
    })
    .join('\n')

  // 5) ke-version 文档级注释（独立行）删除；ke-NOTE 等大小写变体不属于已知 kind，保留
  out = out
    .split('\n')
    .filter((line) => !/^\s*<!--\s*ke-version\s*:\s*[\s\S]*?-->\s*$/.test(line))
    .join('\n')

  // 6) 清理：零宽空格（P3-16）一并剥除
  out = out.replace(/\u200b/g, '')
  return out
}

/**
 * 端到端降级导出：
 * `stripKeFrontmatter` → `downgradeKeNodes` → 拼接标准 frontmatter（title/tags/created/updated，无 ke_version）。
 */
export function plainMarkdown(md: string, meta: PlainMeta = {}): string {
  const body = downgradeKeNodes(stripKeFrontmatter(md))
  return withPlainFrontmatter(body, meta)
}

/** 从 article 元信息构造导出 meta（与 EditorArea 调用约定一致）。 */
export function metaFromArticle(article: ArticleMeta): PlainMeta {
  const rawMeta = article.meta ?? {}
  return {
    title: article.title,
    tags: article.tags ?? [],
    created: typeof rawMeta.created === 'string' ? rawMeta.created : undefined,
    updated: typeof rawMeta.updated === 'string' ? rawMeta.updated : undefined,
  }
}
