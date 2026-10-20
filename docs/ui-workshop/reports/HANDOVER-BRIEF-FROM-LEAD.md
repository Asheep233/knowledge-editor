# 主 Agent 交接说明（Handover Brief from Lead）

> 出具人：**本项目主 Agent（Lead）**。本文件是我对下一任负责人/Agent 的正式交接，覆盖
> `astranota-ui-workshop-taskpack-2026-10-18` 从接收、实施、验收、结项到推送的全过程。
> 交接对象可以是人类负责人，也可以是接手的 Agent；涉及事实以仓库内证据为准。

## 1. 我接手的是什么

- 任务包：`astranota-ui-workshop-taskpack-2026-10-18.zip`（AstraNota UI 创意工坊，T00–T28 / P0–P5）。
- 仓库：`knowledge-editor`；基线 v1.2.18 `4c71233` + 轻量外观 overlay `e54d37b`。
- 目标：实现工坊（运行域/ACL/恢复/编辑面/保存/打印/包事务/协议/信任/参考 UI 等），做真实
  Windows/WebView2 证据，按 TASK PACK 口径给出交付状态与交接报告。
- 主理人红线：分支默认不推送/不 Release；不用真实笔记做测试；不隐藏旧 App 冒充 Core 抽离；
  不把 happy-dom/Linux Chromium 当 Windows/WebView2 证据。

## 2. 我做到哪一步（权威结论）

| 项 | 状态 |
| --- | --- |
| 分支/提交 | `feat/ui-workshop`，HEAD 以 `git log -1` 为准；**已推送** `origin/feat/ui-workshop`（主理人授权；仅此分支） |
| 最终交付状态 | **`EXPERIMENTAL_TRUSTED_PACKS`**（接口级交付；宿主 UI 默认关闭；不声明正式发布/更高里程碑） |
| T26 认证 | **未达成**（A1–A8/W/G/F 大量 W 证据已齐，但缺 T27 I、人工 IME/多 DPI、F 全量覆盖） |
| T27 I 门禁 | **NOT_RUN / BLOCKED**——主理人确认无 Windows VM；Linux 预检 PASS 不能替代 I 证据 |
| 工作树 | 干净；无测试进程残留；用户 App 未被触碰 |
| 目标状态 | 本会话 goal 已按上述状态标记 **complete**（结项，不是认证完成） |

## 3. 我留下的可复用资产（按重要性）

1. **接口文档**：`WORKSHOP-INTEGRATION-GUIDE.md`（host/guest/SDK/协议/方法/事件/21 命令白名单/生命周期/接入点/安全模型/验证）。
2. **接口维护机制**：`WORKSHOP-INTERFACE-POLICY.md`（每次更新必须维护的 DoD）+ `WORKSHOP-INTERFACE-CHANGELOG.md`；
   `tools/verify_delivery_consistency.py` 的 **DC-9** 会自动校验版本/文档/UI 默认关闭。
3. **交接文档**：`reports/HANDOVER-SNAPSHOT.md`、`reports/TASK-STATUS-HANDOVER.md`（T00–T28 诚实状态）、
   `HANDOVER-FINAL.md`、`reports/FINAL-DELIVERY-STATUS.md`。
4. **证据**：`evidence/`（约 95 篇说明 + 48 份 results JSON：A1–A8、W01–W09、G1–G7、F 台账、packA/B 命令桥等）；
   `validation-matrix.csv`（63 行，`build_validation_matrix.py --check` PASS）；`EVIDENCE-INDEX.md`。
5. **可运行源码**：前端（React/Tiptap）`frontend/src/{core,components}`、后端 `backend/app/{routers,services}`、
   Rust `desktop/src-tauri/src`（pack_store/print/sidecar/settings 等）。
6. **SDK 与参考 UI**：`sdk/`（发布形态 dist，iife+ESM，自检 4/4）、`packs/pack-a|pack-b`（真实安装启用 W 24/24）。
7. **云端验收包 v2**：`reports/cloud-handoff/`（完整 sources.bundle 生成器 + 修正版 scripts + 39 tests + 签名 test-pack
   + preflight 证据 + README 步骤），生成器 `tools/build_cloud_handoff.py`。
8. **前端 Agent 接入 Runbook**：`reports/AGENT-FRONTEND-INTEGRATION-RUNBOOK.md`（Linux 完整验证 + Windows 可选 W）。

## 4. 我做过的重要决策（下一任请先读）

1. **T27 环境阻塞决策**：主理人确认无 Windows VM → 按 `reports/DECISION-T27-I-gate-blocked.md` 以
   `EXPERIMENTAL_TRUSTED_PACKS` 结项；`verdict=FAIL` 仅表示门禁未通过（未执行），**不是产品故障**；
   不在主理人真实机器上安装/升级/回滚。
