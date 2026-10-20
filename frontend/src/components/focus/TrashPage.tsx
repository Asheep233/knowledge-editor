/**
 * Focus 回收站页（主画布页面）。占位骨架：由实现任务填充（参考稿 prototype/screens/*.html）。
 */
import type { FocusPageProps } from './pageTypes'
import { PageShell } from './PageShell'

export function TrashPage({ onNavigate, onOpenArticle, onNewArticle, refreshToken }: FocusPageProps) {
  void onNavigate
  void onOpenArticle
  void onNewArticle
  void refreshToken
  return (
    <PageShell title="回收站" subtitle="页面实现中…">
      <div style={{ padding: '48px 0', color: 'var(--text-3)', fontSize: 13 }}>回收站页占位</div>
    </PageShell>
  )
}
