/**
 * GFM 脚注 → ke 方言的**解析前规范化**（S-2，规范见 `document-format.md` §2.3.1）。
 *
 * 为什么需要它：
 *   `[^1]: 内容` 在 CommonMark 里是「链接引用定义」（label = `^1`）。`marked` 未实现 GFM
 *   脚注，于是 `[^1]` 被解析为指向该定义的**链接**，保存后写成 `[^1](内容)`；无引用时
 *   定义行被当作「未使用的定义」而消失；4 空格续行（GFM 的合法写法）被当成缩进代码块。
 *   实测三类损坏见方案书 `docs/design-s2-gfm-footnote.md` §1.1。
 *
 * 为什么在解析前用纯函数做，而不是新增 marked tokenizer：
 *   1. 脚注编号 `n` 按 GFM 语义是「定义**首次被引用**的顺序」，而引用通常出现在定义之前
 *      —— tokenizer 是局部作用域，拿不到全文定义集合；全文规范化天然拿得到。
 *   2. **不新增 marked tokenizer** → 不引入与既有规则（GFM 表格 / `$公式$` / `ke-*` /
 *      HTML 透传）的注册顺序抢占风险。
 *   3. 生产环境 markdown 解析入口**仅 `setKeContent` 一处**（`handlePaste` 只处理文件粘贴，
 *      编辑器初始 content 恒为空串），单点接入即可全覆盖。
 *
 * 消歧策略：**定义感知** —— 仅当文档中存在同名定义时才把 `[^label]` 转为脚注节点，
 * 与 GFM 一致（未定义引用本就渲染为字面文本），对不含脚注定义的文档**零行为变化**。
 *
 * ★ 掩码（masking）：文本级改写最大的风险是**误改非正文文本**。必须屏蔽：
 *   围栏代码块、缩进代码块、块级公式、行内代码、行内公式、HTML 注释、行内 HTML 标签、
 *   以及「重复定义」行。方向性取舍：**宁可漏转（退化为字面文本，无损），不可误转**
 *   —— 故掩码规则取**偏保守**（可能多掩），与 `MathExtension` 的精确规则不要求逐字一致。
 *
 * 不新增节点类型：产出即既有 `footnote` / `footnotes` 标记，复用既有 tokenizer 与渲染器。
 */
import { keStableId, toKeComment } from './ke'

/** GFM label 上限（BNF：`^` 与 `]` 之间最多 999 个码元） */
const MAX_LABEL_LEN = 999

const ITEM_PREFIX = '<!-- ke-footnote-item: '
const REGION_START = '<!-- ke-footnotes:start -->'
const REGION_END = '<!-- ke-footnotes:end -->'

/**
 * 标识符归一化 —— 与 micromark `normalizeIdentifier` 等价：折叠空白、去首尾空白、
 * 大小写不敏感。引用与定义经此归一化后相等即匹配（GFM 语义）。
 */
export function normalizeFootnoteLabel(label: string): string {
  return label.replace(/[\t\n\r ]+/g, ' ').replace(/^ | $/g, '').toLowerCase().toUpperCase()
}

/**
 * 解析行首的 GFM 脚注定义起始 `[^label]:`。
 * - 允许 0–3 前导空格；**4 空格是缩进代码块，不算定义**
 * - label 字节 = 非 `[` `\` `]` 且非空白；允许转义 `\[` `\\` `\]`
 * - `]` 后必须紧跟 `:`
 */
export function parseGfmDefinitionStart(line: string): { label: string; body: string } | null {
  const s = line.replace(/^ {0,3}/, '')
  if (!s.startsWith('[^')) return null
  let i = 2
  let label = ''
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') {
      const nx = s[i + 1]
      if (nx === '[' || nx === '\\' || nx === ']') {
        label += nx
        i += 2
        continue
      }
      return null
    }
    if (ch === ']') {
      if (label.length === 0 || label.length > MAX_LABEL_LEN) return null
      if (s[i + 1] !== ':') return null
      return { label, body: s.slice(i + 2).replace(/^[ \t]*/, '') }
    }
    if (ch === '[' || ch === ' ' || ch === '\t') return null
    label += ch
    i += 1
  }
  return null
}

export interface RefSpan {
  start: number
  end: number
  label: string
}

export type Range = [number, number]

/** 区间是否与任一掩码区间相交 */
function overlaps(span: Range, ranges: Range[] | undefined): boolean {
  if (!ranges) return false
  for (const [s, e] of ranges) if (span[0] < e && s < span[1]) return true
  return false
}

