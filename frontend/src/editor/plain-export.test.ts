/**
 * 普通 Markdown 导出（plain export）回归测试。
 * 锁死六项断言（见 docs/knowledge-editor-plain-export-design.md）：
 *   1) 输出不含任何 ke-* 子串，且标准内容逐字节保留；
 *   2) 脚注引用与定义数量、编号一致；
 *   3) frontmatter 键删留正确（ke_version/ke-module 删除，title/tags/created/updated 保留，删空移除块）；
 *   4) 未知/损坏的 ke-* 标记原样保留；
 *   5) 幂等：对输出再跑一次结果不变；
 *   6) image / file / video 降级形态正确。
 */
import { describe, expect, it } from 'vitest'
import {
  downgradeKeNodes,
  metaFromArticle,
  plainMarkdown,
  stripKeFrontmatter,
  withPlainFrontmatter,
} from './plain-export'
import type { ArticleMeta } from '../types'

const SAMPLE = [
  '---',
  'ke_version: 1',
  'title: 示例文档',
  'tags: [alpha, beta]',
  '---',
  '',
  '# 标题',
  '',
  '<!-- 普通注释 -->',
  '',
  '正文段落，含 $x^2$ 公式与 **加粗**，表格：',
  '',
  '| 列A | 列B |',
  '|---|---|',
  '| a | b |',
  '',
  '<!-- ke-note: {"id":"n1","label":"提示","title":"标题","author":"张三","color":"blue"} -->',
  '信息内容第一行',
  '',
  '第二段内容',
  '<!-- /ke-note -->',
  '',
  '<!-- ke-module: {"id":"m1","name":"定理模块","version":1} -->',
  '',
  '![普通图](Attachments/images/pic.png)',
  '',
  '脚注引用正文[^1]与第二个[^2]。',
  '',
  '<!-- ke-footnote: {"id":"f1","n":1} -->',
  '<!-- ke-footnote: {"id":"f2","n":2} -->',
  '',
  '<!-- ke-footnotes:start -->',
  '<!-- ke-footnote-item: {"id":"f2","n":2,"text":"第二脚注，含 } 花括号与换行\\n续行文本。"} -->',
  '<!-- ke-footnote-item: {"id":"f1","n":1,"text":"第一脚注"} -->',
  '<!-- ke-footnotes:end -->',
  '',
  '<!-- ke-version: 1 -->',
  '',
  '<!-- ke-unknown-thing: {"a":1} -->',
  '',
  '<!-- ke-attach: {"kind":"attach","id":"a1","type":"image","src":"Attachments/images/img.png","title":"截图"} -->',
  '',
  '<!-- ke-note-capital: 大小写变体保留 -->',
  '',
  '<!-- ke-attach: {bad json} -->',
].join('\n')

