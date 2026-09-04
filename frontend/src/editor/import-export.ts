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
