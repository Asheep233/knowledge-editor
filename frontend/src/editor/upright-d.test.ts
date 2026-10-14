/**
 * task-74 转换器单测：微分斜体 `d` → `\mathrm{d}`（词法级）。
 * 覆盖规格要求的 7 条：① 正确转换 ② 宏名不动 ③ 环境名不动 ④ `\text{edited}` 不动
 * ⑤ 变量 `d_i`/`d^2` 不动 ⑥ 幂等 ⑦ 除目标处外逐字节不变。
 */
import { describe, expect, it } from 'vitest'
import {
  UPRIGHT_D,
  analyzeUprightD,
  applyUprightD,
  applyUprightDToMarkdown,
  convertLatexUprightD,
  uprightDFileName,
  uprightDPlan,
  type MathDocNode,
} from './upright-d'

const conv = (latex: string) => convertLatexUprightD(latex).latex

describe('task-74 ① 正确转换（微分场景）', () => {
  it('dx / dy / dz / dt / dM', () => {
    expect(conv('dx')).toBe(`${UPRIGHT_D}x`)
    expect(conv('dy')).toBe(`${UPRIGHT_D}y`)
    expect(conv('dz')).toBe(`${UPRIGHT_D}z`)
    expect(conv('dt')).toBe(`${UPRIGHT_D}t`)
    expect(conv('dM')).toBe(`${UPRIGHT_D}M`)
  })

  it('d\\theta（紧跟命令）与 dM/dt（两处都改）', () => {
    expect(conv('d\\theta')).toBe(`${UPRIGHT_D}\\theta`)
    expect(conv('dM/dt')).toBe(`${UPRIGHT_D}M/${UPRIGHT_D}t`)
  })

  it('真实语料形态：`\\dot{M} = dM/dt`', () => {
    expect(conv('\\dot{M} = dM/dt')).toBe(`\\dot{M} = ${UPRIGHT_D}M/${UPRIGHT_D}t`)
  })

  it('保留原有间隔写法与其余字节：`\\int_0^1 f(x)\\,dx`', () => {
    expect(conv('\\int_0^1 f(x)\\,dx')).toBe(`\\int_0^1 f(x)\\,${UPRIGHT_D}x`)
  })

  it('花括号内与分数里：`\\frac{dM}{dt}`', () => {
    expect(conv('\\frac{dM}{dt}')).toBe(`\\frac{${UPRIGHT_D}M}{${UPRIGHT_D}t}`)
  })
})

describe('task-74 ② 宏名不动', () => {
  it('\\dots / \\dfrac / \\ddot / \\delta / \\deg / \\dim / \\underbrace / \\pmod', () => {
    for (const cmd of ['\\dots', '\\dfrac', '\\ddot', '\\delta', '\\deg', '\\dim', '\\underbrace{x}', '\\pmod{n}']) {
      expect(conv(cmd), `宏名被改坏：${cmd}`).toBe(cmd)
    }
  })

  it('宏名 + 微分混排：`\\dfrac{dM}{dt} \\dots \\delta x`', () => {
    expect(conv('\\dfrac{dM}{dt} \\dots \\delta x')).toBe(`\\dfrac{${UPRIGHT_D}M}{${UPRIGHT_D}t} \\dots \\delta x`)
  })

  it('命令名里的 `d` 一个都不动：`\\ddagger \\doteq \\downarrow`', () => {
    expect(conv('\\ddagger \\doteq \\downarrow')).toBe('\\ddagger \\doteq \\downarrow')
  })
})

