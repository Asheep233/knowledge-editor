/**
 * task-74：微分**斜体 `d` → 正体 `\mathrm{d}`** 的转换器（词法级，纯函数，无副作用）。
 *
 * 规格（主理人 2026-10-13 拍板，见工作区 `调查报告-斜体d一键转正体.md`）：
 *  1. **只改微分场景**：`d` 后**紧跟字母**（`dx`/`dy`/`dz`/`dt`/`dM`）或**紧跟命令**（`d\theta`）；
 *  2. **不动**变量（`d_i`/`d^2`/`d \cdot v`）与孤立 `d` → 列进「跳过」区供人过目；
 *  3. 目标写法 `\mathrm{d}`，**幂等**（已是 `\mathrm{d}`/`\text{d}`/`\operatorname{d}` 的不再动）；
 *  4. **只在数学节点内**替换（遍历 `math`/`mathBlock` 的 `latex` 属性），正文/代码块一律不碰；
 *  5. 除目标 `d` 外**逐字节不变**（含原有空格 / `\,` / `\ ` 间隔写法）。
 *
 * 为什么必须词法级：语料实测里绝大多数 `d` 不是微分号，而是
 * 宏名（`\dots` `\dfrac` `\ddot` `\delta` `\deg` `\dim` `\underbrace` `\pmod`）、
 * 环境名（`\begin{bmatrix}` `\end{aligned}`）、文本模式内容（`\text{edited}`）的一部分。
 * 纯字符串替换 100% 会改坏文档。
 *
 * 无法用规则判定的（数学模式里的英文词如 `edited`）→ **仍然列出**，由预览里逐条勾选（默认全勾，
 * 用户可取消）。这是规格明确要求的"人看一眼"环节，不在本模块里偷偷过滤掉。
 */

/** 目标写法 */
export const UPRIGHT_D = '\\mathrm{d}'

/**
 * 这些命令后面的 `{...}` 组**整体跳过**（文本模式 / 已有正体 / 环境名）。
 * 跳过即"绝不改动其中任何字符"，因此也是**幂等**的保证：
 * `\mathrm{d}`（含 `\text{d}`/`\operatorname{d}`）不会被二次套壳。
 */
const GROUP_SKIP_COMMANDS = new Set([
  // 文本模式
  'text', 'textrm', 'textit', 'textbf', 'textsf', 'texttt', 'textnormal', 'textup', 'textsl', 'textsc',
  'mbox', 'hbox', 'fbox', 'fboxrule',
  // 数学字母/正体家族（`\mathrm{d}` 幂等的关键）
  'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathnormal', 'mathcal', 'mathbb', 'mathfrak',
  'operatorname', 'operatornamewithlimits', 'mathop', 'mathbin', 'mathrel', 'mathord', 'mathpunct',
  // 其它带文本参数的常用命令
  'label', 'tag', 'ref', 'eqref', 'cite', 'color', 'textcolor', 'htmlClass',
])

/** 环境类命令：其后的 `{...}` 是**环境名**，整体跳过 */
const ENV_COMMANDS = new Set(['begin', 'end'])

export interface LatexChange {
  /** 在 latex 中的字符偏移 */
  index: number
  /** 判断理由（用于预览展示） */
  reason: string
}

export interface LatexSkip {
  index: number
  /** 跳过理由 */
  reason: string
}

export interface LatexConversion {
  /** 转换后的 latex */
  latex: string
  /** 将修改的每一处 */
  changes: LatexChange[]
  /** 跳过（变量 / 孤立 `d`）的每一处，供人工复核 */
  skips: LatexSkip[]
}

/** `d` 后面是不是「微分对象」：字母或 `\命令` */
function isDifferentialTarget(latex: string, next: number): boolean {
  const ch = latex[next]
  if (ch !== undefined && /[a-zA-Z]/.test(ch)) return true
  if (ch === '\\' && /^\\[a-zA-Z]/.test(latex.slice(next))) return true
  return false
}

/** 读取从 `from` 开始的 `{...}` 平衡组（允许前导空白）；返回整段原文与结束偏移 */
function readBraceGroup(src: string, from: number): { text: string; end: number } | null {
  let i = from
  while (i < src.length && /\s/.test(src[i])) i++
  if (src[i] !== '{') return null
  let depth = 0
  for (let j = i; j < src.length; j++) {
    const ch = src[j]
    if (ch === '\\') {
      j++ // 跳过被转义的字符（`\{`/`\}`）
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { text: src.slice(i, j + 1), end: j + 1 }
    }
  }
  return null
}

/**
 * LaTeX 词法扫描：把「微分候选」的 `d` 换成 `\mathrm{d}`，其余逐字节原样。
 * 跳过：命令名、`\begin/\end{环境}`、文本模式组内容、`%` 注释；记录变量/孤立 `d`。
 */
