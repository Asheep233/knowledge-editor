/**
 * 第三份外部独立审查（v1.2.9 @ 98b525e）· 往返/导出批次回归。
 * 样本来自证据包 `fixtures/`（已拷入 `src/editor/__fixtures__/audit1009/`）。
 *  - A07：CRLF frontmatter 保存不得丢 LF（`ke.ts` 版本键正则的前置 `\s*` 会吃掉 CR 后的 LF）
 *  - A03：标准图片特殊字符（角括号路径 / 转义引号 / 转义闭括号）往返不得丢节点
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { KeBlockquote, KeDocument } from './extensions/KeBlockJoin'
import { KeListItem, OrderedListParenExtension } from './extensions/ListExtension'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { stripFrontmatter, withFrontmatter } from './ke'
import { plainMarkdown } from './plain-export'
import { setKeContent } from './index'
import type { Node as PMNode } from '@tiptap/pm/model'

const fx = (n: string) => readFileSync(join(process.cwd(), 'src/editor/__fixtures__/audit1009', n), 'utf8')
const lf = (s: string) => (s.match(/\n/g) ?? []).length

const EXT = [
  StarterKit.configure({ trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] } }),
  ImageMarkdownExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
] as never

function images(md: string): string[] {
  const ed = new Editor({ extensions: EXT, content: '', contentType: 'markdown' })
  setKeContent(ed, md)
  const out: string[] = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'image') out.push(JSON.stringify({ src: n.attrs.src, alt: n.attrs.alt, title: n.attrs.title }))
  })
  const roundtrip = ed.getMarkdown()
  ed.destroy()
  return [...out, `SER:${roundtrip}`]
}

/** 含 ke-* 扩展的最小编辑器（信息块 / 任务列表 / 引用 / 列表） */
const KE_EXT = [
  StarterKit.configure({
    orderedList: false,
    listItem: false,
    document: false,
    blockquote: false,
    trailingNode: { node: 'paragraph', notAfter: ['paragraph', 'footnotes'] },
  }),
  KeDocument,
  KeBlockquote,
  OrderedListParenExtension,
  KeListItem,
  TaskList,
  TaskItem,
  NoteExtension,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
] as never

function keEditor(md: string): Editor {
  const ed = new Editor({ extensions: KE_EXT, content: '', contentType: 'markdown' })
  setKeContent(ed, stripFrontmatter(md).content)
  return ed
}

/** 信息块内部块级子节点的类型序列 + 序列化结果 */
function noteBlocks(md: string): { types: string[]; text: string[]; ser: string } {
  const ed = keEditor(md)
  let note: PMNode | null = null
  ed.state.doc.descendants((n) => {
    if (!note && n.type.name === 'note') note = n
  })
  const types: string[] = []
  const text: string[] = []
  ;(note as PMNode | null)?.forEach((child) => {
    types.push(child.type.name)
    text.push(child.textContent)
  })
  const ser = ed.getMarkdown()
  ed.destroy()
  return { types, text, ser }
}

