"""SQLite 访问层：集中索引存储。

设计原则（决策点 3 确认）：
- Markdown 文件是唯一事实源，SQLite 仅为可重建的索引缓存。
- 删除 index.db 后由 WorkspaceIndexer 全量重建，不丢失任何用户数据。
"""
