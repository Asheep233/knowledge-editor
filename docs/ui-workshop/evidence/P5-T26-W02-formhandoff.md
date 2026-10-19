# P5-T26 W02 证据（部分）：表单交接 Core 状态机 — U 6/6

- 日期：2026-10-19 · 代码：`frontend/src/core/session/formHandoff.ts`（DOM-free）
- 证据类型：**U（前端单测）**；产品 UI 接线与 W 证据 **未完成**

## 语义实现（对齐 ACCEPTANCE W02 关键点）

- `begin(initial)` → `setField` → `submit({requestId})` → 宿主 `onCommit` 原子提交；
- **迟到/重复提交**：同 requestId 幂等返回 duplicate（不重复 commit）；已关闭交接的迟到提交 → closed；
- **原子切写资格**：`canCommit()` false（旧连接失效）→ rejected（E_STALE_CONNECTION），旧会话保留；
- **失败可继续**：commit 抛错 → rejected + 旧会话仍可编辑，可重试；
- **drain**：宿主等待在途提交完成；`isCommitting` 可观测。

## 测试：6/6 PASS

| 用例 | 验证 |
| --- | --- |
| 提交成功 | onCommit 收到最终 values；提交后关闭且旧值不可改 |
| 提交失败 | rejected + 旧会话保留；重试成功 |
| 重复 requestId | duplicate，onCommit 仅 1 次 |
| 迟到/关闭后提交 | closed，不影响会话 |
| 连接失效 | E_STALE_CONNECTION 拒绝，恢复后可提交 |
| drain/isCommitting | 等待在途提交完成、状态正确 |

## 未完成（W02 剩余，阻止 W02 W 证据）

1. 产品接线：guest 表单（title/tags/公式/重命名草稿）通过 Broker `command.invoke` 到 host，
   host 调用本状态机与后端原子写；
2. 对话框/候选启动失败、IME 组词交接、旧连接失效的**产品 W** 验证；
3. 与官方编辑器 UI 状态同步（提交后编辑器/标签页刷新语义）。

结论：W02 仅 Core 状态机就绪（U 6/6），**产品 W 未做**，不得宣称 W02 通过。
