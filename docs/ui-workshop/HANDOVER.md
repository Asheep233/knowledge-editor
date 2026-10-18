# UI 工坊交接报告（当前真实状态版）

> 生成时间：2026-10-19 · 分支：`feat/ui-workshop`（**本地分支，未推送、未发布 Release**）
> 基线：v1.2.18 `4c71233` + 轻量外观 overlay `e54d37b`（overlay 已作为 P0 前置补丁提交）
> 本文件是**阶段性交接**：记录已完成/进行中/未开始、证据位置、复现方式、剩余风险与建议路线；
> 不代表工坊已可发布。最后一次刷新：2026-10-19（会话末段）。

## 1. 完成度口径（任务包要求）

| 候选状态 | 判定 | 说明 |
| --- | --- | --- |
| `P0_READY` | **✅ 成立（当前项目级状态）** | 五原型（S1/S1b/S2/S3/S4/S5）+ 运行域 ADR + P0 报告；Windows 实机证据齐全 |
| `IMPLEMENTED_WINDOWS_PENDING` | ❌ 未达 | 工坊能力未在产品 UX 完整落地（T14 EditorSession 接线、T16 打印产品接线、T19 guest 会话装配、T21/T23 Windows 端到端交互未做） |
| `EXPERIMENTAL_TRUSTED_PACKS` | ❌ 未达 | 可信包限定、guest 会话、签名/来源信任、真实安装交互未闭环 |
| `LOCAL_WORKSHOP_RELEASE_CANDIDATE` | ❌ 未达 | 无 P4/P5 集成、无安装包升级回滚演练、无 Windows 认证 |

- 内部阶段状态：P1 `P1_READY_PENDING`；P2 `in_progress`；P3 `EXPERIMENTAL_CORE_ONLY`。
- 详细判定与最短路径见 `reports/P2-P3-report.md`。

## 2. 任务状态总表（T00–T29）