describe('plain export：降级规则（KE 方言 → 朴素 Markdown）', () => {
  it('1) 输出不含任何 ke-* 子串，且标准内容逐字节保留', () => {
    const out = plainMarkdown(SAMPLE, { title: '示例文档', tags: ['alpha', 'beta'] })
    expect(out).not.toMatch(/ke-/)         // 无任何 ke-* 子串
    expect(out).not.toMatch(/ke_version/) // 无版本头
    // 标准内容保留（逐字节片段）
    for (const piece of [
      '# 标题',
      '<!-- 普通注释 -->',
      '正文段落，含 $x^2$ 公式与 **加粗**，表格：',
      '| 列A | 列B |',
      '|---|---|',
      '| a | b |',
      '![普通图](Attachments/images/pic.png)',
    ]) {
      expect(out).toContain(piece)
    }
  })

  it('2) 脚注引用与定义数量、编号一致（按 n 升序、多行缩进 4 空格）', () => {
    const out = plainMarkdown(SAMPLE, {})
    const refs = [...out.matchAll(/\^(\d+)(?!:)/g)].map((m) => m[1])
    const defs = [...out.matchAll(/^\[\^(\d+)\]:/gm)].map((m) => m[1])
    expect(refs).toEqual(['1', '2'])
    expect(defs).toEqual(['1', '2']) // 升序（输入区域是 2 在前、1 在后）
    expect(out).toContain('[^1]: 第一脚注')
    expect(out).toContain('[^2]: 第二脚注，含 } 花括号与换行')
    expect(out).toContain('    续行文本。')   // 4 空格续行
    // 引用在定义前
    expect(out.indexOf('脚注引用正文[^1]')).toBeLessThan(out.indexOf('[^1]: 第一脚注'))
  })

  it('3) frontmatter 键删留正确（删空则移除整个块）', () => {
    // 混合：删除 ke_version/ke-module，保留 title/tags/created/updated
    const md = [
      '---',
      'ke_version: 1',
      'ke-module:',
      '  - 定义一',
      'title: 题',
      'tags: [a]',
      'created: 2026-01-01T00:00:00Z',
      'updated: 2026-02-02T00:00:00Z',
      '---',
      '',
      '# 正文',
    ].join('\n')
    const body = stripKeFrontmatter(md)
    expect(body).not.toContain('ke_version')
    expect(body).not.toContain('ke-module')
    expect(body).toContain('title: 题')
    expect(body).toContain('tags: [a]')
    expect(body).toContain('created: 2026-01-01T00:00:00Z')
    expect(body).toContain('updated: 2026-02-02T00:00:00Z')
    expect(body).toContain('# 正文')
    // 删空 → 移除整个 --- 块
    const empty = stripKeFrontmatter('---\nke_version: 1\n---\n\n# 正文')
    expect(empty).toBe('# 正文')
    // withPlainFrontmatter：仅含保留键，不含 ke_version
    const fm = withPlainFrontmatter('# 正文', { title: 'T: 带冒号', tags: ['x'], created: 'a', updated: 'b' })
    expect(fm).toMatch(/^---\ntitle: "T: 带冒号"\ntags:\n  - x\ncreated: a\nupdated: b\n---\n\n/m)
    expect(fm).not.toContain('ke_version')
    // metaFromArticle 提取
    const meta = metaFromArticle({ title: '甲', tags: ['t'], meta: { created: 'c1', updated: 'u1' } } as ArticleMeta)
    expect(meta).toEqual({ title: '甲', tags: ['t'], created: 'c1', updated: 'u1' })
  })

  it('4) 未知/损坏的 ke-* 标记、ke-NOTE 变体原样保留', () => {
    const out = downgradeKeNodes(SAMPLE)
    expect(out).toContain('<!-- ke-unknown-thing: {"a":1} -->')
    expect(out).toContain('<!-- ke-note-capital: 大小写变体保留 -->')
    expect(out).toContain('<!-- ke-attach: {bad json} -->')
    // 已知 kind 不残留
    expect(out).not.toMatch(/<!--\s*ke-(note|module|attach|video|footnote)\b/)
  })

  it('5) 幂等：对输出再跑一次结果不变', () => {
    const once = plainMarkdown(SAMPLE, { title: '示例文档', tags: ['alpha', 'beta'] })
    const twice = plainMarkdown(once, { title: '示例文档', tags: ['alpha', 'beta'] })
    expect(twice).toBe(once)
  })

  it('6) image / file / video 降级形态正确', () => {
    const md = [
      '<!-- ke-attach: {"kind":"attach","id":"a1","type":"image","src":"Attachments/images/x.png","title":"截图","caption":"图注文字"} -->',
      '',
      '<!-- ke-attach: {"kind":"attach","id":"a2","type":"file","src":"Attachments/files/doc.pdf","title":"说明文档"} -->',
      '',
      '<!-- ke-video: {"kind":"video","id":"v1","src":"Attachments/videos/v.mp4","title":"演示视频"} -->',
    ].join('\n')
    const out = downgradeKeNodes(md)
    // image：alt + 图注行
    expect(out).toContain('![截图](Attachments/images/x.png)')
    expect(out).toContain('\n\n图注文字')
    // file：链接（title）
    expect(out).toContain('[说明文档](Attachments/files/doc.pdf)')
    // video：链接（title）
    expect(out).toContain('[演示视频](Attachments/videos/v.mp4)')
    // 无任何 ke- 残留
    expect(out).not.toMatch(/ke-(attach|video)/)
  })

  it('ke-note 包裹格式：徽章 + author + 多行逐行 > 前缀', () => {
    const md = [
      '<!-- ke-note: {"id":"n1","label":"提示","author":"李四"} -->',
      '第一行',
      '',
      '第二行',
      '<!-- /ke-note -->',
    ].join('\n')
    const out = downgradeKeNodes(md)
    expect(out).toContain('> **提示**（李四）')
    expect(out).toContain('> 第一行')
    expect(out).toContain('>')
    expect(out).toContain('> 第二行')
  })
})