/**
 * 行内掩码区间：行内代码（反引号）、行内公式 `$…$`、行内 HTML（注释与标签）、
 * **链接/图片目标 `](…)`**、行首引用式链接定义的 URL。
 * 偏保守（可能多掩）—— 漏转是安全的退化，误转会污染内容。
 */
export function inlineMaskRanges(line: string): Range[] {
  const out: Range[] = []
  // 行首引用式链接定义 `[label]: url` —— URL 段必须掩码（C25）
  const refDef = /^ {0,3}\[[^\]\n]+\]:[ \t]*(\S+)/.exec(line)
  if (refDef) {
    const urlStart = refDef[0].length - refDef[1].length
    out.push([urlStart, refDef[0].length])
  }
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`') {
      let n = 0
      while (line[i + n] === '`') n++
      const close = line.indexOf('`'.repeat(n), i + n)
      const end = close === -1 ? line.length : close + n
      out.push([i, end])
      i = end
      continue
    }
    if (ch === '$') {
      // 行内公式：找同行的下一个未转义 `$`（块级 `$$` 已由行级掩码处理）
      let j = i + 1
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2
          continue
        }
        if (line[j] === '$') break
        j += 1
      }
      if (j < line.length && line[j] === '$') {
        out.push([i, j + 1])
        i = j + 1
        continue
      }
    }
    // 图片 alt 段 `![…]`：alt 是纯字符串，GFM 不在其中解析脚注引用（C28）。
    // 注意**不**掩码链接文本 `[text](url)`——cmark 在链接文本内确实解析脚注，
    // 掩码它会偏离规范（该项独立验证列为「未定罪」，保持不掩码）。
    if (ch === '!' && line[i + 1] === '[') {
      const close = line.indexOf(']', i + 2)
      if (close !== -1) {
        out.push([i, close + 1])
        i = close + 1
        continue
      }
    }
    // 链接 / 图片目标：`](` … 配平 `)`（C21）
    if (ch === '(' && i > 0 && line[i - 1] === ']') {
      let depth = 0
      let j = i
      while (j < line.length) {
        const c = line[j]
        if (c === '\\') {
          j += 2
          continue
        }
        if (c === '(') depth += 1
        else if (c === ')') {
          depth -= 1
          if (depth === 0) break
        }
        j += 1
      }
      if (j < line.length) {
        out.push([i, j + 1])
        i = j + 1
        continue
      }
    }
    if (ch === '<') {
      // HTML 注释 / 标签（`<!-- … -->` 与 `<tag …>` / `</tag>`；自动链接亦被覆盖）
      if (line.startsWith('<!--', i)) {
        const close = line.indexOf('-->', i + 4)
        const end = close === -1 ? line.length : close + 3
        out.push([i, end])
        i = end
        continue
      }
      const m = /^<\/?[a-zA-Z][^>]*>/.exec(line.slice(i))
      if (m) {
        out.push([i, i + m[0].length])
        i += m[0].length
        continue
      }
    }
    i += 1
  }
  return out
}

/**
 * **跨行** code span 掩码（CommonMark 允许 code span 跨行，C22）。
 * 按行扫描反引号 run；未在本行闭合的 run 记为 pending，掩码后续行直到闭合。
 * 返回 lineIdx → 掩码区间。
 */
export function codeSpanMasks(lines: string[]): Map<number, Range[]> {
  const out = new Map<number, Range[]>()
  let pending: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const ranges: Range[] = []
    let j = 0
    if (pending !== null) {
      const closer = line.indexOf('`'.repeat(pending))
      if (closer === -1) {
        ranges.push([0, line.length])
        out.set(i, ranges)
        continue
      }
      ranges.push([0, closer + pending])
      j = closer + pending
      pending = null
    }
    while (j < line.length) {
      if (line[j] === '\\') {
        j += 2
        continue
      }
      if (line[j] === '`') {
        let n = 0
        while (line[j + n] === '`') n++
        const closer = line.indexOf('`'.repeat(n), j + n)
        if (closer === -1) {
          ranges.push([j, line.length])
          pending = n
          j = line.length
        } else {
          ranges.push([j, closer + n])
          j = closer + n
        }
        continue
      }
      j += 1
    }
    if (ranges.length > 0) out.set(i, ranges)
  }
  return out
}

/** 围栏代码块掩码（``` / ~~~，允许 ≤3 前导空格；首尾行均计入）。 */
export function fenceMask(lines: string[]): boolean[] {
  const masked = new Array<boolean>(lines.length).fill(false)
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i])
    if (fence === null) {
      if (m) {
        fence = m[1][0]
        masked[i] = true
      }
      continue
    }
    masked[i] = true
    if (m && m[1][0] === fence) fence = null
  }
  return masked
}