| 任务 | 状态 | 主要证据 |
| --- | --- | --- |
| T00 脚本/测量/基线 | ✅ 交付（P0 报告口径 passed） | `evidence/T00-*`、`scripts/ui-workshop/*` |
| T01 功能矩阵/fixtures/失败台账 | ✅ passed | `feature-baseline.csv`（130 行映射）、`fixtures/`、`known-failures.md` |
| T02 S1 运行域/ACL/原生恢复 | 🟡 原型完成，产品化继续 | `P0-S1-prototype.md`（23/25）、`P0-S1b-windows-probe.md`（10/10） |
| T03 S2 持续编辑面 | 🟡 原型完成（10/10） | `P0-S2-prototype.md` |
| T04 S3 保存垂直切片 | 🟡 原型完成（双平台 10/10） | `P0-S3-prototype.md` |
| T05 S4 独立打印 | 🟡 原型完成（真实 PDF 6/6） | `P0-S4-prototype.md` |
| T06 S5 包/状态原子事务 | 🟡 原型完成（双平台 10/10） | `P0-S5-prototype.md` |
| T07 路线 ADR + P0 报告 | ✅ passed | `adr/ADR-001-runtime-route.md`、`reports/P0-report.md` |
| T08 文档 codec/保真边界 | ✅ passed | `T08-codec-probe{,2}.md`、`T08-roundtrip-ledger.md`、`core/codec/CANONICAL-RULES.md` |
| T09 WorkspaceContext/写入一致性 | 🟡 产品后端切片 | `P1-T09-workspace-context.md`、`P1-T09-product-slice.md` |
| T10 Core/SaveCoordinator | 🟡 核心+e2e 19/19 | `P1-T10-core-savecoordinator.md`、`P1-T10-e2e.md` |
| T11 类型化协议 | 🟡 契约+W 传输探针 7/7 | `P1-T11-protocol.md`、`P1-T11-transport-probe.md` |
| T12 分域迁移 | 🟡 只读域+写域切片 | `P1-T12-domain-migration-slice.md`、`P1-T12-write-domain-slice.md` |
| T13 Core 门槛 | 🟡 UI-free 21/21 + 单实例 W 6/6 | `P1-T13-core-gate.md`、`P1-T13-instance-probe.md` |
| T14 EditorSession/官方 shell | 🟡 适配层+Core 桥（e2e 11/11）+flag 接线+**产品 UI 保存 W 9/9（A8）**；切档/外部改盘专项/默认开启未做 | `P2-T14-product-adapter.md`、`P2-T14-core-save-bridge.md`、`P2-T14-editor-wiring.md` |
| T15 IME/焦点/缩放 | 🟡 CDP W 8/8；OS IME/多 DPI 未测 | `P2-T15-ime-zoom-probe.md` |
| T16 打印产品化 | 🟡 Job Core 12 例 + 产品管线；**真实产品壳多资源打印 W 9/9（A2）**；长文档分页/主题/打印 UI 未做 | `P2-T16-product-print.md`、`P5-T26-A2-print.md`、`P0-S4-prototype.md` |
| T17 包加载器 | 🟡 Core 14 例 + 产品 Rust 存储 | `P3-T17-pack-loader.md`、`P3-T21-product-pack-store.md` |
| T18 broker/能力隔离 | 🟡 Core 37 例 + W 恶意 guest 12/12 | `P3-T18-broker.md`、`P3-T18-broker-probe.md` |
| T19 包隔离宿主 | 🟡 W×3 原型 + **产品 A7/A5 guest 11/11（workshop 协议/能力上限/心跳崩溃/safeMode）**；SDK 协议线/真实 renderer crash 注入未接 | `P3-T19-package-host.md`、`P3-T19-package-host-probe.md`、`P3-T19-pack-entry-probe.md` |
| T20 原生恢复/启动 | 🟡 产品启动 recover+safeMode UI + 原型 W 9/9 + **产品级启动 recover/safeMode A3 W 9/9**；safeMode 阻断危险操作未做 | `P3-T20-startup-recover.md`、`P3-T20-startup-recover-probe.md`、`P5-T26-A3-recover.md` |
| T21 Windows 安装/升级/回滚 | 🟡 原型 W 20/20；产品命令+前端适配器/卸载；Windows E2E W 未做 | `P3-T21-pack-install-probe.md`、`P3-T21-product-pack-store.md` |
| T22 首次安装确认 | 🟡 Core 9 例；签名验证/来源信任未做 | `P3-T22-install-confirmation.md` |
| T23 工坊控制面 | 🟡 UI 骨架+flag 入口+全量回归绿；真实交互 W 未做 | `P3-T23-workshop-panel.md`、`P3-T23-workshop-integration.md` |
| T24 可信包限定 | 🟡 信任策略10+签名8+keyring8+信任UI+产品 Rust 验签+打包签名工具+**签名数据源贯通 UI**；正式发布密钥流程/Windows 验签 E2E 未做 | `P4-T24-trust-policy.md`、`P4-T24-pack-signature.md`、`P4-T24-trust-ui.md`、`P4-T24-keyring.md`、`P4-T24-rust-signature.md` |
| T25 平台验证矩阵 | 🟡 自动生成矩阵 18 行（9 W/2 A/2 A/U/3 回归/1 构建） | `P4-T25-validation-matrix.md`、`validation-matrix.csv` |
| T26 Windows 认证 | 🟡 **A1–A8 全部已过**（smoke 7/7、A2 9/9、A3 9/9、A4+A6 16/16、A5 UI 11/11、A7/A5 guest 11/11、A8 9/9、原型 13/13）；仅剩真实 IME/多 DPI、安装包升级/回滚演练 → 未最终认证；有事故记录（已恢复） | `P5-T26-windows-witnesses.md`、`T26-windows-acceptance-plan.md`、`P5-T26-isolated-smoke.md`、`P5-T26-A2-print.md` |
| T27–T29 | ⬜ 未开始 | 发布候选/最终交接（需主理人授权） |

## 2b. 安全与密钥流程

- 包签名：ed25519（TS/Rust/签名工具三语言 canonical parity 锁定）；私钥离线保管、公钥进产品信任根、
  轮换重叠期、吊销/过期与紧急响应流程见 `adr/ADR-003-pack-signing-key-lifecycle.md`。

