/**
 * P0-S4 原型 harness：独立只读快照 renderer + WebView2 PrintToPdf（真实 PDF）。
 *
 * 语义：打印使用**内存中的当前 session 快照**（含未保存内容），不读取磁盘正文、不触发保存；
 * 渲染包含 KaTeX 公式/表格/图片；调用 Rust 对「本打印窗口」执行 PrintToPdf 输出到系统临时目录。
 * 结果通过 Tauri report_results 落盘供 runner 断言。
 */
import katex from 'katex'
// @ts-expect-error esbuild 以 text loader 注入 CSS 字符串
import katexCss from 'katex/dist/katex.min.css'

interface BootState {
  print_target?: string
}

const UNSAVED_MARK = 'UNSAVED-SNAPSHOT-MARK'

// 模拟「当前会话未保存快照」（真实实现来自常驻 EditorSession 的带 revision 快照）
const sessionSnapshot = {
  revision: 7,
  title: 'S4 独立打印快照',
  markdown: [
    `# ${'S4 独立打印快照'}`,
    '',
    `未保存正文标记：${UNSAVED_MARK}`,
    '',
    '行内公式：$E = mc^2$，根号：$\\sqrt{\\frac{a^2+b^2}{2}}$。',
    '',
    '| 列A | 列B |',
    '| --- | --- |',
    '| 1 | 2 |',
  ].join('\n'),
}

function formulaHtml(): string {
  const inline = katex.renderToString('E = mc^2', { throwOnError: false })
  const sqrt = katex.renderToString('\\sqrt{\\frac{a^2+b^2}{2}}', { throwOnError: false })
  return `<p>行内公式：${inline}；根号：${sqrt}</p>`
}

function buildSnapshotHtml(): string {
  const revisionTag = `<div class="meta">snapshot revision = ${sessionSnapshot.revision}（未保存内容）</div>`
  const heading = `<h1>${sessionSnapshot.title}</h1>`
  const mark = `<p>未保存正文标记：<strong>${UNSAVED_MARK}</strong></p>`
  const table = `<table><thead><tr><th>列A</th><th>列B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`
  return [
    `<style>${katexCss}</style>`,
    '<style>@page{margin:0}html,body{margin:0;padding:0;background:#fff;color:#111;font:14px/1.7 "Segoe UI",sans-serif}',
    '.page{width:716px;min-height:1000px;padding:52.9167px;box-sizing:border-box;background:#fffcf5}',
    'table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 10px}.meta{font-size:11px;opacity:.65}</style>',
    '<div class="page">',
    revisionTag,
    heading,
    mark,
    formulaHtml(),
    table,
    '</div>',
  ].join('\n')
}

function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const g = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__
  if (g?.core?.invoke) return g.core.invoke(cmd, args)
  const i = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__
  if (i?.invoke) return i.invoke(cmd, args)
  return Promise.reject(new Error('no tauri invoke'))
}

async function main(): Promise<void> {
  const out: Record<string, unknown> = { phase: 's4-start' }
  try {
    const boot = (await invoke('boot_state')) as BootState
    out.printTarget = boot.print_target ?? ''
    document.getElementById('snapshot')!.innerHTML = buildSnapshotHtml()
    out.htmlLen = document.getElementById('snapshot')!.innerHTML.length
    out.katexCount = document.querySelectorAll('.katex').length
    out.unsavedMarkPresent = (document.body.textContent ?? '').includes(UNSAVED_MARK)
    out.userAgent = navigator.userAgent
    await new Promise((r) => setTimeout(r, 300)) // 等字体/布局稳定（真实实现等 KaTeX 字体 ready）
    if (!boot.print_target) throw new Error('S1_PRINT_TARGET 未设置')
    const pdfPath = (await invoke('print_window_pdf', {
      windowLabel: 'print-render',
      target: boot.print_target,
      contentWidth: 716,
    })) as string
    out.pdfPath = pdfPath
    out.phase = 's4-done'
  } catch (e) {
    out.phase = 's4-error'
    out.error = String((e as Error)?.stack ?? e)
  }
  const json = JSON.stringify(out, null, 2)
  const pre = document.createElement('pre')
  pre.id = 's4-result'
  pre.textContent = json
  document.body.appendChild(pre)
  try {
    await invoke('report_results', { results: json })
    await invoke('debug_log', { marker: 's4-harness-reported' })
  } catch (e) {
    const err = document.createElement('div')
    err.textContent = 'REPORT FAILED: ' + String(e)
    document.body.appendChild(err)
  }
}

void main()