/** 列表嵌套树（类型 + 首行文本），用于 A05 结构稳定性断言 */
function listTree(md: string): unknown[] {
  const ed = keEditor(md)
  const walkList = (node: PMNode): unknown => ({
    type: node.type.name,
    items: node.childCount
      ? Array.from({ length: node.childCount }, (_v, i) => {
          const item = node.child(i)
          const sub: unknown[] = []
          item.forEach((c) => {
            if (['bulletList', 'orderedList', 'taskList'].includes(c.type.name)) sub.push(walkList(c))
          })
          return { text: item.textContent, checked: item.attrs?.checked ?? null, sub }
        })
      : [],
  })
  const out: unknown[] = []
  ed.state.doc.forEach((child) => {
    if (['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) out.push(walkList(child))
  })
  ed.destroy()
  return out
}

describe('A02 信息块块级边界（P1）', () => {
  it('两段正文 + 两项列表 + 引用：序列化必须建立块级分隔，往返后结构不丢', () => {
    const md = fx('roundtrip-minimal-note.md')
    const first = noteBlocks(md)
    expect(first.types, `初始解析结构：${JSON.stringify(first.types)}`).toEqual([
      'paragraph',
      'paragraph',
      'bulletList',
      'blockquote',
    ])
    // 序列化：块与块之间必须有空行（否则再导入会粘连）
    expect(first.ser, '段落之间缺少块级分隔').toMatch(/信息块第一段。\n\n信息块第二段。/)
    expect(first.ser, '段落与列表之间缺少块级分隔').toMatch(/信息块第二段。\n\n- 信息块列表一/)
    expect(first.ser, '列表与引用之间缺少块级分隔').toMatch(/- 信息块列表二\n\n> 信息块引用。/)

    const second = noteBlocks(withFrontmatter(first.ser, 1))
    expect(second.types, `往返后结构漂移：${JSON.stringify(second)}`).toEqual([
      'paragraph',
      'paragraph',
      'bulletList',
      'blockquote',
    ])
  })
})

describe('A04 普通导出不得改写代码里的字面 KE 示例（P1）', () => {
  it('围栏代码 / 行内代码 / 缩进代码逐字节保留；真实节点仍降级', () => {
    const src = fx('roundtrip-boundary-literal-ke.md')
    const out = plainMarkdown(src, { title: 'x' })

    // 期望值全部**从样本自身推导**（避免转写误差）：代码区域每一行都必须原样出现在导出里
    const fenceStart = src.indexOf('```markdown')
    const fenceEnd = src.indexOf('```', fenceStart + '```markdown'.length)
    expect(fenceStart, '样本缺少围栏代码块').toBeGreaterThan(-1)
    const fenceLines = src
      .slice(fenceStart + '```markdown'.length, fenceEnd)
      .split('\n')
      .filter((l) => l.trim() !== '')
    expect(fenceLines.length, '样本围栏内容为空').toBeGreaterThan(3)
    for (const line of fenceLines) {
      expect(out, `围栏代码行被改写：${line}`).toContain(line)
    }

    // 行内代码：整行原样（脚注注释不得变成 [^4]）
    const inlineLine = src.split('\n').find((l) => l.includes('`before') && l.includes('ke-footnote')) ?? ''
    expect(inlineLine, '样本缺少行内代码行').not.toBe('')
    expect(out, '行内代码里的脚注标记被转换').toContain(inlineLine)
    expect(out).not.toContain('[^4] after')

    // 缩进代码：整行原样（附件示例不得变成图片 Markdown）
    const indentedLine = src.split('\n').find((l) => /^ {4}<!--\s*ke-attach/.test(l)) ?? ''
    expect(indentedLine, '样本缺少缩进代码行').not.toBe('')
    expect(out, '缩进代码行被改写').toContain(indentedLine)

    // 控制项：代码之外的**真实节点**仍按设计降级
    const real = plainMarkdown(
      '正文\n\n<!-- ke-attach: {"kind":"attach","id":"a1","type":"file","src":"Attachments/files/f.pdf","title":"真实附件"} -->\n',
      { title: 'x' },
    )
    expect(real, '真实附件节点仍应降级').toContain('[真实附件](Attachments/files/f.pdf)')
  })
})

describe('A06 普通导出附件目标/说明文字转义（P2）', () => {
  it('含空格与圆括号的目标用角括号保护、标签转义；普通目标不受影响', () => {
    const out = plainMarkdown(fx('roundtrip-boundary-path-label.md'), { title: 'x' })
    expect(out, '空格/圆括号目标未加角括号').toContain('<Attachments/files/audit file (v1).pdf>')
    expect(out, '图片目标未加角括号').toContain('<Attachments/images/audit image (v1).png>')
    expect(out, '标签中的方括号未转义').toContain('标题 \\[方括号\\] 与 (圆括号)')
    expect(out, '图片 alt 中的方括号未转义').toContain('配图 \\[A\\]')

    const plain = plainMarkdown(
      '<!-- ke-attach: {"kind":"attach","id":"p1","type":"file","src":"Attachments/files/plain.pdf","title":"普通附件"} -->\n',
      { title: 'x' },
    )
    expect(plain, '无特殊字符时应保持原样（不加角括号）').toContain('[普通附件](Attachments/files/plain.pdf)')
  })
})

describe('A05 混合任务列表嵌套级别往返稳定（P2）', () => {
  it('未完成父项内的普通子列表与嵌套任务往返后仍在同一层级', () => {
    const src = [
      '- [ ] 未完成父项',
      '  - 普通子项',
      '  - [ ] 嵌套任务',
      '- [x] 完成项',
      '',
    ].join('\n')
    const before = listTree(src)
    const ser = (() => {
      const ed = keEditor(src)
      const out = ed.getMarkdown()
      ed.destroy()
      return out
    })()
    const after = listTree(ser)
    expect(after, `往返后嵌套结构漂移：\n序列化=${JSON.stringify(ser)}\nbefore=${JSON.stringify(before)}\nafter=${JSON.stringify(after)}`).toEqual(before)
  })

  it('审查原始丰富样本（roundtrip-rich-valid.md）：混排任务列表嵌套级别往返稳定', () => {
    const src = fx('roundtrip-rich-valid.md')
    const before = listTree(src)
    const ed = keEditor(src)
    const ser = ed.getMarkdown()
    ed.destroy()
    const after = listTree(ser)
    expect(
      after,
      `丰富样本嵌套结构漂移：\n序列化=${JSON.stringify(ser)}\nbefore=${JSON.stringify(before)}\nafter=${JSON.stringify(after)}`,
    ).toEqual(before)
  })

  it('更丰富样本：普通子列表 + 嵌套任务 + 有序子列表 + 二级任务，往返结构稳定', () => {
    const samples = [
      // ① 父任务 → 普通子列表 / 嵌套任务；父任务结束后接普通项
      ['- [ ] 未完成父项', '  - 普通子项 A', '  - [ ] 嵌套任务', '- [x] 完成项', ''].join('\n'),
      // ② 父任务 → 有序子列表 + 嵌套任务（混排更复杂）
      ['- [ ] 父项', '  1. 有序子项', '  2. 有序子项二', '  - [x] 嵌套完成任务', '- 普通项', ''].join('\n'),
      // ③ 两级任务嵌套
      ['- [ ] 一级未完成', '  - [x] 二级已完成', '    - [ ] 三级未完成', ''].join('\n'),
    ]
    for (const src of samples) {
      const before = listTree(src)
      const ed = keEditor(src)
      const ser = ed.getMarkdown()
      ed.destroy()
      const after = listTree(ser)
      expect(
        after,
        `嵌套结构漂移：\n源=${JSON.stringify(src)}\n序列化=${JSON.stringify(ser)}\nbefore=${JSON.stringify(before)}\nafter=${JSON.stringify(after)}`,
      ).toEqual(before)
      // 幂等：再往返一次仍稳定
      const ed2 = keEditor(ser)
      const ser2 = ed2.getMarkdown()
      ed2.destroy()
      expect(listTree(ser2), `第二次往返不稳定：${JSON.stringify(ser2)}`).toEqual(before)
    }
  })
})

describe('A07 CRLF frontmatter 保存不得丢 LF', () => {
  it('BOM+CRLF 样本：LF 数不减少、CRLF 结构保持、幂等', () => {
    const raw = fx('edge-bom-crlf.md')
    const out = withFrontmatter(raw, 1)
    expect(lf(out), `丢了一个 LF：\nraw=${JSON.stringify(raw.slice(0, 90))}\nout=${JSON.stringify(out.slice(0, 90))}`).toBe(lf(raw))
    expect(out).toContain('custom: keep-me\r\n')
    expect(out).not.toContain('keep-me\rke_version')
    expect(withFrontmatter(out, 1), '重复保存不稳定').toBe(out)
  })
})

describe('A03 标准图片特殊字符往返', () => {
  it('四张图（角括号路径 / 转义引号 / 转义闭括号 / 对照）往返后仍是四个 image 节点', () => {
    const md = fx('roundtrip-boundary-standard-image.md')
    const first = images(md)
    const nodes = first.filter((x) => x.startsWith('{'))
    expect(nodes.length, `初始解析就不是 4 张图：${JSON.stringify(first)}`).toBe(4)
    const ser = first[first.length - 1].slice(4)
    const second = images(ser).filter((x) => x.startsWith('{'))
    expect(second.length, `往返后丢节点（4→${second.length}）：\n序列化=${JSON.stringify(ser)}`).toBe(4)
    expect(second, '往返后节点属性不一致').toEqual(nodes)
    // 序列化形态：空格路径必须角括号保护；title 内引号必须转义
    expect(ser).toContain('<Attachments/images/audit image (v1).png>')
    expect(ser).toContain('\\"引号\\"')
    expect(ser).toContain('替代文本含\\]字符')
  })
})
