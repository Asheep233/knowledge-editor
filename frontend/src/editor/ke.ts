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

/** UTF-8 BOM（U+FEFF）。文件级标记：解析前剥离，保存时按原文特征还原（见 DocTraits）。 */
const BOM = '\ufeff'

/**
 * 解析文档 frontmatter。返回剥离后的正文与版本号。
 * 版本信息只存储于 Markdown 文件本身（frontmatter），
 * 因此文档被移动/复制后版本仍然存在。
 *
 * F-4（2026-09-18）：**容忍 BOM**。此前正则锚定 `^---`，带 BOM 的文件 frontmatter
 * 整块被当正文（渲染成 `## ---`），保存时还会再套一层新 frontmatter。
 */
export function stripFrontmatter(md: string): { version: number; content: string } {
  const src = md.startsWith(BOM) ? md.slice(BOM.length) : md
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/.exec(src)
  if (!m) return { version: 0, content: src }
  const versionMatch = new RegExp(`^\\s*${KE_FRONTMATTER_KEY}\\s*:\\s*(\\d+)`, 'm').exec(m[1])
  return {
    version: versionMatch ? Number(versionMatch[1]) || 0 : 0,
    content: src.slice(m[0].length),
  }
}

/**
 * 取出原文的 frontmatter 区块（**含定界符与尾随空行**，逐字节保留），无则返回 null。
 *
 * 用途：导出时「源 frontmatter 其余键（title/tags/自定义键）不得被丢弃」——
 * 把该区块拼回正文前再走 `withFrontmatter`（它只更新 ke_version、保留其余键）。
 * 与 `stripFrontmatter` 一样容忍 BOM。
 */
export function frontmatterBlockOf(raw: string): string | null {
  const src = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)+/.exec(src)
  return m ? m[0] : null
}

/** 文档级文件特征（F-4/F-5）：BOM 与换行风格。加载时捕获，保存时还原。 */
export interface DocTraits {
  /** 原文是否以 UTF-8 BOM 开头 */
  bom: boolean
  /** 原文主导换行符（CRLF 多于 LF 时视为 CRLF） */
  eol: '\n' | '\r\n'
}

/** 从**原始文件内容**捕获文件级特征（不改变内容语义）。 */
export function captureDocTraits(raw: string): DocTraits {
  const bom = raw.startsWith(BOM)
  const body = bom ? raw.slice(BOM.length) : raw
  const crlf = (body.match(/\r\n/g) ?? []).length
  const lf = (body.match(/\n/g) ?? []).length - crlf
  return { bom, eol: crlf > lf ? '\r\n' : '\n' }
}

/**
 * 把文件级特征还原到待写入内容上（F-4/F-5）。
 * 只做「换行风格 + BOM」两件事，**不改动任何其它字节**；幂等。
 */
export function applyDocTraits(md: string, traits: DocTraits): string {
  let out = traits.eol === '\r\n' ? md.replace(/\r?\n/g, '\r\n') : md.replace(/\r\n/g, '\n')
  if (traits.bom) out = out.startsWith(BOM) ? out : BOM + out
  else if (out.startsWith(BOM)) out = out.slice(BOM.length)
  return out
}

/**
 * 给 Markdown 附加（或更新）frontmatter 版本头。
 * 幂等：正文若已带 frontmatter 会把 ke_version 更新为目标值，且**保留其余全部键值**
 * （title/tags/自定义键不会被清空）。
 *
 * 实现为合并语义：若输入不含 frontmatter，生成新的 `--- ke_version ---` 头；
 * 若输入已带 frontmatter，仅替换/新增 `ke_version` 键，其余字段逐字节保留。
 */
export function withFrontmatter(md: string, version = KE_VERSION): string {
  // P3-16：脚注上标后为光标锚点注入的零宽空格 U+200B 不写入文件
  // （仅编辑时用于 caret 锚定，保存/导出时剥除，避免文件里残留隐形字符）。
  md = md.replace(/\u200b/g, '')
  // F-4：容忍 BOM —— 先剥离再匹配，避免把已有 frontmatter 当成正文再套一层；
  // BOM 的还原由 savePath 的 applyDocTraits(captureDocTraits(raw)) 负责。
  if (md.startsWith(BOM)) md = md.slice(BOM.length)
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/.exec(md)
  if (!fm) {
    // 无 frontmatter：生成新版本头（原样追加正文）
    return `---\n${KE_FRONTMATTER_KEY}: ${version}\n---\n\n${md}`
  }
  // 已有 frontmatter：保留全部字段，仅更新/新增 ke_version 键。
  const body = fm[1]
  const versionRe = new RegExp(`^\\s*${KE_FRONTMATTER_KEY}\\s*:\\s*\\d+\\s*$`, 'm')
  const newBody = versionRe.test(body)
    ? body.replace(versionRe, `${KE_FRONTMATTER_KEY}: ${version}`)
    : `${KE_FRONTMATTER_KEY}: ${version}\n${body}`
  return `---\n${newBody}\n---\n\n${md.slice(fm[0].length)}`
}

const KE_KIND_RE = KE_KINDS.join('|')

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 剔除空值后的字段是否应输出（空字符串 / null / undefined / 空对象不输出）。 */
function shouldEmit(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false
  if (typeof v === 'object' && Object.keys(v as object).length === 0) return false
  return true
}

/** 按扩展规范字段顺序输出 JSON（剔除空值），kind 恒为第一键。
 * P3-5：除规范字段外，attrs 中不在 orderedKeys 里的其他自有字段（自定义键）
 * 按原顺序追加在末尾（不含 kind 本身），严格遵守 spec「自定义字段保留」承诺。 */
export function keJson(attrs: Record<string, unknown>, kind: KeKind, orderedKeys: string[]): string {
  const obj: Record<string, unknown> = { kind }
  for (const k of orderedKeys) {
    if (k === 'kind') continue
    const v = attrs[k]
    if (!shouldEmit(v)) continue
    obj[k] = v
  }
  // P3-5：追加不在 orderedKeys 中的其他自有字段（跳过 kind 与已输出字段），保留原顺序
  for (const k of Object.keys(attrs)) {
    if (k === 'kind') continue
    if (Object.prototype.hasOwnProperty.call(obj, k)) continue
    const v = attrs[k]
    if (!shouldEmit(v)) continue
    obj[k] = v
  }
  return JSON.stringify(obj)
}

/** 确定性 id：对关键字段做稳定 hash，取前 12 位 hex（P4-1）。
 * 同一内容多次序列化生成的 id 一致；不要求回写 DOM。
 * 仅依赖 charCodeAt + Math.imul，跨环境结果稳定。 */
export function keStableId(attrs: Record<string, unknown>, keys: string[]): string {
  const seed = keys.map((k) => `${k}=${JSON.stringify(attrs?.[k] ?? null)}`).join('|')
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
  }
  const hex = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
  return `ke-${hex.slice(0, 12)}`
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
