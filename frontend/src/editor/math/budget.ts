/**
 * 公式源**预算**与**降级策略**（单一事实源）。
 *
 * task-63 A10（第三份独立审查 2026-10-09）：显示节点（MathNodeView）有 10,000 字符 /
 * 512 层花括号预算，但**编辑模态**（MathEditorModal）的实时预览没有共享它 ——
 * 12,001 字符的公式在模态里照样全量渲染，实测生成约 1.92 MB HTML / 36,005 个 KaTeX span /
 * 约 1.2 s；保存后节点才变纯文本回退（同一份内容两套策略）。
 * 现在两处共用本模块的预算与降级函数：超限即**不渲染**，改给明确提示。
 *
 * 为什么预算放在 `editor/math/`：它是纯函数、无 React 依赖，节点与模态都依赖它；
 * `MathNodeView.tsx` 仍**再导出**这些符号（既有测试与调用点的导入路径不变）。
 */

/**
 * R06（2026-10-02 独立审查 · P1 存储型 XSS 修复）——公式源长度预算。
 * KaTeX 的 `throwOnError:false` 只覆盖**语法**错误，不覆盖运行时异常：
 * 实测 `'{'×6000 + <img onerror> + '}'×6000`（12070 字符）抛
 * `RangeError: Maximum call stack size exceeded`。修复前该异常会走
 * `dangerouslySetInnerHTML={{__html: latex}}` 回退分支 → 把文档可控的原始
 * latex 当 HTML 注入（Web 前端实测脚本执行）。
 * 预算在送入 KaTeX **之前**判定，超限直接走「纯文本回退」，既堵住病态输入
 * 的渲染开销，也不再依赖 catch 兜底。
 */
export const MAX_MATH_LATEX_LEN = 10000

/**
 * 花括号嵌套深度预算。实测阈值（真实 katex 0.18）：深度 2000 正常、3000 抛
 * `RangeError`；`\frac{` 嵌套 1000 也抛。512 远低于阈值，而真实公式嵌套深度
 * 通常个位数~两位数。
 */
export const MAX_MATH_LATEX_DEPTH = 512

/** 回退态**展示**截断长度；完整原文放 title，仍可双击进入编辑器查看/修改 */
export const MAX_MATH_FALLBACK_DISPLAY = 200

/** 回退态 title 上限：避免把 12KB 攻击原文塞进属性（完整原文仍可双击进编辑器查看） */
export const MAX_MATH_FALLBACK_TITLE = 500

/** 公式源是否在预算内（长度 + 花括号嵌套深度；`\{`/`\}` 转义不计入） */
export function isMathLatexWithinBudget(latex: string): boolean {
  if (latex.length > MAX_MATH_LATEX_LEN) return false
  let depth = 0
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i]
    if (ch === '\\') {
      i++ // 跳过被转义字符（`\{` / `\}` 是字面花括号，不参与嵌套计数）
      continue
    }
    if (ch === '{') {
      depth++
      if (depth > MAX_MATH_LATEX_DEPTH) return false
    } else if (ch === '}') {
      depth = depth > 0 ? depth - 1 : 0
    }
  }
  return true
}

/** 回退态展示文本（超长截断；完整原文通过 title 提供） */
export function fallbackDisplayText(latex: string): string {
  return latex.length > MAX_MATH_FALLBACK_DISPLAY ? `${latex.slice(0, MAX_MATH_FALLBACK_DISPLAY)}…` : latex
}

/** 回退态 title（同样截断；内容由 React 转义写入属性，不参与 HTML 解析） */
export function fallbackTitle(latex: string): string {
  const head = '公式无法渲染，已按纯文本显示（双击编辑）：'
  return latex.length > MAX_MATH_FALLBACK_TITLE ? `${head}${latex.slice(0, MAX_MATH_FALLBACK_TITLE)}…` : `${head}${latex}`
}

/** 超预算原因（供 UI 给**明确**提示，而不是静默降级） */
export interface MathBudgetVerdict {
  ok: boolean
  /** 超限原因：长度 / 嵌套深度 */
  reason?: 'length' | 'depth'
  /** 实测/统计值（提示文案用） */
  length: number
  /** 超长时探测到的最大花括号深度（仅在 depth 判定时给出精确值；否则为 0） */
  depth?: number
}

/** 预算判定 + 原因（节点用于降级，模态用于提示；同一套口径） */
export function mathBudgetVerdict(latex: string): MathBudgetVerdict {
  if (latex.length > MAX_MATH_LATEX_LEN) {
    return { ok: false, reason: 'length', length: latex.length }
  }
  let depth = 0
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '{') {
      depth++
      if (depth > MAX_MATH_LATEX_DEPTH) {
        return { ok: false, reason: 'depth', length: latex.length, depth }
      }
    } else if (ch === '}') {
      depth = depth > 0 ? depth - 1 : 0
    }
  }
  return { ok: true, length: latex.length }
}

/** 超预算时给用户的提示文案（节点回退态 title 与模态提示共用同一句口径） */
export function budgetNotice(latex: string): string {
  const v = mathBudgetVerdict(latex)
  if (v.ok) return ''
  if (v.reason === 'length') {
    return `公式过长（${v.length} 字符 > ${MAX_MATH_LATEX_LEN}），已停止实时渲染以免卡顿；内容仍会原样保存。`
  }
  return `公式嵌套过深（花括号 > ${MAX_MATH_LATEX_DEPTH} 层），已停止实时渲染以免卡顿；内容仍会原样保存。`
}