export function convertLatexUprightD(latex: string): LatexConversion {
  const changes: LatexChange[] = []
  const skips: LatexSkip[] = []
  let out = ''
  let i = 0
  while (i < latex.length) {
    const ch = latex[i]

    // ① 命令：`\` + 字母序列（整体跳过命令名，`d` 在其中不会被误改）
    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(latex.slice(i))
      if (m) {
        out += m[0]
        i += m[0].length
        const cmd = m[1]
        // ② 环境名 / 文本模式组：整体跳过后续 `{...}`
        if (ENV_COMMANDS.has(cmd) || GROUP_SKIP_COMMANDS.has(cmd)) {
          const g = readBraceGroup(latex, i)
          if (g) {
            out += g.text
            i = g.end
          }
        }
        continue
      }
      // `\,` `\;` `\\` `\{` 等：原样（并避免把 `\` 后的字符当候选）
      out += ch
      i++
      if (i < latex.length) {
        out += latex[i]
        i++
      }
      continue
    }

    // ③ `%` 注释到行尾：原样
    if (ch === '%') {
      const nl = latex.indexOf('\n', i)
      const end = nl < 0 ? latex.length : nl
      out += latex.slice(i, end)
      i = end
      continue
    }

    // ④ 微分候选：`d` 紧跟字母或 `\命令`
    if (ch === 'd') {
      if (isDifferentialTarget(latex, i + 1)) {
        changes.push({ index: i, reason: '微分场景（d 后紧跟字母/命令）' })
        out += UPRIGHT_D
        i++
        continue
      }
      // 变量 / 孤立 `d`：不改，但**只在"词首"记录**（避免英文词内部的 d 刷屏）
      const prev = latex[i - 1]
      if (prev === undefined || !/[a-zA-Z]/.test(prev)) {
        skips.push({ index: i, reason: '变量或孤立 d（非微分形态，保持斜体）' })
      }
      out += ch
      i++
      continue
    }

    out += ch
    i++
  }
  return { latex: out, changes, skips }
}

// ---------------------------------------------------------------- 文档级

/** 最小化的 JSON 节点形态（避免依赖 tiptap 类型，便于纯函数测试） */
export interface MathDocNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: MathDocNode[]
  marks?: unknown[]
  text?: string
}

export interface UprightDHit {
  /** 稳定 id：`<nodeIndex>:<charIndex>`（供勾选状态与"不写该处"用例使用） */
  id: string
  nodeIndex: number
  nodeType: string
  index: number
  /** 修改前/后的上下文片段（前后各 20 字符） */
  before: string
  after: string
  reason: string
  /** 该节点变换前/后的完整 latex */
  latexBefore: string
  latexAfter: string
}

export interface UprightDSkip extends Omit<UprightDHit, 'after' | 'latexAfter'> {
  after: string
}

export interface UprightDAnalysis {
  hits: UprightDHit[]
  skips: UprightDSkip[]
  /** 文档里的数学节点总数（math + mathBlock） */
  mathNodes: number
  /** 含可改项的 latex 数（用于增量应用） */
  nodesWithHits: number
}

const CONTEXT = 20

function snippet(text: string, index: number, len = 1): string {
  const from = Math.max(0, index - CONTEXT)
  const to = Math.min(text.length, index + len + CONTEXT)
  return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '')
}

function walkMathNodes(doc: MathDocNode, visit: (node: MathDocNode, nodeIndex: number) => void): void {
  let nodeIndex = 0
  const walk = (n: MathDocNode): void => {
    if (n.type === 'math' || n.type === 'mathBlock') {
      visit(n, nodeIndex++)
      return
    }
    for (const c of n.content ?? []) walk(c)
  }
  walk(doc)
}

/** 分析整篇文档：列出「将修改 N 处 / 跳过 M 处」（不改动入参） */
export function analyzeUprightD(doc: MathDocNode): UprightDAnalysis {
  const hits: UprightDHit[] = []
  const skips: UprightDSkip[] = []
  let mathNodes = 0
  let nodesWithHits = 0
  walkMathNodes(doc, (node, nodeIndex) => {
    mathNodes++
    const latex = String(node.attrs?.latex ?? '')
    const conv = convertLatexUprightD(latex)
    if (conv.changes.length) nodesWithHits++
    for (const c of conv.changes) {
      hits.push({
        id: `${nodeIndex}:${c.index}`,
        nodeIndex,
        nodeType: node.type ?? 'math',
        index: c.index,
        before: snippet(latex, c.index),
        after: snippet(conv.latex, c.index, UPRIGHT_D.length),
        reason: c.reason,
        latexBefore: latex,
        latexAfter: conv.latex,
      })
    }
    for (const s of conv.skips) {
      skips.push({
        id: `${nodeIndex}:${s.index}`,
        nodeIndex,
        nodeType: node.type ?? 'math',
        index: s.index,
        before: snippet(latex, s.index),
        after: snippet(latex, s.index),
        reason: s.reason,
        latexBefore: latex,
      })
    }
  })
  return { hits, skips, mathNodes, nodesWithHits }
}