describe('task-74 ③ 环境名不动（\\begin/\\end 的 {...}）', () => {
  it('bmatrix / aligned / array / cases', () => {
    expect(conv('\\begin{bmatrix} a & b \\end{bmatrix}')).toBe('\\begin{bmatrix} a & b \\end{bmatrix}')
    expect(conv('\\begin{aligned} x &= y \\end{aligned}')).toBe('\\begin{aligned} x &= y \\end{aligned}')
    expect(conv('\\begin{array}{cc} a \\end{array}')).toBe('\\begin{array}{cc} a \\end{array}')
    expect(conv('\\begin{cases} a \\end{cases}')).toBe('\\begin{cases} a \\end{cases}')
  })

  it('环境内仍有微分：环境名不动、内容照改', () => {
    expect(conv('\\begin{bmatrix} dx & dy \\end{bmatrix}')).toBe(
      `\\begin{bmatrix} ${UPRIGHT_D}x & ${UPRIGHT_D}y \\end{bmatrix}`,
    )
  })
})

describe('task-74 ④ 文本模式内容不动', () => {
  it('\\text{edited} / \\mathrm{d} / \\operatorname{d} / \\mbox{and}', () => {
    expect(conv('\\text{edited}')).toBe('\\text{edited}')
    expect(conv('\\mathrm{d}')).toBe('\\mathrm{d}')
    expect(conv('\\operatorname{d}')).toBe('\\operatorname{d}')
    expect(conv('\\mbox{and}')).toBe('\\mbox{and}')
  })

  it('文本模式与数学混排：`\\text{days} + dx`', () => {
    expect(conv('\\text{days} + dx')).toBe(`\\text{days} + ${UPRIGHT_D}x`)
  })
})

describe('task-74 ⑤ 变量 / 孤立 d 不动（并记入跳过区）', () => {
  it('d_i / d^2 / d \\cdot v / 孤立 d', () => {
    expect(conv('d_i')).toBe('d_i')
    expect(conv('d^2')).toBe('d^2')
    expect(conv('d \\cdot v')).toBe('d \\cdot v')
    expect(conv('d')).toBe('d')
  })

  it('跳过区记录：`d_i + d^2 + dx` 只改 dx、跳过 2 处', () => {
    const r = convertLatexUprightD('d_i + d^2 + dx')
    expect(r.latex).toBe(`d_i + d^2 + ${UPRIGHT_D}x`)
    expect(r.changes.length).toBe(1)
    expect(r.skips.length).toBe(2)
    expect(r.skips.map((s) => s.index)).toEqual([0, 6])
  })
})

describe('task-74 ⑥ 幂等', () => {
  it('转换两次结果相同（\\mathrm{d} 不再套壳）', () => {
    const once = conv('\\frac{dM}{dt} + \\text{edited} + dx')
    expect(conv(once)).toBe(once)
  })

  it('各种"已是正体"写法都不再动', () => {
    for (const s of ['\\mathrm{d}x', '\\text{d}x', '\\operatorname{d}x', '\\mathbf{d}x']) {
      expect(conv(s), `二次改动：${s}`).toBe(s)
    }
  })

  it('analyze → apply 全量 → 再 analyze 应无命中（文档级幂等）', () => {
    const doc: MathDocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'math', attrs: { latex: 'dx + dy' } }] },
        { type: 'mathBlock', attrs: { latex: '\\frac{dM}{dt}' } },
      ],
    }
    const once = applyUprightD(doc).doc
    expect(analyzeUprightD(once).hits.length).toBe(0)
    expect(applyUprightD(once).applied).toBe(0)
  })
})

describe('task-74 ⑦ 除目标处外逐字节不变', () => {
  it('把目标 `d` 还原后，字符串与原文完全一致（逐字符对比）', () => {
    const src = '\\int_{0}^{1}\\dfrac{dM}{dt}\\,dx = \\text{edited} \\dots \\begin{bmatrix}a\\end{bmatrix} d_i + d^2'
    const out = conv(src)
    // 把新写法还原成 `d` 后应与原文逐字符相同
    const restored = out.split(UPRIGHT_D).join('d')
    expect(restored.length).toBe(src.length)
    for (let i = 0; i < src.length; i++) {
      expect(restored[i], `第 ${i} 个字符被改动`).toBe(src[i])
    }
  })

  it('改动次数 = 新增 \\mathrm{d} 的个数（不多不少）', () => {
    const cases: Array<[string, number]> = [
      ['dx', 1],
      ['dM/dt', 2],
      ['\\frac{dM}{dt}', 2],
      ['\\dots \\delta x', 0],
      ['d_i + d^2', 0],
      ['\\text{edited}', 0],
      ['\\begin{bmatrix}dx\\end{bmatrix}', 1],
    ]
    for (const [latex, n] of cases) {
      const out = conv(latex)
      expect(out.split(UPRIGHT_D).length - 1, `改动数不符：${latex}`).toBe(n)
    }
  })
})