## 3. 代码交付索引

**Core（前端，产品仓库内，无 DOM/React）**
- `frontend/src/core/session/`：SaveCoordinator/HttpTransport/RecoveryJournal/产品适配层（29 例单测）
- `frontend/src/core/protocol/`：类型化协议/契约/版本能力/wire 传输/背压（19 例）
- `frontend/src/core/broker/`：Broker 能力/epoch/命令白名单/有界代理 + Dispatcher 接线（18 例）
- `frontend/src/core/packs/`：manifest 校验/PackStore 事务/安装确认门禁/包隔离宿主/Tauri 适配器（+39 例）
- `frontend/src/core/print/`：快照打印 Job 队列/取消/超时（12 例）
- `frontend/src/components/workshop/`：WorkshopPanel/WorkshopEntry（工坊控制面 UI 骨架，flag 默认关闭）

**产品后端（Python）**
- `backend/app/services/context_registry.py` + `backend/app/routers/context.py`：`/api/context/*`
  （open/switch/current/close/lease/release/snapshot/write/request/tree/search/article-save）
- 契约显式更新：OpenAPI 51 路径 / 63 方法（`test_openapi_snapshot.py`、`test_trash_verify.py` 可审计）
- 后端全量：**846 collected（WSL 3.14 + Windows 3.10 全绿）**

**产品 Tauri（Rust）**
- `desktop/src-tauri/src/pack_store.rs`：产品包存储 8 命令（scan/install/list/verify/activate/rollback/
  recover/uninstall + recover_all）+ 启动 recover（`lib.rs` .setup）+ 5 个单测（cargo **34 passed**）
- 新增依赖：`sha2 = "0.10"`（仅包资产哈希）

**原型（工作区 `docs/ui-workshop/prototypes/`，用于 W 证据）**
- `p0/s1_runtime/`：迷你 Tauri app（S1/S1b/S2/S4/T11/T18/T21/T13 探针宿主）
- `p0/s2_editor/`、`s3_save/`、`s4_print/`、`s5_txn/`；探针运行器 `run_*.py`（Windows Python）

## 4. Windows/WebView2 W 证据索引（自动矩阵见 `validation-matrix.csv`）

| 探针 | 结果 | 命令 |
| --- | --- | --- |
| S1 iframe 运行域/ACL/Rust 恢复 | 23/25（2 发现约束） | `run_s1_probe.py` |
| S1b child WebviewWindow 对照 | 10/10 | `run_s1_windows_probe.py` |
| S2 持续编辑面换壳 | 10/10 | `run_s2_probe.py` |
| S4 独立打印真实 PDF | 6/6 | `run_s4_probe.py` |
| T11 协议传输（MessagePort 关键发现） | 7/7 | `run_protocol_probe.py` |
| T13 单实例/退出协调 | 6/6 | `run_instance_probe.py` |
| T15 IME/焦点/缩放（CDP） | 8/8 | `run_t15_cdp_probe.py` |
| T18 恶意/故障 guest Broker | 12/12 | `run_broker_probe.py` |
| T21 原生包存储（Windows 文件系统） | 20/20 | `run_pack_probe.py` |
| T20 启动恢复/safeMode（Windows 文件系统） | 9/9 | `run_startup_recover_probe.py` |
| T19 包隔离宿主（会话/崩溃/safeMode） | 8/8 | `run_t19_probe.py` |
| T19 已安装包 entry 真实资源 | 8/8 | `run_t19_entry_probe.py` |
| T19 多资源+心跳真实崩溃检测 | 8/8 | `run_t19_multiasset_probe.py` |

> 合计 **13 项 Windows/WebView2 探针**；一键复跑：`python docs/ui-workshop/tools/run_all_w_probes.py --check`
> （13/13 PASS，见 `P5-T26-windows-witnesses.md`）；静态矩阵 `validation-matrix.csv` 22 行 --check PASS。

