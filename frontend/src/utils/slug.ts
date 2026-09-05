/**
 * 文件名 slug 生成（对齐后端 markdown_io.slugify）：
 * 保留 CJK；ASCII 转小写；连续空白/非法字符折叠为单个 '-'；
 * 去除尾部点/空格；超长截断。用于标题 → 文件名同步。
 */
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const SLUG_MAX = 80

export function slugify(name: string, fallback = 'untitled'): string {
  let s = name.normalize('NFKC').trim().toLowerCase()
  s = s.replace(/\.+$/, '').replace(/\s+$/, '')
  // Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）加前缀 _（与后端 _RESERVED 一致近似）
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = `_${s}`
  s = s.replace(BAD_CHARS, '-')
  s = s.replace(/\s+/g, '-')
  s = s.replace(/-{2,}/g, '-').replace(/^-+/, '').replace(/\.+$/, '')
  s = s.slice(0, SLUG_MAX).replace(/-+$/, '').replace(/\.+$/, '')
  return s || fallback
}
