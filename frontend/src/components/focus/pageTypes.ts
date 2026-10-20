/**
 * Focus 页面级路由类型与页面组件契约（主画布页面：知识库/搜索/模块/资料/回收站）。
 *
 * 架构：App 持有 `page` 状态；`page === 'editor'` 时主画布显示编辑器（纸面+命令条），
 * 其它值在主画布上叠加只读/半只读页面（参考稿 page-area / page-inner 结构），
 * 左侧浮动文件侧栏始终保留，导航点击通过 `onNavigate` 切换页面。
 */
export type AppPage = 'editor' | 'library' | 'search' | 'modules' | 'assets' | 'trash'

/** Focus 页面组件通用 props（App 注入；页面自身负责取数）。 */
export interface FocusPageProps {
  /** 切换主画布页面（侧栏导航 / 页面内跳转） */
  onNavigate: (page: AppPage) => void
  /** 打开文档并回到编辑器页 */
  onOpenArticle: (id: string) => void
  /** 新建文档（App 既有 handleNewArticle：创建 + 打开 + 进编辑器页） */
  onNewArticle: () => void
  /** 数据刷新令牌：文件系统变更后 App 自增，页面据此重新取数 */
  refreshToken: number
  /** 文件系统变更后通知 App 刷新侧栏文件树（如回收站恢复） */
  onFsChanged?: () => void
}

/** 侧栏导航项标识（与设计稿 .fb-nav 一致） */
export const NAV_ITEMS: ReadonlyArray<{ page: Exclude<AppPage, 'editor'>; label: string; icon: string }> = [
  { page: 'library', label: '知识库', icon: 'book' },
  { page: 'search', label: '搜索', icon: 'search' },
  { page: 'modules', label: '模块', icon: 'layers' },
  { page: 'assets', label: '资料', icon: 'paperclip' },
  { page: 'trash', label: '回收站', icon: 'trash' },
]
