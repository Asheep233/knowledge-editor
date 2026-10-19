/**
 * T26 G3：可信快照打印文档组装（自包含 HTML + 内置打印 CSS）。
 *
 * 为什么自包含：Rust `print_snapshot_pdf` 把本 HTML `document.write` 进隐藏 renderer 页
 * （`frontend/public/print-render.html`，同源但无应用 CSS）。打印样式必须随 HTML 内联，
 * 不能依赖主窗口的 app shell / print.css 选择器（那套规则面向主窗口 DOM 结构）。
 *
 * 主题：沿用产品当前明暗（隐藏 renderer 里用内联 CSS 变量还原背景/正文颜色，
 * 与产品「PDF 跟随当前主题」的既有导出观感一致）。
 */

export type PrintColorTheme = 'light' | 'dark'

export interface SnapshotPrintDocumentOptions {
  /** 快照 Markdown 渲染出的 HTML body 片段（产品编辑器同源 schema 序列化） */
  bodyHtml: string
  /** 文档标识（写入 `<title>`，仅诊断用） */
  title?: string
  theme?: PrintColorTheme
}

/** 打印 CSS：通用排版 + 产品 KE 节点（公式/信息块/附件/脚注）的降级样式。 */
export const SNAPSHOT_PRINT_CSS = `
:root {
  --bg: #ffffff; --fg: #1f2937; --muted: #6b7280;
  --border: #d1d5db; --code-bg: #f3f4f6; --accent: #4f46e5;
}
html[data-theme="dark"] {
  --bg: #0f1115; --fg: #e5e7eb; --muted: #9ca3af;
  --border: #374151; --code-bg: #1f2937; --accent: #818cf8;
}
@page { margin: 14mm; }
html, body {
  margin: 0; padding: 0;
  background: var(--bg); color: var(--fg);
  print-color-adjust: exact; -webkit-print-color-adjust: exact;
}
body {
  font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
  font-size: 16px; line-height: 1.75;
}
.ke-snapshot-print h1, .ke-snapshot-print h2, .ke-snapshot-print h3,
.ke-snapshot-print h4, .ke-snapshot-print h5, .ke-snapshot-print h6 {
  margin: 1.1em 0 0.45em; line-height: 1.35; font-weight: 700;
  page-break-after: avoid; break-after: avoid-page;
}
.ke-snapshot-print h1 { font-size: 1.9em; }
.ke-snapshot-print h2 { font-size: 1.55em; }
.ke-snapshot-print h3 { font-size: 1.3em; }
.ke-snapshot-print h4 { font-size: 1.12em; }
.ke-snapshot-print p { margin: 0.5em 0; }
.ke-snapshot-print ul, .ke-snapshot-print ol { margin: 0.5em 0; padding-left: 1.6em; }
.ke-snapshot-print li { margin: 0.18em 0; }
.ke-snapshot-print li > p { margin: 0.1em 0; }
.ke-snapshot-print a { color: var(--accent); text-decoration: underline; }
.ke-snapshot-print blockquote {
  margin: 0.8em 0; padding: 0.25em 1em; border-left: 3px solid var(--border);
  color: var(--muted);
}
.ke-snapshot-print pre {
  margin: 0.8em 0; padding: 0.75em 1em; border-radius: 6px;
  background: var(--code-bg); font-size: 13px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
  page-break-inside: avoid; break-inside: avoid-page;
}
.ke-snapshot-print code {
  font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
  font-size: 0.92em; background: var(--code-bg); border-radius: 3px; padding: 0 0.2em;
}
.ke-snapshot-print pre code { background: transparent; padding: 0; font-size: inherit; }
.ke-snapshot-print table {
  border-collapse: collapse; width: 100%; margin: 0.8em 0;
  page-break-inside: avoid; break-inside: avoid-page;
}
.ke-snapshot-print th, .ke-snapshot-print td {
  border: 1px solid var(--border); padding: 0.35em 0.6em; text-align: left; vertical-align: top;
}
.ke-snapshot-print th { background: var(--code-bg); font-weight: 600; }
.ke-snapshot-print img { max-width: 100%; height: auto; }
.ke-snapshot-print hr { border: 0; border-top: 1px solid var(--border); margin: 1em 0; }
.ke-snapshot-print [data-ke-math] {
  font-family: "Cambria Math", "STIX Two Math", serif; white-space: nowrap;
}
.ke-snapshot-print [data-ke-math-block] {
  margin: 0.8em 0; padding: 0.45em 0.9em; border-radius: 6px;
  background: var(--code-bg); font-family: "Cambria Math", "STIX Two Math", serif;
  page-break-inside: avoid; break-inside: avoid-page;
}
.ke-snapshot-print [data-ke-note] {
  margin: 0.8em 0; padding: 0.55em 0.9em; border: 1px solid var(--border);
  border-left: 4px solid var(--accent); border-radius: 6px;
  page-break-inside: avoid; break-inside: avoid-page;
}
.ke-snapshot-print [data-ke-note][data-title]:not([data-title=""])::before {
  content: attr(data-title); display: block; font-weight: 600; margin-bottom: 0.25em;
}
.ke-snapshot-print [data-ke-attach], .ke-snapshot-print [data-ke-video] {
  margin: 0.6em 0; padding: 0.45em 0.8em; border: 1px dashed var(--border);
  border-radius: 6px; color: var(--muted); font-size: 0.92em;
}
.ke-snapshot-print [data-ke-attach]::before { content: "附件：" attr(data-title); }
.ke-snapshot-print [data-ke-video]::before { content: "视频：" attr(data-title); }
`

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 组装完整可打印 HTML（隐藏 renderer 注入用）。 */
export function buildSnapshotPrintDocument(options: SnapshotPrintDocumentOptions): string {
  const theme: PrintColorTheme = options.theme === 'dark' ? 'dark' : 'light'
  const title = escapeHtml(options.title ?? 'AstraNota snapshot')
  return (
    '<!doctype html><html lang="zh-CN"' +
    ` data-theme="${theme}"><head><meta charset="utf-8">` +
    `<title>${title}</title><style>${SNAPSHOT_PRINT_CSS}</style></head>` +
    `<body><main class="ke-snapshot-print">${options.bodyHtml}</main></body></html>`
  )
}