/** 只对**被勾选**的处应用转换；返回新的文档 JSON（深拷贝，不改动入参） */
export function applyUprightD(
  doc: MathDocNode,
  selected?: Iterable<string>,
): { doc: MathDocNode; applied: number } {
  const allow = selected === undefined ? null : new Set(selected)
  const clone = JSON.parse(JSON.stringify(doc)) as MathDocNode
  let applied = 0
  walkMathNodes(clone, (node, nodeIndex) => {
    const latex = String(node.attrs?.latex ?? '')
    const conv = convertLatexUprightD(latex)
    if (!conv.changes.length) return
    if (allow === null) {
      // 全量应用
      node.attrs = { ...(node.attrs ?? {}), latex: conv.latex }
      applied += conv.changes.length
      return
    }
    // 增量应用：按被勾选的偏移替换（从后往前，避免偏移漂移）
    let next = latex
    const picked = conv.changes.filter((c) => allow.has(`${nodeIndex}:${c.index}`))
    for (const c of [...picked].sort((a, b) => b.index - a.index)) {
      next = next.slice(0, c.index) + UPRIGHT_D + next.slice(c.index + 1)
    }
    if (picked.length) {
      node.attrs = { ...(node.attrs ?? {}), latex: next }
      applied += picked.length
    }
  })
  return { doc: clone, applied }
}

/** 每个含改动的数学节点的「旧 latex → 新 latex」计划（供 Markdown 改写使用） */
export interface UprightDPlanItem {
  nodeIndex: number
  nodeType: string
  oldLatex: string
  newLatex: string
  changed: number
}

export function uprightDPlan(doc: MathDocNode, selected?: Iterable<string>): UprightDPlanItem[] {
  const { doc: next } = applyUprightD(doc, selected)
  const plan: UprightDPlanItem[] = []
  const before: MathDocNode[] = []
  const after: MathDocNode[] = []
  walkMathNodes(doc, (n) => before.push(n))
  walkMathNodes(next, (n) => after.push(n))
  for (let k = 0; k < before.length; k++) {
    const oldLatex = String(before[k].attrs?.latex ?? '')
    const newLatex = String(after[k].attrs?.latex ?? '')
    if (oldLatex === newLatex) continue
    const conv = convertLatexUprightD(oldLatex)
    plan.push({
      nodeIndex: k,
      nodeType: before[k].type ?? 'math',
      oldLatex,
      newLatex,
      changed: conv.changes.length,
    })
  }
  return plan
}

/**
 * 把计划应用到 Markdown 文本（**另存新文件用**，绝不用于改写原文档）。
 *
 * 定位方式：按**文档顺序**逐个查找该数学节点的**完整定界串**
 * （行内 `$latex$` / 块级 `$$\nlatex\n$$`，与 `renderMarkdown` 同口径），
 * 从上次命中的位置往后找 → 顺序敏感、天然跳过重复 latex。
 * 找不到（例如文档被并发改动）时**不猜**：计入 `unmatched` 并保持原文不变，由调用方决定是否中止。
 */
export function applyUprightDToMarkdown(
  markdown: string,
  plan: UprightDPlanItem[],
): { markdown: string; replaced: number; unmatched: UprightDPlanItem[] } {
  let out = markdown
  let cursor = 0
  let replaced = 0
  const unmatched: UprightDPlanItem[] = []
  for (const item of plan) {
    const oldSpan = item.nodeType === 'mathBlock' ? `$$\n${item.oldLatex}\n$$` : `$${item.oldLatex}$`
    const newSpan = item.nodeType === 'mathBlock' ? `$$\n${item.newLatex}\n$$` : `$${item.newLatex}$`
    const at = out.indexOf(oldSpan, cursor)
    if (at < 0) {
      unmatched.push(item)
      continue
    }
    out = out.slice(0, at) + newSpan + out.slice(at + oldSpan.length)
    cursor = at + newSpan.length
    replaced++
  }
  return { markdown: out, replaced, unmatched }
}

/** `<原名>-正体d.md`；`taken` 里已存在时追加 ` (2)`、` (3)`… */
export function uprightDFileName(originalFileName: string, taken: Iterable<string> = []): string {
  const used = new Set(taken)
  const base = originalFileName.replace(/\.md$/i, '')
  const first = `${base}-正体d.md`
  if (!used.has(first)) return first
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-正体d (${n}).md`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-正体d (${Date.now()}).md`
}
