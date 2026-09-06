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
