import { filenameFromTitle } from '../utils/slug'
/**
 * 导入导出公共工具（Phase 3E）。
 *
 * 约定（与后端 /api/export/package、/api/import/package 对齐）：
 * - 导出的 Markdown 由编辑器 Markdown Serializer 序列化（含 ke_version frontmatter）；
 * - 附件引用为 workspace 相对路径（Attachments/...），包内保持同结构，无需改写；
 * - 网络 URL 与本地绝对路径保持原样，不参与附件收集（Phase 4 范围）。
 */

/**
 * 屏蔽 Markdown 中的代码片段（围栏代码块与行内代码），
 * 使 `![...](Attachments/..)` 这类路径出现在代码里时不会被误判为真实附件引用（P3-14）。
 * 只做字符串级屏蔽（用占位替换），不改动真实引用位置。
 */
function maskCodeRegions(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' ')) // 围栏代码块 → 保留空行，屏蔽内容
    .replace(/`[^`\n]+`/g, ' ') // 行内代码 → 屏蔽
}

/** 从序列化 Markdown 中提取 workspace 附件相对路径（供文档包导出收集附件）。 */
export function extractAttachmentRefs(md: string): string[] {
  const refs = new Set<string>()
  // 先屏蔽代码区域，避免把代码中的 `![...](...)` 误判为附件引用（P3-14）
  md = maskCodeRegions(md)
  const add = (src: string | undefined) => {
    if (!src) return
    let s = src.trim()
    if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim()
    // URI 编码目标（%20 等）→ 解码为真实磁盘路径（与后端 normalize_attachment_ref 同口径）
    try {
      s = decodeURIComponent(s)
    } catch {
      /* 非法 % 序列按原文处理 */
    }
    if (s.startsWith('./')) s = s.slice(2)
    // 仅收集 workspace 附件：Attachments/ 开头且非网络协议
    if (!s.startsWith('Attachments/')) return
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return
    refs.add(s)
  }
  // ① ke-attach/video 头标记（JSON 用括号平衡匹配；F07：title/caption 含 `}` 不截断）
  // ② Markdown 链接/图片目标（支持角括号/平衡括号/编码/尾随 title；FE-05）
  // 两路候选按**文档位置**排序后统一去重，保持原有「按出现顺序」契约。
  const keRe = /<!--\s*ke-(?:attach|video):\s*/g
  const candidates: Array<{ pos: number; src: string | undefined }> = []
  let m: RegExpExecArray | null
  while ((m = keRe.exec(md))) {
    const bodyStart = m.index + m[0].length
    if (md[bodyStart] !== '{') continue
    const parsed = scanBalancedJson(md, bodyStart)
    if (parsed === null) continue
    const jsonEnd = bodyStart + parsed.length
    const close = /^\s*-->/.exec(md.slice(jsonEnd))
    if (!close) continue
    keRe.lastIndex = jsonEnd + close[0].length
    try {
      candidates.push({ pos: m.index, src: (JSON.parse(parsed) as { src?: string }).src })
    } catch {
      /* 非法 JSON 忽略，由 GenericFallback 原样保留 */
    }
  }
  for (const t of scanMdLinkTargets(md)) candidates.push({ pos: t.pos, src: t.src })
  candidates.sort((a, b) => a.pos - b.pos)
  for (const c of candidates) add(c.src)
  return [...refs]
}

/**
 * 扫描 Markdown 链接/图片目标（`[..](target)` / `![..](target)`），返回
 * `{ src, pos }`（pos 用于恢复文档顺序）。
 *
 * 支持：角括号 `<…>`（允许空格/圆括号）、裸目标（含**平衡圆括号**，如
 * `pic(1).png`）、可选尾随 title；不跨行。与后端
 * `markdown_io.md_link_target_spans` 同口径（导出收集与导入改写一致）。
 */
function scanMdLinkTargets(md: string): Array<{ src: string; pos: number }> {
  const out: Array<{ src: string; pos: number }> = []
  const labelRe = /\]\(/g
  let m: RegExpExecArray | null
  while ((m = labelRe.exec(md))) {
    let p = m.index + m[0].length
    while (p < md.length && (md[p] === ' ' || md[p] === '\t')) p += 1
    if (p >= md.length) continue
    if (md[p] === '<') {
      const q = md.indexOf('>', p + 1)
      if (q < 0) continue
      const target = md.slice(p + 1, q).trim()
      const rest = md.slice(q + 1)
      if (!/^\s*(?:"[^"]*"|'[^']*')?\s*\)/.test(rest)) continue
      if (target) out.push({ src: target, pos: m.index })
      labelRe.lastIndex = q + 1
      continue
    }
    let depth = 0
    let i = p
    let close = -1
    while (i < md.length) {
      const ch = md[i]
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '\n') break
      if (ch === '(') depth += 1
      else if (ch === ')') {
        if (depth === 0) {
          close = i
          break
        }
        depth -= 1
      }
      i += 1
    }
    if (close < 0) continue
    const segment = md.slice(p, close)
    const raw = segment.trim()
    if (raw) {
      // 尾随 title（"…" / '…' / (…)）不属于目标
      const stripped = raw.replace(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/, '').trim()
      if (stripped) out.push({ src: stripped, pos: m.index })
    }
    labelRe.lastIndex = close + 1
  }
  return out
}

/** 从 src[start]（须为 '{'）做括号平衡匹配，返回完整 JSON 字符串（F07）。 */
function scanBalancedJson(src: string, start: number): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 下载文件名（v1.1.8）：与磁盘命名策略一致——保留原标题大小写/空格/中文，
 * 仅替换文件系统非法字符（委托 filenameFromTitle，避免两套命名规则分叉）。
 */
export function slugForDownload(title: string): string {
  return filenameFromTitle(title)
}

/** 触发浏览器下载。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** File System Access API 的另存为句柄最小类型（仅用到的成员）。 */
interface SaveFilePickerHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
}
type SaveFilePickerFn = (options: { suggestedName?: string }) => Promise<SaveFilePickerHandle>

/**
 * 导出保存（共享路径，v1.0.2 修复"点击无反应"体验问题）。
 *
 * 背景：Tauri WebView2 下 `a[download] + blob:` 为**静默下载**——无"另存为"弹窗、
 * 无完成提示；且同一会话第二次起的程序化下载会被 WebView2 多下载策略静默丢弃
 * （实测：第 1 次导出落盘成功，第 2/3 次 downloadBlob 被调用但无文件落地），
 * 用户体感"点击无反应"。
 *
 * 方案：支持 File System Access API 的环境（Tauri WebView2 / Chromium 系）优先走
 * `showSaveFilePicker`——OS 原生「另存为」弹窗，每次点击都有明确交互与反馈，
 * 不存在多下载拦截，用户可精确选择路径；用户取消（AbortError）时静默返回；
 * 其它异常或环境不支持时回退 downloadBlob（浏览器静默下载）。
 */
export async function saveOrDownload(blob: Blob, filename: string): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn }).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      const handle = await picker({ suggestedName: filename })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (e) {
      // 用户取消：无动作（视为已完成交互）；其它错误回退静默下载兜底
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  downloadBlob(blob, filename)
}

/** 从 Content-Disposition 解析文件名（支持 RFC 5987 filename*）。 */
export function filenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      /* 解码失败回退 */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1] : fallback
}