/**
 * 跨行的块级掩码：围栏代码块、块级公式 `$$…$$`、HTML 注释块。
 * （缩进代码块在定义解析之后单独计算——定义续行也是 4 空格。）
 */
function crossLineMask(lines: string[]): Set<number> {
  const block = new Set<number>()
  const fenced = fenceMask(lines)
  for (let i = 0; i < lines.length; i++) if (fenced[i]) block.add(i)

  // 块级公式：成对的 `$$` 行；单行 `$$…$$` 自成一块
  let inMath = false
  for (let i = 0; i < lines.length; i++) {
    if (block.has(i)) continue
    const t = lines[i].trim()
    if (inMath) {
      block.add(i)
      if (t.endsWith('$$')) inMath = false
      continue
    }
    if (!t.startsWith('$$')) continue
    block.add(i)
    if (!(t.length > 4 && t.endsWith('$$'))) inMath = true
  }

  // HTML 注释块（`<!--` 到 `-->` 跨行）
  let inComment = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (inComment) {
      block.add(i)
      if (line.includes('-->')) inComment = false
      continue
    }
    const open = line.indexOf('<!--')
    if (open === -1) continue
    if (line.indexOf('-->', open + 4) === -1) {
      block.add(i)
      inComment = true
    }
  }

  // HTML 块：块级标签独占一行 → 掩码到闭合标签或空行（偏保守：可能多掩）
  let htmlTag: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (htmlTag !== null) {
      block.add(i)
      if (t === '' || t.includes(`</${htmlTag}`)) htmlTag = null
      continue
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>$/.exec(t)
    if (m) {
      htmlTag = m[1]
      block.add(i)
    }
  }
  return block
}

/**
 * 扫描单行内未被转义、且**不在掩码区间内**的 `[^label]`。
 * 转义 `\[^1]`、行内代码、行内公式、行内 HTML 中的均不识别（规范 §2.3.1 边界表）。
 */
export function scanRefsInLine(line: string, maskedRanges?: Range[]): RefSpan[] {
  const out: RefSpan[] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '[' && line[i + 1] === '^') {
      let j = i + 2
      let label = ''
      let ok = false
      while (j < line.length) {
        const c = line[j]
        if (c === '\\') {
          const nx = line[j + 1]
          if (nx === '[' || nx === '\\' || nx === ']') {
            label += nx
            j += 2
            continue
          }
          break
        }
        if (c === ']') {
          ok = label.length > 0 && label.length <= MAX_LABEL_LEN
          break
        }
        if (c === '[' || c === ' ' || c === '\t') break
        label += c
        j += 1
      }
      if (ok) {
        const span: Range = [i, j + 1]
        if (!overlaps(span, maskedRanges)) out.push({ start: span[0], end: span[1], label })
        i = j + 1
        continue
      }
    }
    i += 1
  }
  return out
}