2. **接口级交付**（主理人指示）：工坊保留在接口层，前端 UI 入口默认关闭（`VITE_KE_WORKSHOP` 未开不渲染），
   不作为产品默认界面；接口变更必须维护 Guide + CHANGELOG + 版本 + 测试。
3. **推送授权**：主理人明确授权后，仅推送 `feat/ui-workshop`；**未推 master、未创建 Release/标签**。
4. **云端 Codex 预检**：其环境为 Debian（无 Windows VM）→ 只登记为 Linux 预检 PASS；它审计发现我方交接脚本
   6 类真实缺陷（数据丢失被掩盖/U3 自动 PASS/缺签名包仍通过/异常不落结果/清理范围过宽/构建未固定候选 HEAD），
   修正版与 39 项测试已纳入 v2 交接包（我本地复核 39/39、SHA256 64/64、无私钥）。

## 5. 交接给下一任必须知道的红线

- **不声明** T26 认证通过 / T27 I 门禁通过 / 正式发布 / `IMPLEMENTED_WINDOWS_PENDING` 完成态 /
  `LOCAL_WORKSHOP_RELEASE_CANDIDATE`。
- **不把工坊面板设为产品默认 UI**；不做隐藏旧 App 冒充 Core 抽离；不用真实笔记/真实 APPDATA 测试。
- Windows 产品 W / I 证据**只能**在 Windows 产生；Linux/happy-dom 不得冒充。
- 不推送 master、不创建 Release（除非主理人另行明确授权）。
- 接口改动必须走 `WORKSHOP-INTERFACE-POLICY.md` 的 DoD，否则 DC-9 会失败。

## 6. 待办（按优先级）

| 优先级 | 事项 | 入口 |
| --- | --- | --- |
| P0 | **T27 I 门禁**：获得 Windows 10/11 VM（交互桌面+快照）→ 跑 U1–U6 + B 段 → 回传 windows-evidence | `reports/cloud-handoff/README.md` |
| P1 | **人工真实 IME / 多 DPI**（本机手工，非侵入） | `reports/MANUAL-IME-DPI-CHECKLIST.md` |
| P1 | 前端 UI Agent 接入（按接口级；它自己的 UI 不作为产品默认界面） | `reports/AGENT-FRONTEND-INTEGRATION-RUNBOOK.md` |
| P2 | F01–F16 guest 覆盖扩展（无受控协议的域需新协议评审） | `feature-baseline.csv` / `reports/TASK-STATUS-HANDOVER.md` |
| P2 | W07 三项已定稿设计限制（不计划修复，重启/卸载可恢复） | `HANDOVER-FINAL.md` §已知限制 |

## 7. 环境与工具备注（不可泄密项已省略）

- 主工作环境：WSL（`/mnt/f/Work/KE Project`）；Windows Python 3.14、Node 24、cargo 在 `F:\Work\Dev\cargo`；
- T27 就绪检查 `tools/run_t27_gate_check.py` 硬编码 Windows 路径（`F:\...`），仅 Windows 侧可跑；WSL 侧以
  `evidence/T27-gate-readiness.json` 为准（不代表结论变化）。
  隔离测试构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha 以证据文件为准）。
- 推送凭据：使用宿主 Windows 侧已登录的 `gh`（keyring），**仓库内无任何 token/私钥**；接手后如需推送请用
  自己的凭据，不要提交凭据。
- 大规模 W 探针必须串行、窗口独占、隔离 APPDATA/工作区；禁止 `taskkill /IM` 按镜像名杀进程。
- 测试数据仅在 `C:\ke-tmp` 下；清理只按白名单路径。

## 8. 下一任如何继续（建议顺序）

1. 读 `WORKSHOP-INTEGRATION-GUIDE.md`（接口）+ `reports/TASK-STATUS-HANDOVER.md`（状态）+ 本文件；
2. 按 `reports/HANDOVER-SNAPSHOT.md` §4 跑一遍快速验收（前端/后端/矩阵/一致性/交接脚本）；
3. 若有 Windows VM → 执行 T27 并回传；若没有 → 保持 NOT_RUN，不要降级声明；
4. 任何接口改动 → 按 POLICY DoD 更新并跑 DC-9；
5. 如需更多上下文：`progress.md`（全程进度）、`adr/`（决策）、`evidence/`（逐项证据）。

## 9. 我的交接声明

以上为**主 Agent 的正式交接**。仓库内所有结论均可追溯到 `evidence/` 或可复现命令；
未完成项已如实标注，不夸大、不隐藏。后续负责人可在此状态上继续推进，或以该状态交付。
