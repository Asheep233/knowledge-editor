/**
 * T26 G3：产品打印渲染器 —— 把「可信快照的 Markdown 正文」渲染为可打印 HTML。
 *
 * 关键约束（T16 打印红线）：
 * - **只消费快照内容**（后端按 relPath 读出的原文 + revision），不读取当前编辑 DOM、
 *   不读取编辑器当前文档、不隐式保存；
 * - 复用产品编辑器**同一套扩展/schema/解析器**（`editor.storage.markdown.manager` +
 *   `editor.extensionManager.extensions` + `generateHTML`）→ MD→PM JSON→HTML 与产品渲染同源，
 *   避免在打印模块里复制一份扩展清单导致漂移；
 * - 编辑器实例仅作为「解析/序列化器」注入（`setPrintEditorProvider`），打印内容与它当前载着
 *   哪篇文档无关；
 * - 公式等 React NodeView 的视觉结果不在 getHTML/generateHTML 内（与对话框预览同一已知限制），
 *   打印 HTML 中公式为 `data-ke-math*` 的线性 LaTeX 文本（证据文档如实记录）。
 */
import { generateHTML, type AnyExtension, type JSONContent } from '@tiptap/core'
import type { MarkdownExtensionStorage } from '@tiptap/markdown'

import { normalizeGfmFootnotes } from '../../editor/gfm-footnote'
import { stripFrontmatter } from '../../editor/ke'

/** 产品编辑器实例的最小结构（@tiptap/core Editor 可结构赋值；便于单测注入替身）。 */
export interface KePrintEditorLike {
  extensionManager: { extensions: AnyExtension[] }
  storage: { markdown?: MarkdownExtensionStorage }
}

export type PrintEditorProvider = () => KePrintEditorLike | null

let provider: PrintEditorProvider | null = null

/** 产品壳在 EditorArea 挂载时注册（返回 ref 中的最新 editor）；卸载时置 null。 */
export function setPrintEditorProvider(next: PrintEditorProvider | null): void {
  provider = next
}

export function getPrintEditorProvider(): PrintEditorProvider | null {
  return provider
}

/** 测试用：清空注册（避免用例间串扰）。 */
export function resetPrintEditorProviderForTests(): void {
  provider = null
}

/**
 * 把快照 Markdown 渲染为 HTML body 片段（不含 `<html>` 外壳）。
 *
 * - 去除磁盘原样可能带的 BOM / frontmatter（打印正文不含元信息，与编辑器打开口径一致）；
 * - CRLF/CR 归一为 LF（编辑器内部一律 LF）；
 * - GFM 脚注先规范化（与产品 markdown 解析入口同口径）。
 */
export function renderMarkdownSnapshotBody(
  markdown: string,
  providerOverride?: PrintEditorProvider | null,
): string {
  const resolve = providerOverride ?? provider
  const editor = resolve?.() ?? null
  if (!editor) {
    throw new Error('E_PRINT_RENDERER: 产品编辑器渲染器未就绪（EditorArea 未挂载）')
  }
  const manager = editor.storage?.markdown?.manager
  if (!manager || typeof manager.parse !== 'function') {
    throw new Error('E_PRINT_RENDERER: 编辑器缺少 Markdown 管理器（Markdown 扩展未启用）')
  }
  const extensions = editor.extensionManager?.extensions
  if (!Array.isArray(extensions) || extensions.length === 0) {
    throw new Error('E_PRINT_RENDERER: 编辑器缺少扩展/schema，无法序列化快照')
  }
  if (typeof markdown !== 'string') throw new Error('E_PRINT_SNAPSHOT: 快照正文缺失')
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const body = stripFrontmatter(normalized).content
  let json: JSONContent
  try {
    json = manager.parse(normalizeGfmFootnotes(body))
  } catch (e) {
    throw new Error(`E_PRINT_RENDERER: 快照 Markdown 解析失败（${String((e as Error)?.message ?? e)}）`)
  }
  try {
    return generateHTML(json, extensions)
  } catch (e) {
    throw new Error(`E_PRINT_RENDERER: 快照 HTML 序列化失败（${String((e as Error)?.message ?? e)}）`)
  }
}
