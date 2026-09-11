/**
 * 文件名 slug 生成（对齐后端 markdown_io.slugify，K3-V3 契约一致）：
 * - 保留 CJK；ASCII 转小写；连续空白/非法字符折叠为单个 '-'；
 * - 去除尾部点/空格；超长截断（80，与后端 _SLUG_MAX 一致）；
 * - Windows 保留名检测在【最终结果】上执行 `split(".",1)[0]`，
 *   含带扩展名形式（如 `con.txt` → `_con.txt`），与后端行为完全一致。
 */
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const SLUG_MAX = 80

export function slugify(name: string, fallback = 'untitled'): string {
  let s = name.normalize('NFKC').trim().toLowerCase()
  // 与后端一致：反复去除尾部点与空格（Python str.rstrip(".") 语义）
  s = s.replace(/[.\s]+$/, '')
  s = s.replace(BAD_CHARS, '-')
  s = s.replace(/\s+/g, '-')
  // F18：与后端 strip("-.") 对齐——去除首尾的 '-' 与 '.'（原实现只剥首 '-'）
  // 否则 `.note` 标题产出隐藏文件（前后端契约不一致）
  s = s.replace(/-{2,}/g, '-').replace(/^[-.]+/, '').replace(/[-.]+$/, '')
  const head = s.slice(0, SLUG_MAX)
  s = (head.replace(/-+$/, '').replace(/\.+$/, '') || head).slice(0, SLUG_MAX)
  if (!s) return fallback
  // Windows 保留名（含带扩展名形式，如 NUL.md）：前缀下划线，使其不再是保留名
  if (RESERVED.test(s.split('.', 1)[0])) s = `_${s}`
  return s
}


/**
 * 标题 → 文件名（v1.1.8 起默认策略）：**保留原标题的大小写、空格与中文**，
 * 仅处理文件系统非法部分。与后端 `markdown_io.sanitize_filename` 契约一致（K3-V3 对齐）：
 * - Windows 非法字符 `< > : " / \ | ? *` 与控制字符 → 空格，随后折叠连续空白；
 * - 去首尾空白；去首部点（隐藏文件）；去尾部点与空格（Windows 语义）；
 * - 超长按字符截断（80）；Windows 保留名前缀 `_`；空标题回退 fallback。
 */
export function filenameFromTitle(name: string, fallback = 'untitled'): string {
  const raw = (name ?? '').normalize('NFC').trim()
  let s = raw
    .replace(BAD_CHARS, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/^\.+/, '').trim().replace(/[.\s]+$/, '')
  if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/[.\s]+$/, '')
  if (!s) return fallback
  if (RESERVED.test(s.split('.', 1)[0])) s = `_${s}`
  return s
}
