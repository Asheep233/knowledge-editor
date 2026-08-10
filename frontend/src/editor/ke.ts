/**
 * KE 扩展节点公共工具。
 * 语法规范见 docs/markdown-extension-spec.md（v1.0）。
 */

export const KE_KINDS = ['note', 'module', 'attach', 'video', 'footnote'] as const
export type KeKind = (typeof KE_KINDS)[number]

/** 当前 KE Markdown 文档格式版本（写入 YAML frontmatter，随文档文件移动） */
export const KE_VERSION = 1

/** YAML frontmatter 中的版本键名 */
export const KE_FRONTMATTER_KEY = 'ke_version'

/**
 * 解析文档 frontmatter。返回剥离后的正文与版本号。
 * 版本信息只存储于 Markdown 文件本身（frontmatter），
 * 因此文档被移动/复制后版本仍然存在。
 */
export function stripFrontmatter(md: string): { version: number; content: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/.exec(md)
  if (!m) return { version: 0, content: md }
  const versionMatch = new RegExp(`^\\s*${KE_FRONTMATTER_KEY}\\s*:\\s*(\\d+)`, 'm').exec(m[1])
  return {
    version: versionMatch ? Number(versionMatch[1]) || 0 : 0,
    content: md.slice(m[0].length),
  }
}

/**
 * 给 Markdown 附加（或更新）frontmatter 版本头。
 * 幂等：正文若已带 frontmatter 会被先剥离再重写，不会叠加。
 */
export function withFrontmatter(md: string, version = KE_VERSION): string {
  const { content } = stripFrontmatter(md)
  return `---\n${KE_FRONTMATTER_KEY}: ${version}\n---\n\n${content}`
}

const KE_KIND_RE = KE_KINDS.join('|')

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 按扩展规范字段顺序输出 JSON（剔除空值），kind 恒为第一键 */
export function keJson(attrs: Record<string, unknown>, kind: KeKind, orderedKeys: string[]): string {
  const obj: Record<string, unknown> = { kind }
  for (const k of orderedKeys) {
    const v = attrs[k]
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'object' && Object.keys(v as object).length === 0) continue
    obj[k] = v
  }
  return JSON.stringify(obj)
}

/** 扩展规范各节点字段顺序（序列化时保证稳定输出） */
export const KE_FIELD_ORDER: Record<KeKind, string[]> = {
  // InfoBlock 通用信息块（Phase 3）：content 为内容字段；兼容旧文档 text。
  // label（Phase 7）：左上角徽章文字，默认空串（显示时兜底「信息」），可自定义。
  note: ['id', 'created', 'updated', 'author', 'label', 'title', 'color', 'content'],
  // source（Phase 5）：插入模块时记录来源 Modules/*.md；仅作来源标记，不参与同步
  module: ['id', 'name', 'version', 'mode', 'params', 'source'],
  attach: ['id', 'type', 'src', 'title', 'caption', 'width'],
  video: ['id', 'src', 'title', 'poster', 'controls', 'autoplay', 'loop'],
  footnote: ['id', 'n'],
}

/** 附件相对路径 -> 可访问 URL（决策点 4：workspace 相对路径）。
 * 实现已合并至 api/client.ts（P9，统一基址拼接与 URI 编码），本副本删除。 */

/** 从 `<!-- ke-xxx: {...} -->` 中解析出 kind 与属性；解析失败返回 null */
export function parseKeComment(text: string): { kind: KeKind; attrs: Record<string, unknown> } | null {
  const m = new RegExp(`^<!--\\s*(ke-(?:${KE_KIND_RE})):\\s*(\\{[\\s\\S]*?\\})\\s*-->$`).exec(text.trim())
  if (!m) return null
  try {
    const attrs = JSON.parse(m[2]) as Record<string, unknown>
    return { kind: m[1].replace('ke-', '') as KeKind, attrs }
  } catch {
    return null
  }
}

/** 生成单行 KE 注释 */
export function toKeComment(kind: KeKind, attrs: Record<string, unknown>): string {
  return `<!-- ke-${kind}: ${keJson(attrs, kind, KE_FIELD_ORDER[kind])} -->`
}
