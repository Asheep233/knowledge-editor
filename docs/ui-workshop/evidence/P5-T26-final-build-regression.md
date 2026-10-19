# P5-T26 最终构建回归证据（2026-10-19 末段）

- 构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`，sha256 前缀 **`c849241bc9dd6be3`**，
  mtime **2026-10-19 16:43**（含 blockquote 快捷键修复 f4759a2；前端双 flag + 全部 W07/G/F 修复）
- 目的：在**最终交付构建**上复跑关键产品 W 探针，确认交付快照与既有证据一致（不新增功能）
- 隔离：全部隔离 APPDATA/工作区；用户 App 未运行（N/A）；清理按路径白名单；无真实笔记

## 复跑结果（真实产品 W，最终构建）

| 探针 | 结果 | 证据 |
| --- | --- | --- |
| A4+A6 签名信任链 + 安装/启用/回滚/卸载 | **16/16 PASS** | `T26-A4-A6-install-results.json`（重生成） |
| G1/G2 guest 内容读 + 真实写（snapshot content/context.write） | **14/14 PASS** | `T26-G1G2-results.json`（重生成） |
| A8 Core 保存 flag（JS flag + 产品 UI，autosave→/api/context/write） | **9/9 PASS** | `T26-A8-save-results.json`（重生成） |

## 说明（只读性修正）

- `run_t26_install_probe.py` 与 `run_t26_save_probe.py` 的「用户 App 未受影响」检查原先要求
  **用户 App PID 存在**；用户 App 未运行时应记 **N/A**（不可能被影响）。本轮已修正为
  「PID 存在或未运行→N/A」，并在证据 detail 记录 `N/A (not running)`；业务检查未变。
- 其余探针结果（A1/A2/A3/A5/A7/IME/W01–W09/G3/G4/G7/F 等）来自此前同构建/邻近构建，构建指纹与
  本轮一致或仅差 blockquote 修复（不影响其链路）；未在本轮全部重跑，交付文档按证据原始记录引用。
