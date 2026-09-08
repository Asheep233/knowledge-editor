/**
 * 公式自动补全（v1.1.7 M2，VS Code 式）：`\fr` 前缀 → 悬浮建议 → Tab 选择。
 * 候选 = KaTeX 常用命令 + 模板（带槽位骨架）。
 */
import { MATH_TEMPLATES } from './templates'
import LATEX_CATALOG from './latex-catalog.json'

export interface CompletionItem {
  label: string
  /** 插入内容（骨架含槽位） */
  insert: string
  kind: 'command' | 'template'
  /** 简要说明（右侧注释） */
  detail?: string
}

/** 骨架常用命令（带槽位；优先级最高） */
const SKELETONS: Array<[string, string]> = [
  ['\\frac{}{}', '分式'],
  ['\\sqrt{}', '平方根'],
  ['\\sqrt[n]{}', 'n 次根'],
  ['\\sum', '求和'],
  ['\\sum_{}^{}', '带界求和'],
  ['\\int', '积分'],
  ['\\int_{}^{}', '定积分'],
  ['\\lim', '极限'],
  ['\\lim_{}', '下标极限'],
  ['\\log', '对数'],
  ['\\ln', '自然对数'],
  ['\\exp', '指数'],
  ['\\sin', '正弦'],
  ['\\cos', '余弦'],
  ['\\tan', '正切'],
  ['\\cot', '余切'],
  ['\\sec', '正割'],
  ['\\csc', '余割'],
  ['\\sinh', '双曲正弦'],
  ['\\cosh', '双曲余弦'],
  ['\\tanh', '双曲正切'],
  ['\\alpha', 'α'],
  ['\\beta', 'β'],
  ['\\gamma', 'γ'],
  ['\\delta', 'δ'],
  ['\\epsilon', 'ε'],
  ['\\zeta', 'ζ'],
  ['\\eta', 'η'],
  ['\\theta', 'θ'],
  ['\\lambda', 'λ'],
  ['\\mu', 'μ'],
  ['\\pi', 'π'],
  ['\\rho', 'ρ'],
  ['\\sigma', 'σ'],
  ['\\tau', 'τ'],
  ['\\phi', 'φ'],
  ['\\omega', 'ω'],
  ['\\Gamma', 'Γ'],
  ['\\Delta', 'Δ'],
  ['\\Theta', 'Θ'],
  ['\\Lambda', 'Λ'],
  ['\\Sigma', 'Σ'],
  ['\\Omega', 'Ω'],
  ['\\mathbb{}', '数集（R/Z）'],
  ['\\mathcal{}', '花体'],
  ['\\mathrm{}', '正体'],
  ['\\text{}', '文本（中文）'],
  ['\\mathbf{}', '粗体'],
  ['\\pm', '±'],
  ['\\times', '×'],
  ['\\div', '÷'],
  ['\\cdot', '·'],
  ['\\leq', '≤'],
  ['\\geq', '≥'],
  ['\\neq', '≠'],
  ['\\approx', '≈'],
  ['\\equiv', '≡'],
  ['\\infty', '∞'],
  ['\\partial', '∂'],
  ['\\nabla', '∇'],
  ['\\hat{}', '帽子'],
  ['\\bar{}', '杠'],
  ['\\vec{}', '向量'],
  ['\\dot{}', '点导数'],
  ['\\left(\\right)', '自动括号'],
  ['\\left[\\right]', '自动方括号'],
  ['\\left|\\right|', '自动竖线'],
  ['\\begin{cases}', 'cases 环境'],
  ['\\begin{matrix}', 'matrix 环境'],
  ['\\begin{pmatrix}', 'pmatrix 环境'],
  ['\\begin{aligned}', 'aligned 环境'],
  ['\\begin{array}{cc}', 'array 环境'],
  ['\\color{red}', '红色'],
  ['\\color{blue}', '蓝色'],
  ['\\text{□}', '文本槽'],
  ['\\overbrace{}', '上花括号'],
  ['\\underbrace{}', '下花括号'],
  ['\\binom{}{}', '二项系数'],
  ['\\matrix{}{}', 'matrix'],
  ['\\quad', '间隔'],
  ['\\qquad', '大间隔'],
  ['\\;', '细间隔'],
  ['\\,', '窄间隔'],
  ['\\leftrightarrow', '↔'],
  ['\\Rightarrow', '⇒'],
  ['\\rightarrow', '→'],
  ['\\subseteq', '⊆'],
  ['\\subset', '⊂'],
  ['\\in', '∈'],
]

// 骨架命令（槽位高亮）优先；其次全量 LaTeX 目录（compute-engine 字典 459 条触发器）
const CMD_ITEMS: CompletionItem[] = [
  ...SKELETONS.map(([s, d]) => ({ label: s, insert: s, kind: 'command' as const, detail: d })),
  ...LATEX_CATALOG.map((cmd) => ({ label: cmd, insert: cmd, kind: 'command' as const })),
]

/** 前缀匹配（`\fr` → 所有 \fr* 开头项；含模板名匹配） */
export function completions(raw: string): CompletionItem[] {
  const normalized = raw.replace(/\s+$/, '')
  const hits: CompletionItem[] = []
  for (const it of CMD_ITEMS) {
    if (it.insert.startsWith(normalized) && normalized.length > 0) hits.push(it)
  }
  // 模板：名称或命令前缀命中（插入骨架仍用完整 latex，含槽位）
  for (const t of MATH_TEMPLATES) {
    const key = t.id.toLowerCase()
    if (t.label.includes(raw.trim().replace('\\', '')) || key.startsWith(raw.trim().replace('\\', '')) || t.latex.includes('\\' + raw.trim().replace('\\', ''))) {
      hits.push({ label: t.latex, insert: t.latex, kind: 'template', detail: `模板：${t.label}` })
    }
  }
  // 去重 + 排序：分式/方程组等常用优先 → 按插入串字典序
  const seen = new Set<string>()
  return hits.filter((h) => (seen.has(h.insert) ? false : (seen.add(h.insert), true))).slice(0, 8)
}
