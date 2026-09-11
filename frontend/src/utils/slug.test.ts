/**
 * slugify 契约测试（K3-V3）：与后端 markdown_io.slugify 行为一致。
 * 覆盖：大小写/空白/非法字符折叠、尾部点空、超长截断、CJK 保留、
 * Windows 保留名（含带扩展名形式 con.txt → _con.txt）。
 */
import { describe, expect, it } from 'vitest'
import { slugify, filenameFromTitle } from './slug'

describe('slugify（与后端契约一致）', () => {
  it('ASCII 转小写、空白/非法字符折叠为单个 -', () => {
    expect(slugify('Hello World')).toBe('hello-world')
    expect(slugify('a/b\\c:d')).toBe('a-b-c-d')
    expect(slugify('  A   B  ')).toBe('a-b')
  })

  it('保留 CJK 字符', () => {
    expect(slugify('测试文档')).toBe('测试文档')
    expect(slugify('我的 笔记')).toBe('我的-笔记')
  })

  it('去除尾部点与空格（Windows 语义）', () => {
    expect(slugify('abc.')).toBe('abc')
    expect(slugify('abc...')).toBe('abc')
    expect(slugify('abc ')).toBe('abc')
  })

  it('连续空白折叠 + 首尾修剪（下划线保留，与后端一致）', () => {
    expect(slugify('a--b  c')).toBe('a-b-c')
    expect(slugify('a-b___c')).toBe('a-b___c')
    expect(slugify('-a-')).toBe('a')
  })

  it('超长截断（80）且尾部无 -/.', () => {
    const long = 'a'.repeat(100)
    const out = slugify(long)
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out).not.toMatch(/[-.]$/)
  })

  it('Windows 保留名加前缀 _', () => {
    expect(slugify('con')).toBe('_con')
    expect(slugify('PRN')).toBe('_prn')
    expect(slugify('nul.md')).toBe('_nul.md')
    expect(slugify('com1.txt')).toBe('_com1.txt')
    expect(slugify('lpt9')).toBe('_lpt9')
  })

  it('非保留名不加前缀', () => {
    expect(slugify('console')).toBe('console')
    expect(slugify('com')).toBe('com')
    expect(slugify('nulL')).toBe('null')
  })

  it('F18：前导点/混合前导剥离（.note 不再产出隐藏文件，与后端 strip("-.") 对齐）', () => {
    expect(slugify('.note')).toBe('note')
    expect(slugify('..hidden')).toBe('hidden')
    expect(slugify('-.draft')).toBe('draft')
    expect(slugify('.名称.')).toBe('名称')
  })

  it('空串回退 fallback（非保留字符如 ! 保留，与后端一致）', () => {
    expect(slugify('')).toBe('untitled')
    expect(slugify('   ')).toBe('untitled')
    expect(slugify('', 'doc')).toBe('doc')
  })
})

describe('filenameFromTitle（v1.1.8：保留原标题）', () => {
  it('保留大小写/空格/中文', () => {
    expect(filenameFromTitle('Linear Algebra 笔记')).toBe('Linear Algebra 笔记')
    expect(filenameFromTitle('A01验证文档')).toBe('A01验证文档')
    expect(filenameFromTitle('带 空格 的标题')).toBe('带 空格 的标题')
  })
  it('仅替换文件系统非法字符并折叠空白', () => {
    expect(filenameFromTitle('a/b:c*d?')).toBe('a b c d')
    expect(filenameFromTitle('多   空格')).toBe('多 空格')
  })
  it('Windows 语义与保留名', () => {
    expect(filenameFromTitle('尾部点.  ')).toBe('尾部点')
    expect(filenameFromTitle('...隐藏')).toBe('隐藏')
    expect(filenameFromTitle('CON')).toBe('_CON')
    expect(filenameFromTitle('')).toBe('untitled')
  })
  it('超长截断至 80 字符', () => {
    expect(filenameFromTitle('x'.repeat(100)).length).toBe(80)
  })
})
