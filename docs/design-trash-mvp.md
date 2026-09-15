# 回收站 MVP 设计契约（2026-09-15 立项）

> 主理人决策：落点 **`Trash/`（可见）** · 恢复冲突 **自动改名 + 提示** · MVP 范围 **仅文档**
> 可行性依据：`docs/design-file-management-feasibility.md` §2
> 本文件是**接口契约**，前后端并行开发以本文件为准；实现细节可调整，**契约不得单方变更**。

---

## 1. 存储布局（清单从文件系统派生，不引入第二个事实源）

```
<workspace>/
└─ Trash/
   ├─ 20260915-143012-a1b2/          ← 一次删除 = 一个 entry
   │  └─ Articles/子目录/文档.md      ← 保留**完整原相对路径**
   └─ 20260915-150845-c3d4/
      └─ Articles/另一篇.md
```

- **entry 名**：`YYYYMMDD-HHMMSS-<4位随机hex>`（同秒多次删除不冲突）
- **entry 内含原 rel 的完整路径** → 恢复 = 把 `<entry>/<rel>` 移回 `<ws>/<rel>`，**原路径无需额外元数据**
- **删除时间**：取自 entry 名（不额外存元数据文件）
- **不引入 sidecar/DB 表**：清单完全从目录结构派生 → 符合「Markdown 单源、不把 SQLite 当虚拟文件系统」（`fs.py:3-11`）
- **目录惰性创建**：首次删除时创建；老工作区无需预建

## 2. 硬约束（实现必须满足）

| # | 约束 | 原因 |
|---|---|---|
| C1 | **`Trash/` 必须加入 `_FORBIDDEN_ROOT`**（`fs.py:26-29`）+ 不变量测试 | 目前只是**偶然**不可达（`_require_business_top` 顺带 400）；需显式声明，防后人把回收站挪进 `Articles/`（实测代价：进 tree/搜索/附件列表/watcher，需 9+ 处排除）|
| C2 | **绝不修改 Markdown 内容** | 回收站只改位置。任何「顺手修复引用」= D 层变更，须规范先行（本期明确排除）|
| C3 | 删除用**原子 rename**（`os.replace` 优先），不用 copy+delete | 避免半完成文件 |
| C4 | **`Trash/` 不参与索引/watcher/搜索/tree** | 它们硬编码只枚举 `Articles/Modules/Attachments` → **无需改动**；本约束是**不变量**，不是待办 |
| C5 | 删除既有 `Drafts/backup` 快照行为**保持不变** | 双份保留（历史 + 回收站）是**有意**的；`MAX_VERSIONS=30` 不动 |
| C6 | 恢复**不得静默覆盖** | 目标存在 → 自动改名 + 返回 `renamed: true` |

## 3. API 契约

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| `GET` | `/api/trash` | — | `{count, items: TrashItem[]}` |
| `POST` | `/api/trash/restore` | `{id: string}` | `{id, restored_to: string, renamed: boolean}` |
| `DELETE` | `/api/trash/{id}` | — | `204`（彻底删除该 entry）|
| `DELETE` | `/api/trash` | — | `204`（清空；幂等）|

```ts
interface TrashItem {
  id: string          // entry 名，如 "20260915-143012-a1b2"
  rel_path: string    // 原相对路径，如 "Articles/子目录/文档.md"
  name: string        // 文件名（展示用）
  deleted_at: string  // ISO8601，由 entry 名解析
  size: number        // 字节
}
```

**职责边界**：
- `GET /api/trash` 的 `rel_path` 用于展示与恢复定位
- entry 内**只放一个文件**（MVP：一次删除 = 一个文档 = 一个 entry）；若发现 entry 含多文件（异常/用户手工放入），
  `GET` 只取首个并在 `rel_path` 上标注，**不报错**

## 4. 删除端点改道（3 条中的 1 条）

| 端点 | MVP 行为 |
|---|---|
| `DELETE /api/articles/{id}` | **改道**：`docs/.../x.md` → `Trash/<entry>/Articles/.../x.md`（保持 `P1-11` 快照行为不变）|
| `DELETE /api/fs/dir` | **不变**（硬删）—— MVP 范围「仅文档」|
| `DELETE /api/attachments/{rel}` | **不变**（硬删，仅孤儿可删）|

## 5. 恢复冲突策略（已拍板：自动改名 + 提示）

目标路径已存在时，按 `<stem>-1<ext>`、`<stem>-2<ext>`… 递增（与附件去重 `_create_unique` 的既有约定一致），
上限 1000 次后返回 `409`。响应 `renamed: true`，前端据此提示「已恢复为 xxx-1.md」。

## 6. 孤儿附件语义（数据安全，必须一并处理）

**问题**：文档进回收站后从 `references.py` 的引用索引消失 → 其引用的附件变「孤儿」→
前端给删除按钮、`DELETE /api/attachments` 又只校验孤儿 → **用户可删掉恢复后仍需的附件**。

**MVP 处理**：`references.py` 的文档扫描范围**增加 `Trash/`** → 被回收站文档引用的附件**不算孤儿**、**不可删除**。

**副作用（需同步改测试）**：`referenced_by` 可能包含 `Trash/...` 路径；既有用例
`test_attachments_mgmt.py::test_attachment_list_with_referenced_by` 等需核对。

## 7. 确认文案（软删后原文案失真，必须改）

`LeftSidebar.tsx:264-267` 现为**双重确认**且写「删除后**无法恢复**」：
- 改为**单次确认**，文案含「可在回收站恢复」
- 附件/文件夹删除（硬删）**保留**原「无法恢复」文案

## 8. 不做（明确排除，避免范围蔓延）

- 自动清理/保留策略（MVP 仅手动清空）· 保留天数设置项（涉 Rust IPC 三处同步）
- 文件夹与附件的回收站 · 回收站内容预览/编辑 · 恢复撤销 · 多文件 entry 的完整处理
- 任何正文引用重写（D 层）· Windows 系统回收站

## 9. 验收标准

1. 删除文档 → 原路径腾空、索引清干净、tree 更新；文件出现在 `Trash/<entry>/<原rel>`
2. `Trash/` **不出现在** tree / 搜索 / 附件列表 / watcher 事件中
3. 回收站列表正确显示（原路径/删除时间/大小）
4. 恢复 → 文件回到原路径、索引自动重建；**已打开该文档时能被正确重开或提示**
5. 恢复冲突 → 自动改名 + `renamed: true`
6. 彻底删除 / 清空 → 文件真删、列表刷新
7. **被回收站文档引用的附件不出现在孤儿列表、且不可删除**
8. 确认文案已改；`tsc 0`；vitest ≥378 passed + 1 skipped；pytest ≥314 passed + 2 skipped
9. `test_openapi_snapshot.py` 基线**显式更新**（+4 端点 +1 schema，属设计如此）