describe('task-74 文档级：分析 / 勾选应用 / 另存计划', () => {
  const doc: MathDocNode = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '正文里的 dx 不该被改' },
          { type: 'math', attrs: { latex: 'dx + d_i' } },
        ],
      },
      { type: 'codeBlock', attrs: {}, content: [{ type: 'text', text: 'dx = 1' }] },
      { type: 'mathBlock', attrs: { latex: 'dM/dt' } },
    ],
  }

  it('只遍历数学节点：正文与代码块不受影响', () => {
    const a = analyzeUprightD(doc)
    expect(a.mathNodes).toBe(2)
    expect(a.hits.map((h) => h.id)).toEqual(['0:0', '1:0', '1:3'])
    expect(a.skips.length).toBe(1) // d_i
  })

  it('勾选子集：只应用被勾选的处（取消勾选不写该处）', () => {
    const r = applyUprightD(doc, ['1:0'])
    const mathNodes: MathDocNode[] = []
    const walk = (n: MathDocNode) => {
      if (n.type === 'math' || n.type === 'mathBlock') mathNodes.push(n)
      for (const c of n.content ?? []) walk(c)
    }
    walk(r.doc)
    expect(r.applied).toBe(1)
    expect(mathNodes[0].attrs?.latex, '未勾选的处不得改动').toBe('dx + d_i')
    expect(mathNodes[1].attrs?.latex).toBe(`${UPRIGHT_D}M/dt`)
  })

  it('不修改入参（纯函数语义）', () => {
    const before = JSON.stringify(doc)
    applyUprightD(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('计划 + Markdown 改写：只改数学跨度，其余原文逐字节保留', () => {
    const md = '正文 dx 不变\n\n$dx + d_i$\n\n```\ndx = 1\n```\n\n$$\ndM/dt\n$$'
    const plan = uprightDPlan(doc)
    const r = applyUprightDToMarkdown(md, plan)
    expect(r.unmatched).toEqual([])
    expect(r.markdown).toBe(
      `正文 dx 不变\n\n$${UPRIGHT_D}x + d_i$\n\n\`\`\`\ndx = 1\n\`\`\`\n\n$$\n${UPRIGHT_D}M/${UPRIGHT_D}t\n$$`,
    )
  })

  it('Markdown 里找不到对应跨度时**不猜**：计入 unmatched 且原文不变', () => {
    const md = '没有任何公式'
    const r = applyUprightDToMarkdown(md, uprightDPlan(doc))
    expect(r.replaced).toBe(0)
    expect(r.unmatched.length).toBe(2)
    expect(r.markdown).toBe(md)
  })
})

describe('task-74 另存文件名：<原名>-正体d.md + 重名序号', () => {
  it('基本形态', () => {
    expect(uprightDFileName('Week3.md')).toBe('Week3-正体d.md')
    expect(uprightDFileName('Week3')).toBe('Week3-正体d.md')
  })

  it('重名追加 (2)、(3)（不覆盖已存在文件）', () => {
    expect(uprightDFileName('Week3.md', ['Week3-正体d.md'])).toBe('Week3-正体d (2).md')
    expect(uprightDFileName('Week3.md', ['Week3-正体d.md', 'Week3-正体d (2).md'])).toBe('Week3-正体d (3).md')
    expect(uprightDFileName('Week3.md', ['其它.md'])).toBe('Week3-正体d.md')
  })
})