> 所有探针使用**独立原型 identifier + 临时目录**，不触碰用户正在运行的 AstraNota（`D:\AstraNota`）
> 与真实笔记库；结果 JSON 均在 `docs/ui-workshop/evidence/`。

## 5. 复现与验证（从干净副本）

```bash
git checkout feat/ui-workshop   # 本地分支；HEAD 见 git log
# 1) 基线回归
cd frontend && npx tsc -b --noEmit && npx vitest run --maxWorkers=2   # 130 files / 1796 passed +1 skipped
cd ../backend && python3 -m pytest backend/tests -q                  # 846 collected
# 2) 产品 Tauri
cd desktop/src-tauri && cargo test --release                          # 34 passed
# 3) 原型 W 探针（Windows Python；先构建原型）
cd docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox && cargo build --release
python docs/ui-workshop/prototypes/p0/s1_runtime/run_broker_probe.py   # 等 12/12
# 4) T13 Core 门禁 / T10 e2e（WSL）
bash docs/ui-workshop/core/gate/run_t13_gate.sh                        # 21/21
bash docs/ui-workshop/core/session/run_t10_e2e.sh                      # 19/19
```

任务包验证：`python tools/verify_package.py`（任务包根）应 PASS；`--repo` 会报
`MIXED_OR_DIFFERENT_BASE`（预期，overlay 已移植 v1.2.18，见 `adr/ADR-000-baseline.md`）。

## 6. 剩余风险与限制（不冒充通过）

1. **未做真实 OS 中文 IME / 多 DPI / 失焦遮挡**：T15 仅 CDP 浏览器级模拟。
2. **产品 UX 未完整接入**：T14 EditorArea 保存接线、T16 打印产品接线、T19 guest WebView 会话装配
   未完成；工坊入口默认关闭（`VITE_KE_WORKSHOP`），旧 App 行为未改变（未隐藏旧 App/未冒充 Core）。
3. **Windows 端到端交互 W 缺失**：安装→启用→回滚→卸载、损坏包 safeMode 启动流程（T21/T26）。
4. 包签名/来源信任、包更新 UI、卸载后的附件/状态清理、safeMode 阻断危险操作未做。
5. T09 上下文注册表未持久化，既有业务端点仍用全局 workspace；T12 迁移只覆盖 tree/search/article-save 切片。
6. 大量证据为 A/U/B 级（真实后端/单测），已显式标注；不把它们当作 Windows 认证通过。

## 7. 建议的下一阶段路线（按优先级）

1. **T14 接线**（最高价值）：EditorArea 保存路径经 Core SaveCoordinator（feature flag + 回退），
   真实产品保存/切档/外部改盘回归 → P2 可判 `IMPLEMENTED_WINDOWS_PENDING` 候选。
2. **T16 产品接线**：隐藏 renderer + Rust PrintToPdf + 取消清理 + 打印 UI。
3. **T19 真实 guest 会话装配**（Broker/Dispatcher + 包入口 iframe + 崩溃信号）→ T18 产品会话。
4. **T21/T23 Windows 端到端交互 W**：隔离数据目录演练安装/启用/回滚/卸载 + 损坏包 safeMode。
5. **T24/T25**：可信包限定（已完成 Core 策略/签名验证/信任 UI，待真实密钥信任根 + Rust 验签 + Windows 演练）与平台验证矩阵（20 行，--check 门禁已接入）→ 之后才可能 `EXPERIMENTAL_TRUSTED_PACKS`。
6. **T26–T29**：Windows 认证、发布候选、最终交接（需主理人授权才可 Release）。

## 8. 约束遵守声明

- 未使用真实用户笔记做任何测试（全部临时工作区/沙箱；原型独立 identifier）。
- 未隐藏旧 App 来冒充 Core 抽离（所有工坊入口默认关闭；旧行为可通过 flag 回退）。
- 未把 happy-dom/Linux Chromium 结果当作 Windows/WebView2 证据（W 证据均来自本机 Windows 实机探针）。
- 分支仅本地：**未 push、未发布 Release**（本次会话未改 v1.2.18 发布物）。
