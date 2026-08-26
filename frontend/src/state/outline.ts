/**
 * Markdown 标题大纲提取（P4-13：右侧 Tab「大纲」是占位符）。
 *
 * 右侧面板的「大纲」Tab 实现一个轻量标题大纲：解析 article.content 的 # / ## / ### 行，
 * 列出可点击条目（点击后尝试定位/提示）。本模块把解析抽成纯函数 `extractOutline`。
 */

export interface OutlineItem {
  /** 标题级别：1 = #，2 = ##，3 = ### */
  level: number
  text: string
  /** 该标题在 Markdown 中的字符偏移（供跳转落点）/ 行号替代 */
  offset: number
}

/** 解析 Markdown，返回最多 maxLevel 级的标题大纲（跳过 YAML frontmatter）。 */
export function extractOutline(md: string, maxLevel = 3): OutlineItem[] {
  const items: OutlineItem[] = []
  const re = new RegExp(`^(#{1,${maxLevel}})\\s+(.+?)\\s*$`)
  let cursor = 0
  let inFm = false
  let frontmatterHandled = false

  for (const raw of md.split('\n')) {
    const lineStart = cursor
    const trimmed = raw.trim()

    // YAML frontmatter：仅在文档起始（offset 0）识别开头的 `---`，遇闭合 `---` 退出。
    if (!frontmatterHandled && lineStart === 0 && trimmed.startsWith('---')) {
      inFm = true
    } else if (inFm && trimmed === '---') {
      inFm = false
      frontmatterHandled = true
    }

    if (!inFm) {
      const m = re.exec(trimmed)
      if (m) {
        items.push({ level: m[1].length, text: m[2].trim(), offset: lineStart })
      }
    }
    cursor += raw.length + 1
  }
  return items
}
