# P5-T26 云端交接自验证据（2026-10-19 末段）

- 目的：在交给云端 Codex 之前，本地**模拟云端流程**验证交接包可用（clone → checkout 基础提交 →
  bundle fetch/checkout → HEAD 一致 → 关键文件存在 → 脚本语法/入口可用）
- 交接包：`docs/ui-workshop/reports/cloud-handoff/` + 一键 zip `docs/ui-workshop/reports/cloud-vm-taskpack.zip`
- 本地 base 仓库：GitHub `Asheep233/knowledge-editor`（云端可 clone）；交接不 push、不改远端

## 自验结果

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | `git bundle verify`（bundle 基于 `4c71233`，ref `refs/heads/feat/ui-workshop`） | PASS（requires 4c71233；sha1） |
| 2 | `git bundle list-heads` | `689575b00d0474caf4303e9681f0257df6581f15 refs/heads/feat/ui-workshop` |
| 3 | 本地模拟：clone → `git checkout 4c71233` → `git fetch <bundle> 'refs/heads/feat/ui-workshop:feat/ui-workshop'` → checkout | PASS |
| 4 | 模拟仓库 HEAD 与本地 HEAD 一致 | **PASS（`689575b`）** |
| 5 | 关键文件存在（scripts/build.ps1、tauri.conf.json、frontend/package.json、TASKS.md） | PASS |
| 6 | `cloud_build.ps1` PowerShell 语法解析（ScriptBlock::Create） | PASS |
| 7 | `cloud_verify_installed.py --help` 可运行（py_compile + help） | PASS |
| 8 | 一键 zip 完整（TASKS/README/schema/build/verify/t27_gate/bundle，约 4.9MB） | PASS |
| 9 | `cloud_t27_gate.py --dry-run`（本地真实安装包，只读）→ 版本识别 1.2.9 / 1.2.18、计划 JSON 输出 | PASS |

## 关键修正（本轮发现并修好）

1. 初版 bundle 用 `4c71233..HEAD` 生成，只记录 `HEAD` ref → 云端 `git fetch feat/ui-workshop` 失败；
   已改为显式 `4c71233..refs/heads/feat/ui-workshop`，ref 正确、可 fetch/checkout。
2. `cloud_build.ps1` 初版假设仓库根有 `package.json` 并 `npm ci --prefix 根`；实际仓库根无 package.json →
   已改为分别 `npm ci` 前端/桌面目录，并显式检查 `frontend/package.json`。
3. 文档中 fetch 命令同步为 `'refs/heads/feat/ui-workshop:feat/ui-workshop'`；zip 重新生成。

## 说明

- bundle HEAD = `689575b`；其后若仅有交接文档提交，代码不变（云端可 checkout 该 HEAD 构建）。
- 云端仍缺项：真实 VM 构建/安装/升级/回滚执行与截图证据（由 Codex 按 `cloud-handoff/TASKS.md` 执行）。
