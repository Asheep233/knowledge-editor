/**
 * task-41（v1.2.0-pre.2）：视图态 + 源码模式「字符串直存」纯逻辑。
 *
 * 规范：`docs/document-format.md` §6「编辑通道与视图」；实施契约：`docs/design-1.2.0-source-mode.md`。
 *
 * 本模块只做四件事（全部纯函数 / 可注入存储，便于单测）：
 *  ① 视图态：全局单值 `'wysiwyg' | 'source'`（键 `ke.viewMode`，**不写入文档**、不按文档记忆）+
 *     订阅（供 `useSyncExternalStore`）；
 *  ② 源码通道的正文取值：`stripFrontmatter(raw).content`（逐字节原样，不做任何规范化）；
 *  ③ **字符串直存**载荷：原 frontmatter 区块（逐字节） + 用户编辑后的正文 → `withFrontmatter`
 *     只更新 `ke_version` → `applyDocTraits` 还原 BOM/换行 —— **绝不经过 ProseMirror**；
 *  ④ 未知/损坏 `ke-*` 标记扫描与 diff（保存前提示的依据，规范 §6.2-4）。
 *
 * 只读复用 `editor/ke.ts` 的工具（`ke.ts` 属 task-39 写入边界，本任务**不得修改**）。
 */
import {
  applyDocTraits,
  captureDocTraits,
  frontmatterBlockOf,
  KE_VERSION,
  parseKeComment,
  stripFrontmatter,
  withFrontmatter,
} from '../editor/ke'

export type ViewMode = 'wysiwyg' | 'source'

/** 视图态存储键（全局偏好；不写入文档、不按文档记忆） */
export const VIEW_MODE_STORAGE_KEY = 'ke.viewMode'

/** 可注入的存储面（测试替身） */
export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function safeStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** 非法/缺失一律回退 `wysiwyg`（默认视图，行为与既有版本一致） */
export function normalizeViewMode(raw: unknown): ViewMode {
  return raw === 'source' ? 'source' : 'wysiwyg'
}

export function readViewMode(storage: StorageLike | null = safeStorage()): ViewMode {
  if (!storage) return 'wysiwyg'
  try {
    return normalizeViewMode(storage.getItem(VIEW_MODE_STORAGE_KEY))
  } catch {
    return 'wysiwyg'
  }
}

export function writeViewMode(mode: ViewMode, storage: StorageLike | null = safeStorage()): void {
  if (!storage) return
  try {
    storage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    /* 存储不可用（隐私模式等）时忽略：内存态仍生效 */
  }
}

// ---------------------------------------------------------------------------
// ① 全局单值 + 订阅
// ---------------------------------------------------------------------------

let currentMode: ViewMode = readViewMode()
const listeners = new Set<() => void>()

export function getViewMode(): ViewMode {
  return currentMode
}

/** 设置视图态（写存储 + 通知订阅者）；同值时 no-op（不触发重渲染）。 */
export function setViewMode(mode: ViewMode): void {
  const next = normalizeViewMode(mode)
  if (next === currentMode) return
  currentMode = next
  writeViewMode(next)
  listeners.forEach((fn) => fn())
}

export function subscribeViewMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 仅测试用：重置为指定态（默认按存储重读），避免用例间串味 */
export function __resetViewModeForTest(mode?: ViewMode): void {
  currentMode = mode ?? readViewMode()
  listeners.clear()
}

/** 只读/版本预览态不提供源码编辑（规范 §6.2-8） */
export function canEnterSourceMode(opts: { hasArticle: boolean; readOnly: boolean }): boolean {
  return opts.hasArticle && !opts.readOnly
}

// ---------------------------------------------------------------------------
// ② 源码通道正文（逐字节原样）
// ---------------------------------------------------------------------------

/** 源码视图/textarea 的内容：frontmatter 之后的正文字节（不含 frontmatter） */
export function sourceBodyOf(raw: string): string {
  return stripFrontmatter(raw).content
}

// ---------------------------------------------------------------------------
// ③ 字符串直存载荷 / 恢复点草稿
// ---------------------------------------------------------------------------

