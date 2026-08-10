/**
 * 导入导出公共工具（Phase 3E）。
 *
 * 约定（与后端 /api/export/package、/api/import/package 对齐）：
 * - 导出的 Markdown 由编辑器 Markdown Serializer 序列化（含 ke_version frontmatter）；
 * - 附件引用为 workspace 相对路径（Attachments/...），包内保持同结构，无需改写；
 * - 网络 URL 与本地绝对路径保持原样，不参与附件收集（Phase 4 范围）。
 */

/** 从序列化 Markdown 中提取 workspace 附件相对路径（供文档包导出收集附件）。 */
export function extractAttachmentRefs(md: string): string[] {
  const refs = new Set<string>()
  const add = (src: string | undefined) => {
    if (!src) return
    let s = src.trim()
    if (s.startsWith('./')) s = s.slice(2)
    // 仅收集 workspace 附件：Attachments/ 开头且非网络协议
    if (!s.startsWith('Attachments/')) return
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return
    refs.add(s)
  }
  // 按出现顺序一次扫描：ke-attach / ke-video JSON 节点 + 标准图片 ![alt](src "title")
  const re =
    /<!--\s*ke-(?:attach|video):\s*(\{[\s\S]*?\})\s*-->|!\[[^\]]*\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md))) {
    if (m[1] !== undefined) {
      try {
        add((JSON.parse(m[1]) as { src?: string }).src)
      } catch {
        /* 非法 JSON 忽略，由 GenericFallback 原样保留 */
      }
    } else {
      add(m[2])
    }
  }
  return [...refs]
}

/** 与后端 slugify 对齐的简化下载文件名（保留 CJK，非法字符折叠为 '-'）。 */
export function slugForDownload(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'untitled'
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