/** 该行是否开启一个新的块（用于中止「懒续行」）。 */
function isBlockStart(line: string): boolean {
  const t = line.trimStart()
  return (
    /^#{1,6}(\s|$)/.test(t) ||
    /^(?:`{3,}|~{3,})/.test(t) ||
    /^>/.test(t) ||
    /^(?:[-*+]|\d+[.)])(\s|$)/.test(t) ||
    /^\|/.test(t) ||
    /^\$\$/.test(t) ||
    /^<!--/.test(t) ||
    /^<[a-zA-Z/!]/.test(t) ||
    /^\[\^/.test(t)
  )
}

/**
 * 未收编的「定义样」行必须**中和**，否则 marked 会把它当链接引用定义消费掉
 * （重复定义 → 内容消失；容器内定义 `> [^1]: x` → 引用块内容消失）。
 * 做法：转义 label 的 `[` 与 `]` → marked 视作字面文本，内容可见且往返稳定。
 * @param at 行内 `[` 的下标
 */
function escapeDefinitionMarker(line: string, at: number): string {
  let j = at + 2
  while (j < line.length) {
    if (line[j] === '\\') {
      j += 2
      continue
    }
    if (line[j] === ']') break
    j += 1
  }
  if (j >= line.length) return line
  return `${line.slice(0, at)}\\[${line.slice(at + 1, j)}\\]${line.slice(j + 1)}`
}

/** 「定义样」行的探测（允许容器前缀 `> ` / 列表标记 与标题标记）。 */
const DEFINITION_LIKE_RE = /^(?:\s*(?:>+\s*|[-*+]\s+|\d+[.)]\s+))*(?:#{1,6}\s+)?\[\^[^\]\s]+\]:/

interface Def {
  key: string
  text: string
  startLine: number
  blockLines: number[]
}

/** 单次预扫描的完整结果（定义 / 待中和行 / 引用 / 掩码），供规范化与计数复用。 */
interface Scan {
  defs: Def[]
  byKey: Map<string, number>
  /** 被收编的定义行 */
  defLine: Set<number>
  /** 未收编的「定义样」行 → 需转义的 `[` 下标（保留为字面文本，决策 4 / 容器定义） */
  protect: Map<number, number>
  refsByLine: Map<number, RefSpan[]>
  /** 首次引用顺序 */
  order: string[]
  blockLines: Set<number>
  inlineMask: Map<number, Range[]>
}

function scanDocument(lines: string[]): Scan {
  const blockCross = crossLineMask(lines)

  // ---- 1) 定义（首个生效） ----
  const defs: Def[] = []
  const byKey = new Map<string, number>()
  const defLine = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    if (blockCross.has(i)) continue
    const d = parseGfmDefinitionStart(lines[i])
    if (!d) continue
    const key = normalizeFootnoteLabel(d.label)
    if (byKey.has(key)) continue // 重复定义：交给下方 protect 中和
    const body = [d.body]
    const block = [i]
    let j = i + 1
    while (j < lines.length) {
      if (blockCross.has(j)) break
      if (/^[ \t]*$/.test(lines[j])) {
        // 空行：仅当其后紧跟 4 空格/Tab 续行时才属于本定义
        let k = j
        while (k < lines.length && /^[ \t]*$/.test(lines[k])) k++
        if (k < lines.length && !blockCross.has(k) && /^(?: {4}|\t)/.test(lines[k])) {
          for (let t = j; t < k; t++) {
            body.push('')
            block.push(t)
          }
          j = k
          continue
        }
        break
      }
      if (/^(?: {4}|\t)/.test(lines[j])) {
        block.push(j)
        body.push(lines[j].replace(/^(?: {4}|\t)/, ''))
        j += 1
        continue
      }
      // 懒续行（CommonMark/GFM）：非空且不开启新块 → 并入本定义
      // （GitHub Docs 官方多行脚注示例即 0 缩进懒续行，见 SRC-7）
      if (!isBlockStart(lines[j])) {
        block.push(j)
        body.push(lines[j])
        j += 1
        continue
      }
      break
    }
    while (body.length > 1 && body[body.length - 1] === '') body.pop()
    byKey.set(key, defs.length)
    for (const b of block) defLine.add(b)
    defs.push({ key, text: body.join('\n'), startLine: i, blockLines: block })
    i = j - 1
  }

  // ---- 2) 缩进代码块（定义行之后计算：定义续行也是 4 空格，不能当代码块） ----
  const blockLines = new Set<number>(blockCross)
  for (let i = 0; i < lines.length; i++) {
    if (blockLines.has(i) || defLine.has(i)) continue
    if (/^(?: {4}|\t)/.test(lines[i]) && lines[i].trim() !== '') blockLines.add(i)
  }

  // ---- 3) 未收编的「定义样」行 → 中和（防 marked 消费导致内容消失） ----
  const protect = new Map<number, number>()
  for (let i = 0; i < lines.length; i++) {
    if (blockLines.has(i) || defLine.has(i)) continue
    const m = DEFINITION_LIKE_RE.exec(lines[i])
    if (!m) continue
    const at = m[0].indexOf('[^') // 容器前缀/标题标记之后，label 的 `[`
    if (at >= 0) protect.set(i, at)
  }

  // ---- 4) 行内掩码（单行规则 + 跨行 code span） ----
  const inlineMask = new Map<number, Range[]>()
  const codeMasks = codeSpanMasks(lines)
  for (let i = 0; i < lines.length; i++) {
    if (blockLines.has(i)) continue
    const r = [...inlineMaskRanges(lines[i]), ...(codeMasks.get(i) ?? [])]
    if (r.length > 0) inlineMask.set(i, r)
  }

  // ---- 5) 引用（文档顺序；仅统计有同名定义者） ----
  const refsByLine = new Map<number, RefSpan[]>()
  const order: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (blockLines.has(i) || defLine.has(i) || protect.has(i)) continue
    const spans = scanRefsInLine(lines[i], inlineMask.get(i)).filter((s) =>
      byKey.has(normalizeFootnoteLabel(s.label)),
    )
    if (spans.length === 0) continue
    refsByLine.set(i, spans)
    for (const s of spans) {
      const k = normalizeFootnoteLabel(s.label)
      if (!order.includes(k)) order.push(k)
    }
  }

  return { defs, byKey, defLine, protect, refsByLine, order, blockLines, inlineMask }
}

/** 编号：先按首次引用顺序，再补未被引用的定义（保证不丢内容）。 */
function numberDefs(scan: Scan): Map<string, number> {
  const nOf = new Map<string, number>()
  let next = 1
  for (const k of scan.order) nOf.set(k, next++)
  for (const d of scan.defs) if (!nOf.has(d.key)) nOf.set(d.key, next++)
  return nOf
}

/**
 * 把 GFM 脚注语法规范化为 ke 方言标记。无脚注定义时**原样返回**（零行为变化）。
 *
 * - 定义：`[^label]: 首段` + 4 空格/Tab 续行 → 按**定义首次被引用**的顺序编号，
 *   在**首个定义所在位置**汇总为一个 `ke-footnotes` 区域（ke 模型只有单一区域）
 * - 重复定义：首个生效，其余保留为字面文本（不静默丢行、不产生多余上标）
 * - 引用：`[^label]`（未转义、不在代码/公式/HTML 内、且存在同名定义）→ `ke-footnote` 行内标记
 */
export function normalizeGfmFootnotes(md: string): string {
  if (!md.includes('[^')) return md // 快速路径：绝大多数文档零成本
  const eol = md.includes('\r\n') ? '\r\n' : '\n'
  const lines = md.split(/\r?\n/)
  const scan = scanDocument(lines)
  // 注意：**没有可收编定义时也可能需要中和**（如 `> [^1]: x` 这类未收编的定义样行，
  // 若原样透传，marked 会把它当 link-ref-def 消费 → 容器内容消失）
  if (scan.defs.length === 0 && scan.protect.size === 0) return md

  const nOf = numberDefs(scan)
  const sorted = [...scan.defs].sort((a, b) => (nOf.get(a.key) ?? 0) - (nOf.get(b.key) ?? 0))
  const itemLines = sorted.map(
    (d) => `${ITEM_PREFIX}${JSON.stringify({ id: footnoteId(d.key), n: nOf.get(d.key) ?? 0, text: d.text })} -->`,
  )
  // 已有 ke-footnotes 区域时**并入**（ke 模型只有单一区域，不得产生第二个/空壳区域）
  const existingEnd = lines.findIndex((l) => l.includes('<!-- ke-footnotes:end -->'))
  const mergeIntoExisting = existingEnd >= 0 && itemLines.length > 0
  const regionLines =
    itemLines.length === 0 || mergeIntoExisting ? [] : [REGION_START, ...itemLines, REGION_END]
  const firstDefLine = scan.defs.length > 0 ? scan.defs[0].startLine : -1

  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i === firstDefLine && regionLines.length > 0) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('')
      out.push(...regionLines)
      out.push('')
      continue
    }
    if (mergeIntoExisting && i === existingEnd) {
      out.push(...itemLines) // 插到既有 `end` 之前
      out.push(lines[i])
      continue
    }
    if (scan.defLine.has(i)) continue
    const at = scan.protect.get(i)
    if (at !== undefined) {
      // 未收编的「定义样」行：转义中和，保留为字面文本（不静默丢内容）
      out.push(escapeDefinitionMarker(lines[i], at))
      continue
    }
    const spans = scan.refsByLine.get(i)
    if (!spans) {
      out.push(lines[i])
      continue
    }
    let line = lines[i]
    for (const s of [...spans].reverse()) {
      const k = normalizeFootnoteLabel(s.label)
      const marker = toKeComment('footnote', { id: footnoteId(k), n: nOf.get(k) ?? 0 })
      line = line.slice(0, s.start) + marker + line.slice(s.end)
    }
    out.push(line)
  }
  // 空行压缩在**行数组**上做（原实现在 join 后用 /\n{3,}/ 对 CRLF 永不匹配）
  const collapsed: string[] = []
  for (const l of out) {
    if (l === '' && collapsed.length > 0 && collapsed[collapsed.length - 1] === '') continue
    collapsed.push(l)
  }
  return collapsed.join(eol)
}

/** 由归一化 label 派生确定性 id（复用 `keStableId` 的 FNV 哈希 → 注释安全的十六进制）。 */
export function footnoteId(normalizedLabel: string): string {
  return keStableId({ label: normalizedLabel }, ['label'])
}

/** 供测试与调试：统计会被转换的定义/引用数量（不做任何修改）。 */
export function countGfmFootnotes(md: string): { definitions: number; references: number } {
  if (!md.includes('[^')) return { definitions: 0, references: 0 }
  const scan = scanDocument(md.split(/\r?\n/))
  let refs = 0
  for (const spans of scan.refsByLine.values()) refs += spans.length
  return { definitions: scan.defs.length, references: refs }
}
