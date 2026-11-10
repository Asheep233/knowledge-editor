/**
 * 2026-11-10 用户实测「重开页面后空行变成 &nbsp;」的根因修复。
 *
 * 上游 `@tiptap/extension-paragraph`：
 *  - `renderMarkdown`：连续空段落中**第 2 个起**输出 `&nbsp;`（保留空行，避免 Markdown 折叠）；
 *  - `parseMarkdown`：只有 `tokens[0].type === 'text'` 且 raw/text 恰为 `&nbsp;`/NBSP 时，
 *    才把它还原成空段落。
 * 本仓库的实体保真 tokenizer（`htmlPassthroughInlineTokenizer`，F3-8）会把 `&nbsp;`
 * 先一步认领成 `html_passthrough_inline` 原子 → 上游的段落特判永远不命中 →
 * **空行被当成字面 HTML 实体芯片 `&nbsp;` 显示**；保存后又原样写回，形成稳定污染。
 *
 * 修复：继承 Paragraph，`parseMarkdown` 先把「单 token 且为 &nbsp;/NBSP/&#160; 的段落」
 * 还原成空段落，再交回上游。混合行里的实体（如 `&copy; &nbsp;`）token 数 >1，
 * 仍保持原字节（F3-8 严格往返不回归）。
 */
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { Paragraph } from '@tiptap/extension-paragraph'

const EMPTY_MARKERS = new Set(['&nbsp;', '\u00A0', '&#160;', '&#xa0;', '&#xA0;'])

function isBlankMarker(value: unknown): boolean {
  return typeof value === 'string' && EMPTY_MARKERS.has(value.trim())
}

interface ParagraphParseContext {
  createNode: (type: string, attrs: Record<string, unknown> | undefined, content: JSONContent[]) => JSONContent
}

type UpstreamParseMarkdown = (token: MarkdownToken, helpers: ParagraphParseContext) => JSONContent | JSONContent[]

const upstreamParseMarkdown = (
  Paragraph as unknown as { config?: { parseMarkdown?: UpstreamParseMarkdown } }
).config?.parseMarkdown

export const KeParagraph = Paragraph.extend({
  parseMarkdown(token: MarkdownToken, helpers: ParagraphParseContext) {
    const tokens = (token as { tokens?: MarkdownToken[] }).tokens
    if (Array.isArray(tokens) && tokens.length === 1) {
      const only = tokens[0] as { type?: string; raw?: unknown; text?: unknown }
      const entityLike =
        only.type === 'html_passthrough_inline' || only.type === 'html' || only.type === 'text'
      if (entityLike && (isBlankMarker(only.raw) || isBlankMarker(only.text))) {
        return helpers.createNode('paragraph', undefined, [])
      }
    }
    if (upstreamParseMarkdown) return upstreamParseMarkdown(token, helpers)
    return helpers.createNode('paragraph', undefined, [])
  },
})
