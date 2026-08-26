/**
 * 最近工作区记录的移除（P2-9）。
 *
 * WorkspacePicker 原先用裸 `fetch('/api/workspace/recent?path=…')` 绕过 apiBase，
 * 桌面版会因缺少 `window.__KE_API_BASE__` 前缀而 404。本模块经 client 的 apiBase
 * 拼接绝对地址，保持与其余 API 调用一致（无需改动 forbidden 的 client.ts）。
 */
import { apiBase } from '../api/client'

/** 移除一条最近工作区记录（DELETE /api/workspace/recent?path=…）。 */
export async function removeRecentWorkspace(path: string): Promise<void> {
  const res = await fetch(apiBase() + `/api/workspace/recent?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(res.statusText)
}
