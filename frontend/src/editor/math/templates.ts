/**
 * 常用公式模板（v1.1.7 M2）。
 * 骨架内 `□`（U+25A1）为内部槽位锚点：仅存于编辑态，保存前必须剥离（见 slots.ts）。
 */
export interface MathTemplate {
  id: string
  label: string
  /** LaTeX 骨架（□ = 槽位） */
  latex: string
  /** 在模板面板分组色（可选） */
  group?: string
}

export const SLOT_CHAR = '□'

export const MATH_TEMPLATES: MathTemplate[] = [
  { id: 'cases', label: '方程组', group: '方程组', latex: '\\begin{cases} □ \\\\ □ \\end{cases}' },
  { id: 'aligned', label: '多行对齐', group: '方程组', latex: '\\begin{aligned} □ &= □ \\\\ □ &= □ \\end{aligned}' },
  { id: 'piecewise', label: '分段函数', group: '方程组', latex: '\\begin{cases} □, & □ < x ≤ □ \\\\ □, & \\text{其他} \\end{cases}' },
  { id: 'pmatrix', label: '矩阵', group: '矩阵', latex: '\\begin{pmatrix} □ & □ \\\\ □ & □ \\end{pmatrix}' },
  { id: 'vmatrix', label: '行列式', group: '矩阵', latex: '\\begin{vmatrix} □ & □ \\\\ □ & □ \\end{vmatrix}' },
  { id: 'bmatrix', label: '方阵', group: '矩阵', latex: '\\begin{bmatrix} □ & □ \\\\ □ & □ \\end{bmatrix}' },
  { id: 'frac', label: '分式', group: '常用', latex: '\\frac{□}{□}' },
  { id: 'sqrt', label: '根式', group: '常用', latex: '\\sqrt[n]{□}' },
  { id: 'sum', label: '求和', group: '常用', latex: '\\sum_{□}^{□}' },
  { id: 'int', label: '积分', group: '常用', latex: '\\int_{□}^{□}' },
]
