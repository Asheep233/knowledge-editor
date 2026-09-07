/** 文件树构建：扁平 rel_path 列表 -> 嵌套树（文件夹优先、字典序）。 */

export interface TreeNode {
  name: string
  relPath: string
  type: 'folder' | 'file'
  children?: TreeNode[]
}

export function buildFileTree(paths: string[]): TreeNode[] {
  const roots: TreeNode[] = []
  const folders = new Map<string, TreeNode>()

  const ensureFolder = (relPath: string, name: string, parent: TreeNode[]): TreeNode => {
    const existing = folders.get(relPath)
    if (existing) return existing
    const node: TreeNode = { name, relPath, type: 'folder', children: [] }
    parent.push(node)
    folders.set(relPath, node)
    return node
  }

  const sorted = [...paths].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  for (const p of sorted) {
    const isDirEntry = p.endsWith('/')
    const clean = isDirEntry ? p.slice(0, -1) : p
    const parts = clean.split('/')
    let parent = roots
    let acc = ''
    // 目录条目需把「末级文件夹」本身也 ensure（否则空目录只有祖先、自身不出现）
    const ensureCount = isDirEntry ? parts.length : parts.length - 1
    for (let i = 0; i < ensureCount; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      parent = ensureFolder(acc, parts[i], parent).children ?? parent
    }
    if (!isDirEntry) {
      parent.push({ name: parts[parts.length - 1], relPath: p, type: 'file' })
    }
  }
  sortTree(roots)
  return roots
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
  for (const n of nodes) if (n.children) sortTree(n.children)
}
