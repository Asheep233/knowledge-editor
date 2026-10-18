# P1-T12 证据：写域迁移切片 — 受控文章保存（context 绑定，真实后端）

- 日期：2026-10-19 · 代码（产品后端增量接口；既有全局端点行为不变）：
  - `backend/app/services/context_registry.py::save_article`：受限路径（`Articles/**.md`）、
    自动 frontmatter（title + ke_version）后复用既有 `write` 的 **CAS/幂等/原子写/外部改盘检查**；
  - `backend/app/routers/context.py`：`POST /api/context/article/save` + `ContextArticleSaveReq`；
  - `backend/tests/test_ui_workshop_context_articles.py`：6 例
- 契约显式更新（只做加法）：OpenAPI 50→**51 路径**、62→**63 方法**、+1 schema
- 证据类型：**A（真实产品后端 API + pytest）**

## 测试结果

| 项 | 结果 |
| --- | --- |
| 保存文章 → 磁盘 frontmatter（title/ke_version）+ 正文；tree 可见；search 命中 | passed |
| CAS（revision 1→2；过期 revision → conflict）与 requestId 幂等 | passed |
| 路径限制（`Notes/` 外、`../` 穿越、非 .md）→ 400 | passed |
| 旧 epoch → 409；两上下文同 rel_path 完全隔离 | passed |
| 旧全局端点 `/api/health`、`/api/tree` 不受影响（App 可继续使用） | passed |
| 后端全量 pytest（WSL Python 3.14） | **846 collected，exit 0** |
| 后端全量 pytest（Windows Python 3.10，CI venv） | **exit 0** |

## 结论

- T12 的写域第一刀落地：受上下文绑定的**受控文章保存**（路径/标题/frontmatter/CAS/幂等/隔离），
  与 T09 的上下文注册表、T10 的 Core 保存语义对齐；旧 App 全局端点保持可用（未隐藏旧 App）。
- 尚未完成（T12 继续）：
  1. 重命名/删除/移动/回收站、附件上传、导入导出、打印 job 等其余写域；
  2. 真实 `store/indexer/history/watcher` 生命周期迁移（当前 tree/search 为切片实现，非产品 FTS）；
  3. 前端调用从全局端点切到上下文端点（T14/T15 接线）；旧端点分阶段 deprecated 后移除。
