/**
 * R1-table（2026-11-02 性能优化）：表格 tokenizer **早期拒绝**回归。
 *
 * 优化内容：block tokenizer 收到的 `src` 是从当前块到文末的剩余全文；修复前第一步
 * `src.split('\n')` 切整条长尾，大文档下每块都做一次 → 20MiB CPU profile 中该函数 self 107.6s。
 * 修复后只读头两行判断「表头+分隔行」候选，不匹配直接 return。
 *
 * 本文件锁定：早期拒绝不得改变任何表格/非表格的判定语义。
 */
import { describe, expect, it } from 'vitest'
import { tableTokenizer } from './tokenizers'

const tokenize = (s: string) => tableTokenizer.tokenize(s)

describe('tableTokenizer 早期拒绝 · 判定语义', () => {
  it('合法表格仍被识别（首尾管道可选 / 对齐符号）', () => {
    const std = tokenize('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后文')
    expect(std?.type).toBe('ke_table')
    expect(std?.headers).toEqual(['a', 'b'])
    expect(std?.rows).toEqual([['1', '2']])

    const noLeadTrail = tokenize('a | b\n--- | ---\n1 | 2\n')
    expect(noLeadTrail?.type).toBe('ke_table')

    const aligned = tokenize('| a | b |\n| :--- | ---: |\n| 1 | 2 |')
    expect(aligned?.type).toBe('ke_table')
  })

  it('非表格立即拒绝（不与长尾内容相关）', () => {
    expect(tokenize('普通段落没有管道\n第二行\n第三行')).toBeUndefined()
    // 含管道但第二行不是分隔行 → 不是表格
    expect(tokenize('这是一段带 | 的普通文字\n继续正文 | 更多\n')).toBeUndefined()
    // 列数不一致 → 不是表格
    expect(tokenize('| a | b |\n| --- |\n| 1 | 2 |')).toBeUndefined()
    // 分隔行不合法（缺少 -） → 不是表格
    expect(tokenize('| a | b |\n| --x | --- |\n| 1 | 2 |')).toBeUndefined()
    // 单行输入（无第二行）→ 保持既有行为：不是表格
    expect(tokenize('| a | b |')).toBeUndefined()
    // 缩进 ≥4 空格属于代码块，不是表格（既有契约）
    expect(tokenize('| a | b |\n| --- | --- |\n    | 1 | 2 |')).toBeDefined()
    expect(tokenize('    | a | b |\n    | --- | --- |')).toBeUndefined()
  })

  it('早期拒绝在长尾文本下仍正确返回 undefined（不抛错）', () => {
    const tail = '普通段落行\n'.repeat(20000)
    expect(tokenize('不是表格的段落\n' + tail)).toBeUndefined()
    // 长尾 + 真表格：仍应正确识别，且只取表格部分
    const ok = tokenize('| x | y |\n| --- | --- |\n| 1 | 2 |\n' + tail)
    expect(ok?.type).toBe('ke_table')
    expect(ok?.rows).toEqual([['1', '2']])
  })
})
