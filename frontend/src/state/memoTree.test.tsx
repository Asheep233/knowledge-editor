/** P3-15 回归测试：buildFileTree 经 useMemo 后引用稳定（性能项）。
 *  同时验证 vite.config include 已匹配 `.test.tsx`（P3-17）。 */
import { useMemo } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { buildFileTree, type TreeNode } from '../utils/tree'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
const container = document.createElement('div')
document.body.appendChild(container)

function Harness({ paths, onTree }: { paths: string[]; onTree: (t: TreeNode[]) => void }) {
  // 与 LeftSidebar 一致：仅当树数据引用变化时重建（击键导致 App 重渲染时不重建）
  const tree = useMemo(() => buildFileTree(paths), [paths])
  onTree(tree)
  return null
}

async function renderInto(paths: string[], collect: TreeNode[][]): Promise<void> {
  await act(async () => {
    root!.render(<Harness paths={paths} onTree={(t) => void collect.push(t)} />)
  })
}

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
})

describe('buildFileTree useMemo — P3-15', () => {
  it('同一数组引用重渲染时，memo 结果引用稳定（不重建）', async () => {
    root = createRoot(container)
    const paths = ['Articles/a.md', 'Articles/b.md', 'Articles/f1/c.md']
    const refs: TreeNode[][] = []
    await renderInto(paths, refs) // 首次
    await renderInto(paths, refs) // 同一 paths 引用，组件仍挂载 → 命中 memo 缓存
    expect(refs).toHaveLength(2)
    expect(refs[1]).toBe(refs[0])
  })

  it('Paths 引用变化时，memo 重新构建（新引用）', async () => {
    root = createRoot(container)
    const refs: TreeNode[][] = []
    await renderInto(['Articles/a.md'], refs)
    await renderInto(['Articles/a.md', 'Articles/b.md'], refs)
    expect(refs).toHaveLength(2)
    expect(refs[1]).not.toBe(refs[0])
  })
})
