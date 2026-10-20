/**
 * Focus 页面壳（参考稿 page-area / page-inner / page-head / page-title / page-sub / page-actions）。
 *
 * 用法：
 *   <PageShell title="知识库" subtitle="107 篇文档 · 7 个文件夹 · 12 个模块" actions={<>导入 新建</>}>
 *     ...页面内容
 *   </PageShell>
 */
import type { ReactNode } from 'react'

export interface PageShellProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /** 内容列宽：默认 1040（参考稿 .page-inner），表格类页面可指定 narrow=840 */
  narrow?: boolean
  children: ReactNode
}

export function PageShell({ title, subtitle, actions, narrow = false, children }: PageShellProps) {
  return (
    <div className="focus-page-area" data-ke-slot="page-area">
      <div className="focus-page-inner" data-narrow={narrow ? '1' : undefined}>
        <div className="focus-page-head">
          <div className="focus-page-head-grow">
            <h1 className="focus-page-title">{title}</h1>
            {subtitle ? <div className="focus-page-sub">{subtitle}</div> : null}
          </div>
          {actions ? <div className="focus-page-actions">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  )
}
