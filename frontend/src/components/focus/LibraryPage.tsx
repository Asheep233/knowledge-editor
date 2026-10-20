/**
 * Focus 知识库页（主画布页面）。占位骨架：由实现任务填充（参考稿 prototype/screens/*.html）。
 */
import type { FocusPageProps } from './pageTypes'
import { PageShell } from './PageShell'

export function LibraryPage({ onNavigate, onOpenArticle, onNewArticle, refreshToken }: FocusPageProps) {
  void onNavigate
  void onOpenArticle
  void onNewArticle
  void refreshToken
  return (
    <PageShell title="知识库" subtitle="页面实现中…">
      <div style={{ padding: '48px 0', color: 'var(--text-3)', fontSize: 13 }}>知识库页占位</div>
    </PageShell>
  )
}
