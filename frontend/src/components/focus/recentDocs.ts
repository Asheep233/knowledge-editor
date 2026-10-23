/**
 * 「最近文档」工作区隔离（2026-10-22 真机审查 P3-4）：
 *
 * `app_config.json` 里的 recent-documents 是**全局**的（跨工作区累积），而知识库页
 * 「最近编辑」与 ⌘K 命令面板「最近文档」都属于**当前工作区**语境。直接展示会出现
 * 「切到 A 工作区仍看到 B 工作区文档，点击 404」。
 *
 * 这里用当前工作区文件树做一次过滤：只保留真实存在于当前工作区的路径。
 * 取不到文件树（接口失败）时**不过滤**（避免错误态把整个列表清空）；调用方需自行展示
 * 树错误提示。
 */
import type { RecentDocument, TreePayload } from '../../types'

/** 过滤掉不属于当前工作区的最近文档（保持原顺序）。 */
export function filterRecentToWorkspace(recent: RecentDocument[], tree: TreePayload | null): RecentDocument[] {
  if (!tree) return recent
  // tree.articles 里目录以 `/` 结尾；文档为完整相对路径
  const known = new Set(tree.articles.filter((p) => !p.endsWith('/')))
  return recent.filter((doc) => known.has(doc.rel_path))
}
