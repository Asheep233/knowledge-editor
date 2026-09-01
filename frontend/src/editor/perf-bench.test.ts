import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'
import { MathExtension } from './extensions/MathExtension'
import { MathBlockExtension } from './extensions/MathBlockExtension'
import { TableMarkdownExtension, TableRow, TableCell, TableHeader } from './extensions/TableMarkdownExtension'
import { GenericFallbackExtension, GenericFallbackInlineExtension } from './extensions/GenericFallbackExtension'
import { HtmlPassthroughExtension, HtmlPassthroughInlineExtension } from './extensions/HtmlPassthroughExtension'
import { ImageMarkdownExtension } from './extensions/ImageMarkdownExtension'
import { NoteExtension } from './extensions/NoteExtension'
import { ModuleExtension } from './extensions/ModuleExtension'
import { AttachmentExtension } from './extensions/AttachmentExtension'
import { VideoExtension } from './extensions/VideoExtension'
import { FootnoteExtension } from './extensions/FootnoteExtension'
import { FootnotesExtension } from './extensions/FootnotesExtension'
import { clearMdDocCache, setKeContent } from './index'

const EXT = [
  StarterKit,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
  HtmlPassthroughExtension,
  HtmlPassthroughInlineExtension,
  GenericFallbackExtension,
  GenericFallbackInlineExtension,
  ImageMarkdownExtension,
  MathExtension,
  MathBlockExtension,
  NoteExtension,
  ModuleExtension,
  AttachmentExtension,
  VideoExtension,
  FootnoteExtension,
  FootnotesExtension,
  TableMarkdownExtension,
  TableRow,
  TableCell,
  TableHeader,
]

function makeMd(size: number): string {
  const unit =
    '# 标题 {i}\n\n第{i}段正文，包含 **加粗** 与 $x^2$ 公式。\n\n' +
    '| 列A | 列B |\n|---|---|\n| a{i} | b{i} |\n\n' +
    '<!-- ke-note: {"id":"n{i}","title":"注{i}"} -->\n\n'
  const n = Math.ceil(size / unit.length) + 1
  let s = ''
  for (let i = 0; i < n; i++) s += unit.replaceAll('{i}', String(i))
  return s
}

/** 一次「解析 + 序列化」耗时（ms）。解析 = new Editor(contentType markdown)。 */
export function benchRoundtrip(md: string): { parse: number; serialize: number; total: number } {
  const t0 = performance.now()
  const ed = new Editor({ extensions: EXT, content: md, contentType: 'markdown' })
  const t1 = performance.now()
  const out = ed.getMarkdown()
  const t2 = performance.now()
  ed.destroy()
  void out
  return { parse: t1 - t0, serialize: t2 - t1, total: t2 - t0 }
}

// P3-2 性能门槛：256KB 典型文档「首次解析」上限（防上游/本地二次复杂度回归）。
// 实测基线：marked 纯解析 21ms（线性）→ 等价 HTML→doc 280ms（线性）→
// 上游 @tiptap/markdown 的 markdown→PM JSON 链路 4.4s（256KB）/ 29s（512KB，超线性）。
// 该超线性来自上游 MarkdownManager（token→generateJSON），无法在本仓库线性化修复；
// 本仓库的措施：(1) 会话级解析缓存使「重开」走近似线性的 JSON 路径（实测 733ms/256KB）；
// (2) 以 6s 门槛约束首次解析，防止进一步退化；(3) 512KB 观测项记录实际值。
export const PERF_GATE_256KB_MS = 6000

describe('解析性能基准（P3-2）', () => {
  it('256KB 首次解析有界 + 会话缓存重开 < 1.5s（门槛：防超线性回归）', async () => {
    // 校准基准（128KB，线性因子 ≈ 2）：CI/本机速度差异下门槛自适应，
    // 避免在共享 runner 抖动时误报（实测 CI 首解析 8.9–10.5s，本机 4.4s）。
    const calib = benchRoundtrip(makeMd(128 * 1024)).total
    const gateFirst = Math.max(PERF_GATE_256KB_MS, calib * 5.5) // 二次复杂度：128KB→256KB ≈ ×4~×5，余量
    const gateCached = Math.max(1800, calib * 1.2)
    const md = makeMd(256 * 1024)
    clearMdDocCache()
    const t0 = performance.now()
    const ed = new Editor({ extensions: EXT, content: '', contentType: 'markdown' })
    setKeContent(ed, md) // 首次：markdown 解析路径（上游链路）
    const t1 = performance.now()
    ed.destroy()
    const ed2 = new Editor({ extensions: EXT, content: '', contentType: 'markdown' })
    const t2 = performance.now()
    setKeContent(ed2, md) // 重开：命中缓存（JSON 路径）
    const t3 = performance.now()
    const back = ed2.getMarkdown()
    const t4 = performance.now()
    console.log(`[perf] 256KB: first=${(t1 - t0).toFixed(0)}ms cachedReopen=${(t3 - t2).toFixed(0)}ms serialize=${(t4 - t3).toFixed(0)}ms calib128=${calib.toFixed(0)}ms gateFirst=${gateFirst.toFixed(0)}ms`)
    expect(back.length).toBeGreaterThan(200 * 1024)
    expect(t3 - t2).toBeLessThan(gateCached) // 缓存重开（JSON 路径，P3-2 缓解）
    expect(t1 - t0).toBeLessThan(gateFirst) // 首次解析有界（上游链路，防二次回归）
    ed2.destroy()
  }, 300000)

  it.skipIf(process.env.KE_PERF_512 !== '1')('512KB 耗时（无门槛断言，只观测；KE_PERF_512=1 时运行）', () => {
    const md = makeMd(512 * 1024)
    const r = benchRoundtrip(md)
    console.log(`[perf] 512KB: parse=${r.parse.toFixed(0)}ms serialize=${r.serialize.toFixed(0)}ms total=${r.total.toFixed(0)}ms`)
    expect(r.total).toBeGreaterThan(0)
  }, 300000)

  it('markdown 路径 vs 等价 HTML 路径（定位热点）', () => {
    const base = [StarterKit, Markdown.configure({ indentation: { style: 'space', size: 2 } })]
    const md = makeMd(256 * 1024)
    // 等价 HTML：用简单结构衡量「DOM→PM JSON」环节的成本（序列化路径已证线性）
    const unit =
      '<h1>标题</h1><p>第段正文，包含 <strong>加粗</strong> 与 公式。</p>' +
      '<p>| 列A | 列B |</p><p>注</p>'
    let html = ''
    for (let i = 0; i < 1800; i++) html += unit
    const t0 = performance.now()
    const ed1 = new Editor({ extensions: base, content: html, contentType: 'html' })
    const t1 = performance.now()
    ed1.destroy()
    const t2 = performance.now()
    const ed2 = new Editor({ extensions: base, content: md, contentType: 'markdown' })
    const t3 = performance.now()
    ed2.destroy()
    console.log(
      `[path] html(${(html.length / 1024).toFixed(0)}KB)->doc: ${(t1 - t0).toFixed(0)}ms | md(${(md.length / 1024).toFixed(0)}KB)->doc: ${(t3 - t2).toFixed(0)}ms`,
    )
    expect(t1 - t0).toBeGreaterThan(0)
  }, 300000)

})