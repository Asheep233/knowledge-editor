/**
 * 回归：相邻行内公式 `$\iff$$A$`（两个公式紧挨着）必须解析为**两个**行内公式节点。
 * 用户实测：直接输入正常，刷新（重新解析 Markdown）后渲染成红色错误文本。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { setKeContent } from './index'

const EXT = [MathExtension, MathBlockExtension, HtmlPassthroughExtension, HtmlPassthroughInlineExtension, GenericFallbackExtension, GenericFallbackInlineExtension, StarterKit, Markdown.configure({ indentation: { style: 'space', size: 2 } })]

function mathLatex(md: string): string[] {
  const ed = new Editor({ extensions: EXT, content: '', contentType: 'markdown' })
  setKeContent(ed, md)
  const out: string[] = []
  ed.state.doc.descendants((n) => { if (n.type.name === 'math' || n.type.name === 'mathBlock') out.push((n.attrs.latex as string) ?? '') })
  const ser = ed.getMarkdown()
  ed.destroy()
  return [...out, 'SER:' + ser.trim()]
}

describe('相邻行内公式解析', () => {
  it('$\\iff$$A$ 应解析为两个公式（\\iff 与 A），且往返稳定', () => {
    const got = mathLatex('线性无关$\\iff$$A$可逆。\n')
    expect(got).toEqual(['\\iff', 'A', 'SER:线性无关$\\iff$$A$可逆。'])
  })
  it('普通空格分隔仍然正常', () => {
    expect(mathLatex('$a$ $b$\n')).toEqual(['a', 'b', 'SER:$a$ $b$'])
  })
  it('块级 $$...$$ 不受影响', () => {
    expect(mathLatex('$$\n\\int_0^1 x\\,dx\n$$\n')).toEqual(['\\int_0^1 x\\,dx', 'SER:$$\n\\int_0^1 x\\,dx\n$$'])
  })
})
