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
import { withFrontmatter } from './ke'
import { setKeContent } from './index'

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
