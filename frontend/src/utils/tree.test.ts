import { describe, expect, it } from 'vitest'
import { buildFileTree } from './tree'

describe('buildFileTree', () => {
  it('builds nested folders from flat rel paths', () => {
    const tree = buildFileTree([
      'Articles/a.md',
      'Articles/项目/物理/力学.md',
      'Articles/项目/数学.md',
      'Articles/z.md',
    ])
    expect(tree).toHaveLength(1) // 只有 Articles 一个顶层
    const articles = tree[0]
    expect(articles.type).toBe('folder')
    expect(articles.relPath).toBe('Articles')
    // 文件夹优先，再按字典序
    const names = articles.children!.map((c) => c.name)
    expect(names).toEqual(['项目', 'a.md', 'z.md'])
    const proj = articles.children!.find((c) => c.name === '项目')!
    expect(proj.children!.map((c) => c.name)).toEqual(['物理', '数学.md'])
  })

  it('keeps root-level files', () => {
    const tree = buildFileTree(['Modules/m1.md', 'Modules/m2.md'])
    expect(tree).toHaveLength(1)
    expect(tree[0].children!.map((c) => c.name)).toEqual(['m1.md', 'm2.md'])
  })

  it('handles empty input', () => {
    expect(buildFileTree([])).toEqual([])
  })

  it('file leaf has full relPath', () => {
    const tree = buildFileTree(['Articles/子目录/文档.md'])
    const leaf = tree[0].children![0].children![0]
    expect(leaf.type).toBe('file')
    expect(leaf.relPath).toBe('Articles/子目录/文档.md')
  })
})

describe('FIX：空目录条目（尾 /）在树中可见', () => {
  it('新建的空文件夹（后端返回 "Articles/xxx/"）在树中显示为文件夹节点', () => {
    const tree = buildFileTree(['Articles/空目录/', 'Articles/a.md'])
    const articles = tree.find((n) => n.type === 'folder' && n.name === 'Articles')
    const folder = (articles?.children ?? []).find((n) => n.type === 'folder' && n.name === '空目录')
    expect(folder).toBeTruthy()
    expect(folder?.children ?? []).toEqual([])
    expect((articles?.children ?? []).some((n) => n.type === 'file' && n.name === 'a.md')).toBe(true)
  })

  it('嵌套空目录与既有目录合并，不产生空文件叶子', () => {
    const tree = buildFileTree(['Articles/甲/乙/', 'Articles/甲/丙/', 'Articles/甲/乙/doc.md'])
    const articles = tree.find((n) => n.type === 'folder' && n.name === 'Articles')
    const jia = (articles?.children ?? []).find((n) => n.type === 'folder' && n.name === '甲')
    const names = (jia?.children ?? []).map((n) => n.name)
    expect([...names].sort()).toEqual(['丙', '乙'])
    const yi = (jia?.children ?? []).find((n) => n.name === '乙')
    expect((yi?.children ?? []).map((n) => n.name)).toEqual(['doc.md'])
    expect((yi?.children ?? []).every((n) => n.type === 'file')).toBe(true)
  })
})