/**
 * 字符串直存载荷（写入文档的最终字节）：
 *   `原 frontmatter 区块（逐字节） + 用户编辑后的正文` → `withFrontmatter`（仅更新 `ke_version`，
 *   其余键值逐字节保留）→ `applyDocTraits(baseRaw 的 BOM/换行)`。
 *
 * ⚠️ 绝不 parse/serialize（不经过 ProseMirror）：`- [x]` / `<span style=…>` / `&copy;` /
 * 未知 ke-* 等方言语法全部按用户原文逐字节落盘（规范 §6.2-1）。
 */
export function buildSourceSavePayload(baseRaw: string, editedBody: string): string {
  const fmBlock = frontmatterBlockOf(baseRaw)
  // §6.2.1：源码通道**不得**剥除用户真写的 U+200B（光标锚点是正文通道的产物）
  const md = withFrontmatter(`${fmBlock ?? ''}${editedBody}`, KE_VERSION, { stripCaretArtifacts: false })
  return applyDocTraits(md, captureDocTraits(baseRaw))
}

/**
 * 恢复点草稿（内部数据，**恒 LF、无 BOM**，与正文通道同口径）：
 * 正文通道的草稿是编辑器序列化结果（LF/无 BOM）；源码通道同此口径，便于恢复时按既有链路载入。
 * U+200B 同样不剥除（内容取自用户原文，剥除属静默删字节）。
 */
export function buildSourceDraft(baseRaw: string, editedBody: string): string {
  const fmBlock = frontmatterBlockOf(baseRaw)
  const md = withFrontmatter(`${fmBlock ?? ''}${editedBody}`, KE_VERSION, { stripCaretArtifacts: false })
  return applyDocTraits(md, { bom: false, eol: '\n' })
}

// ---------------------------------------------------------------------------
// ④ 未知/损坏 ke-* 标记扫描（保存提示依据）
// ---------------------------------------------------------------------------

export interface KeMarkerScan {
  /** 可被既有解析器识别（且 JSON 合法）的 ke-* 注释数量 */
  known: number
  /** 未知/损坏片段（无法被 `parseKeComment` 识别，或未闭合的 ke- 注释开头） */
  unknown: string[]
}

const CLOSED_COMMENT_RE = /<!--[\s\S]*?-->/g

/**
 * 扫描源码里「会被 ProseMirror 规范化」的风险标记：
 *  - 闭合注释里的 `ke-*`：能被 `parseKeComment` 识别 → known；否则（未知 kind / JSON 损坏）→ unknown；
 *  - 未闭合的 `<!-- ke-…` 开头（语法已损坏）→ unknown。
 * 说明：不做「裸 ke- 词法」全量扫描——`keStableId` 生成的 `ke-<hex>` 会出现在合法 JSON 值里，
 * 全量扫会误报。
 */
export function scanKeMarkers(source: string): KeMarkerScan {
  let known = 0
  const unknown: string[] = []
  for (const m of source.matchAll(CLOSED_COMMENT_RE)) {
    const text = m[0]
    if (!/ke-/.test(text)) continue
    if (parseKeComment(text)) known++
    else unknown.push(text)
  }
  // 未闭合的 ke- 注释开头（长度保持替换，避免误伤已闭合注释内部）
  const masked = source.replace(CLOSED_COMMENT_RE, (s) => ' '.repeat(s.length))
  for (const m of masked.matchAll(/<!--\s*ke-[^\n]*/g)) {
    const frag = m[0].trim()
    if (frag) unknown.push(frag)
  }
  return { known, unknown }
}

/**
 * 未知/损坏标记是否**相对初值被改动**（新增/删除/改写任一片段即视为改动）。
 * 规范 §6.2-4：用户可改写，但保存时必须提示，不得静默覆盖。
 */
export function unknownMarkersChanged(before: string, after: string): boolean {
  const a = scanKeMarkers(before).unknown
  const b = scanKeMarkers(after).unknown
  if (a.length !== b.length) return true
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.some((v, i) => v !== sb[i])
}

/** 文档里是否存在未知/损坏标记（决定「切回正文可能被规范化」是否提示） */
export function hasUnknownKeMarkers(source: string): boolean {
  return scanKeMarkers(source).unknown.length > 0
}
