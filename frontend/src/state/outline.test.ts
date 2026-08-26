/** P4-13 回归测试：Markdown 标题大纲提取。 */
import { describe, expect, it } from 'vitest'
import { extractOutline } from './outline'

describe('extractOutline — P4-13', () => {
  it('解析 #/##/### 标题并给出级别与文本', () => {
    const md = '# 一级\n\n## 二级\n\n### 三级\n\n正文\n'
    const items = extractOutline(md)
    expect(items).toEqual([
      { level: 1, text: '一级', offset: 0 },
      { level: 2, text: '二级', offset: 6 },
      { level: 3, text: '三级', offset: 13 },
    ])
  })

  it('跳过前导 YAML frontmatter', () => {
    const md = '---\ntitle: x\ntags:\n  - a\n---\n# 正文标题\n'
    const items = extractOutline(md)
    expect(items).toEqual([{ level: 1, text: '正文标题', offset: 29 }])
  })

  it('maxLevel 限制只取前 N 级', () => {
    const md = '# a\n## b\n### c\n#### d\n'
    expect(extractOutline(md, 2).map((i) => i.text)).toEqual(['a', 'b'])
    expect(extractOutline(md, 3).map((i) => i.text)).toEqual(['a', 'b', 'c'])
  })

  it('无标题返回空数组', () => {
    expect(extractOutline('普通段落\n无标题')).toEqual([])
  })

  it('多行内标题与杂项不误判', () => {
    const md = '# 标题\n\n> # 引用中的标题\n\n代码 # 不算\n'
    // 引用块与代码中的 # 不作为标题（只匹配行首 #）
    expect(extractOutline(md).map((i) => i.text)).toEqual(['标题'])
  })
})
