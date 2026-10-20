# Focus 视觉验收 · 运行摘要（verify-ui.cjs 自动生成）

- 时间：2026-10-20T07:14:38.659Z（耗时 35.8s）
- 仓库：/mnt/f/Work/KE Project/knowledge-editor
- git：focus-ui @ 06c0567（脏文件 11 个）
- 前端：http://127.0.0.1:5273（脚本独立拉起 pid=89556）
- 后端：http://127.0.0.1:8000（复用现有）
- 截图：9 张 → /tmp/focus-shots/

## 断言：135/135 PASS，0 DIFF

## 截图清单

- `/tmp/focus-shots/01-editor-light-1440x900.png`（1440×900）
- `/tmp/focus-shots/02-editor-collapsed-sidebar-1440x900.png`（1440×900）
- `/tmp/focus-shots/03-editor-inspector-sheet-1440x900.png`（1440×900）
- `/tmp/focus-shots/06-settings-1440x900.png`（1440×900）
- `/tmp/focus-shots/09-focus-mode-1440x900.png`（1440×900）
- `/tmp/focus-shots/04-editor-dark-1440x900.png`（1440×900）
- `/tmp/focus-shots/05-launcher-1440x900.png`（1440×900）
- `/tmp/focus-shots/07-editor-drawer-1024x800.png`（1024×800）
- `/tmp/focus-shots/08-editor-narrow-800x900.png`（800×900）

## 控制台错误（去重前 15 条，环境噪声也可能包含在内）

- Failed to load resource: the server responded with a status of 404 (Not Found)
- flushSync was called from inside a lifecycle method. React cannot flush when React is already rendering. Consider moving this call to a scheduler task or micro task.
- Failed to load resource: the server responded with a status of 403 (Forbidden)

## 请求失败（4xx/5xx，去重前 15 条）

- 403 http://127.0.0.1:5273/api/workspace/recent-documents
