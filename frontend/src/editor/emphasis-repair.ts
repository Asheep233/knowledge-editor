/**
 * 2026-11-10：**加载期**修复历史文档里的「非法强调」字面量。
 *
 * 背景：1.3.0-rc.3 及更早版本的序列化器可能产出 CommonMark 非法强调，例如
 * `前 **正常字体。**继续` —— 闭合 `**` 前是标点、后是词字符 → 不满足 right-flanking，
 * 解析回退成字面 `**`。用户文档被这样写坏后，再次打开仍显示字面 `**`；
 * 即使新版序列化器已修（markdown-boundary.ts），旧文件不会自愈。
 *
 * 本模块在解析入口（`setKeContent`）前把这些「本应成立、但边界非法」的强调对
 * 改写成等价 HTML 标签（`<strong>`/`<em>`/`<s>`）——解析器会把标准标签还原成
 * 对应 mark，于是：
 *  - 旧文档打开即恢复粗体/斜体/删除线（内容一个字符不丢）；
 *  - 保存时走新的合法 Markdown（`**正常字体**。继续`），彻底自愈；
 *  - 合法 Markdown 不受影响（只有边界非法的强调对才改写，幂等）。
 *
 * 安全边界：
 *  - 跳过围栏代码块（``` / ~~~）与行内代码（`...`）；
 *  - 跳过反斜杠转义的 `\*`；
 *  - 只处理成对、且「边界非法」的强调分隔符；孤立 `*`/`**` 保持原文。
 */

type DelimKind = 'bold' | 'italic' | 'strike'

interface DelimSpec {
  kind: DelimKind
  token: '*' | '**' | '~~'
  openTag: string
  closeTag: string
}

const SPECS: DelimSpec[] = [
  { kind: 'bold', token: '**', openTag: '<strong>', closeTag: '</strong>' },
  { kind: 'strike', token: '~~', openTag: '<s>', closeTag: '</s>' },
  { kind: 'italic', token: '*', openTag: '<em>', closeTag: '</em>' },
]

const PUNCT_CHAR = /[\p{P}\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/u
const WORD_CHAR = /[\p{L}\p{N}]/u

/** 行内位置是否在反引号代码段内（成对反引号） */
function codeSpanRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') {
      i++
      continue
    }
    let run = 1
    while (line[i + run] === '`') run++
    const marker = '`'.repeat(run)
    const close = line.indexOf(marker, i + run)
    if (close < 0) break
    ranges.push([i, close + run])
    i = close + run
  }
  return ranges
}

function insideRanges(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => pos >= s && pos < e)
}

function isEscaped(line: string, pos: number): boolean {
  let backslashes = 0
  let i = pos - 1
  while (i >= 0 && line[i] === '\\') {
    backslashes++
    i--
  }
  return backslashes % 2 === 1
}

/** 收集某行中未被转义、且不在代码段内的 delimiter 起点（token 长度精确匹配） */
function findDelimiters(line: string, token: string): number[] {
  const ranges = codeSpanRanges(line)
  const out: number[] = []
  let i = 0
  while (i <= line.length - token.length) {
    if (line.startsWith(token, i) && !isEscaped(line, i) && !insideRanges(i, ranges)) {
      // `**` 不能命中 `***`/`****` 的子串（避免破坏加粗+斜体组合）
      const prev = line[i - 1]
      const next = line[i + token.length]
      if (token === '**') {
        if (prev === '*' || next === '*') {
          i++
          continue
        }
      }
      if (token === '*') {
        if (prev === '*' || next === '*') {
          i++
          continue
        }
      }
      if (token === '~~') {
        if (prev === '~' || next === '~') {
          i++
          continue
        }
      }
      out.push(i)
      i += token.length
      continue
    }
    i++
  }
  return out
}

function isInvalidOpener(line: string, pos: number, token: string): boolean {
  const after = line[pos + token.length]
  const before = line[pos - 1]
  if (after === undefined) return false
  // CommonMark left-flanking：分隔符后是标点，且前面是词字符 → 不能开
  if (!PUNCT_CHAR.test(after)) return false
  if (before === undefined) return false
  return WORD_CHAR.test(before)
}

function isInvalidCloser(line: string, pos: number, token: string): boolean {
  const before = line[pos - 1]
  const after = line[pos + token.length]
  if (before === undefined) return false
  // CommonMark right-flanking：分隔符前是标点，且后面是词字符 → 不能闭
  if (!PUNCT_CHAR.test(before)) return false
  if (after === undefined) return false
  return WORD_CHAR.test(after)
}

function repairLine(line: string, spec: DelimSpec): string {
  const positions = findDelimiters(line, spec.token)
  if (positions.length < 2) return line
  const replacements: Array<[number, number, string]> = []
  for (let i = 0; i + 1 < positions.length; i += 2) {
    const open = positions[i]
    const close = positions[i + 1]
    if (close <= open) continue
    const invalid = isInvalidOpener(line, open, spec.token) || isInvalidCloser(line, close, spec.token)
    if (!invalid) continue
    replacements.push([open, spec.token.length, spec.openTag])
    replacements.push([close, spec.token.length, spec.closeTag])
  }
  if (replacements.length === 0) return line
  replacements.sort((a, b) => b[0] - a[0]) // 从后往前替换，避免偏移
  let out = line
  for (const [pos, len, tag] of replacements) out = out.slice(0, pos) + tag + out.slice(pos + len)
  return out
}

/**
 * 修复 Markdown 中「边界非法」的强调分隔符（加载期调用；幂等）。
 * @param markdown 原始 Markdown（可含 frontmatter；本函数只按行处理正文）
 */
export function repairInvalidEmphasis(markdown: string): string {
  if (!markdown || (!markdown.includes('**') && !markdown.includes('~~') && !markdown.includes('*'))) return markdown
  const lines = markdown.split('\n')
  let fenced = false
  let fenceToken = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      if (!fenced) {
        fenced = true
        fenceToken = fenceMatch[1][0]
      } else if (fenceMatch[1][0] === fenceToken) {
        fenced = false
      }
      continue
    }
    if (fenced) continue
    let next = line
    for (const spec of SPECS) next = repairLine(next, spec)
    lines[i] = next
  }
  return lines.join('\n')
}
