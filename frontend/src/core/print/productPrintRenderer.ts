/**
 * T26 G3：产品打印渲染器（`PrintRenderer` 产品实现）。
 *
 * 数据流：可信快照 {relPath, revision, content} → 产品编辑器同源 schema 渲染 HTML body
 * → 自包含打印文档（内联打印 CSS + 当前主题）。
 *
 * 页数说明：Rust 侧 `print_snapshot_pdf`（WebView2 PrintToPdf）**不回传页数**，前端无法从
 * PDF 文件可靠反推（无 fs 读权限）→ 渲染器返回 `pages: null`，协议 `print.snapshot` 如实
 * 返回 `pages: null`，不伪造。
 */
import { renderMarkdownSnapshotBody, type PrintEditorProvider } from './printEditorBridge'
import type { PrintRenderer, PrintSnapshot, RenderedPrint } from './printJob'
import { buildSnapshotPrintDocument, type PrintColorTheme } from './snapshotPrintDocument'

export interface ProductPrintRendererOptions {
  /** 注入：快照 Markdown → HTML body（默认走注册的产品编辑器；测试可替换） */
  renderBody?: (snapshot: PrintSnapshot, signal: AbortSignal) => string | Promise<string>
  /** 当前主题（默认读主窗口 `documentElement.dataset.theme`；已由 applyTheme 解析 system） */
  theme?: () => PrintColorTheme
  /** 产品编辑器 provider（默认用 printEditorBridge 模块注册的实例；测试可替换） */
  editorProvider?: PrintEditorProvider | null
}

function currentProductTheme(): PrintColorTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function createProductPrintRenderer(options: ProductPrintRendererOptions = {}): PrintRenderer {
  const readTheme = options.theme ?? currentProductTheme
  return {
    async render(snapshot: PrintSnapshot, signal: AbortSignal): Promise<RenderedPrint> {
      if (signal.aborted) throw new Error('E_CANCELED: 打印已取消')
      if (!snapshot || typeof snapshot.content !== 'string' || snapshot.content.length === 0) {
        throw new Error('E_PRINT_SNAPSHOT: 快照正文缺失，拒绝打印（不伪造输出）')
      }
      const renderBody =
        options.renderBody ?? ((snap: PrintSnapshot) => renderMarkdownSnapshotBody(snap.content, options.editorProvider))
      const bodyHtml = await renderBody(snapshot, signal)
      if (signal.aborted) throw new Error('E_CANCELED: 打印已取消')
      if (typeof bodyHtml !== 'string' || bodyHtml.trim().length === 0) {
        throw new Error('E_PRINT_RENDERER: 快照渲染结果为空，拒绝打印')
      }
      const html = buildSnapshotPrintDocument({
        bodyHtml,
        title: `${snapshot.relPath} @ r${snapshot.revision}`,
        theme: readTheme(),
      })
      return { html, pages: null }
    },
  }
}
