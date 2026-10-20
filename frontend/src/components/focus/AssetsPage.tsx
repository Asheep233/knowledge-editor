/**
 * Focus 资料页（主画布页面）。占位骨架：由实现任务填充（参考稿 prototype/screens/*.html）。
 */
import type { FocusPageProps } from './pageTypes'
import { PageShell } from './PageShell'

export function AssetsPage({ onNavigate, onOpenArticle, onNewArticle, refreshToken }: FocusPageProps) {
  void onNavigate
  void onOpenArticle
  void onNewArticle
  void refreshToken
  return (
    <PageShell title="资料" subtitle="页面实现中…">
      <div style={{ padding: '48px 0', color: 'var(--text-3)', fontSize: 13 }}>资料页占位</div>
    </PageShell>
  )
}
