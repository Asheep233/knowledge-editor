# UI 工坊阶段交付报告：P0

- **阶段/完成状态：P0 / `P0_READY`**（原型结果与路线决策可复验；**不代表**完整工坊已实现/可发布）
- **代码基线**：分支 `feat/ui-workshop`（起点 v1.2.18 `4c71233` + overlay `e54d37b`）；本报告提交前 HEAD 见 git log
- **overlay SHA-256**：`cfaebc7ac59e42d91ca23dc1c05e17f94d3f38b596aac415ad80a6c1d75eaa92`（任务包 baseline/local-changes.patch）
- **复现实验环境**：Windows 11 + WebView2 155.0.0.0 + Tauri v2（本机）；Node 24.19 / Python 3.14 / cargo 1.97.1；
  WSL2 用于 Linux 侧逻辑测试；测试数据全部为临时目录/沙箱，**零用户笔记**
- **首版目标与此次实际范围**：验证「常驻官方编辑面 + 可替换周边 UI + 独立打印 + 包事务 + 原生恢复」的技术路线；
  未实现产品级工坊控制面/SDK/包运行时（P3–P4）

## 路线决策（详见 `docs/ui-workshop/adr/ADR-001-runtime-route.md`）

- 首发 shell 渲染域：**iframe + MessagePort，强制 opaque origin（sandbox 仅 allow-scripts）**；
  同源 iframe/同源 guest 窗口**已实证可调用全部 app 命令** → 禁止用于不受信包；
  后备路线：**独立来源 WebviewWindow**（默认 ACL 拒绝 app 命令，Windows 10/10 实证）。
- 官方编辑面：常驻主 webview 的矩形视口，**只移动 DOM 换壳**（view/history/undo/ime 路径保持，S2 实证）。
- 打印面：独立只读 renderer 窗口 + Rust `PrintToPdf`，打印指定快照（含未保存内容），不隐式保存（S4 实证）。
- 原生恢复：Rust `bootPending`/失败计数/safe mode/显式恢复（S1 实证），不依赖 guest JS。
- 包事务：不可变包目录 + journal + 单提交点 `active.json` + 崩溃恢复/回滚（S5 实证）。

## 本阶段交付

| 任务 ID | 产物/实现 | 验收 ID/证据 | 结果 |
| --- | --- | --- | --- |
| T00 | 测量底座：`scripts/ui-workshop/{sandbox-env,collect-env,bench}.*`、fixtures 生成器、`evidence/T00-*` | tsc 19.7s / build 21.9s / backend health 805ms；env 快照 | **passed** |
| T01 | `feature-baseline.csv`（130 行；F01–F16+W 全覆盖；hostService/hostCommand/officialPanel/workshopTaskId 映射）、`fixtures/`、`known-failures.md` | 列定义按 ACCEPTANCE B1；fixtures 清单 sha256 | **passed** |
| T02 | S1/S1b 原型：iframe opaque-origin、WebviewWindow 对照、命令面（whoami/unguarded/sensitive guard）、Rust 恢复 | `evidence/P0-S1-prototype.md`（23/25）、`P0-S1b-windows-probe.md`（**10/10**） | **原型完成**；产品化（精确 capability/自定义协议来源）in_progress |
| T03 | S2 原型：真实 WebView2 内换 shell 不重建 EditorView | `evidence/P0-S2-prototype.md`（**10/10**） | **原型完成**；产品 NodeView/MathLive/真实 IME in_progress |
| T04 | S3 原型：快照/CAS/切库隔离/崩溃恢复 | `evidence/P0-S3-prototype.md`（Linux+Windows **10/10**） | **原型完成**；真实后端接入 in_progress |
| T05 | S4 原型：独立 renderer + 真实 PDF | `evidence/P0-S4-prototype.md`（**6/6**，PDF 90,002B） | **原型完成**；T16 产品化 in_progress |
| T06 | S5 原型：包/私有状态原子事务 + 崩溃恢复/回滚 | `evidence/P0-S5-prototype.md`（Linux+Windows **10/10**） | **原型完成**；接入真实运行时 in_progress |
| T07 | 路线 ADR + 本 P0 报告 | `adr/ADR-001-runtime-route.md` | **passed** |

## 测试与回归（本基线实测）

| 命令/步骤 | 环境 | 结果 | 证据 |
| --- | --- | --- | --- |
| `npx tsc -b --noEmit` | WSL frontend | 0 错 | T00 台账 |
| `npx vitest run --maxWorkers=2` | WSL frontend | 108 files / 1617 passed + 1 skipped，exit 0 | evidence/T00-baseline.md |
| `pytest backend/tests -q` | WSL | exit 0 | evidence/T00-baseline.md |
| `run_s1_probe.py` | Windows/WebView2 | 23/25（2 项为发现约束） | P0-S1-probe-results.json |
| `run_s1_windows_probe.py` | Windows/WebView2 | **10/10** | P0-S1-windows-probe-results.json |
| `run_s2_probe.py` | Windows/WebView2 | **10/10** | P0-S2-probe-results.json |
| `run_s4_probe.py` | Windows/WebView2 | **6/6**（PyMuPDF 校验） | P0-S4-probe-results.json |
| S3/S5 pytest | Linux + Windows(NTFS) | 各 **10/10** | P0-S3/S5-prototype.md |

功能目录覆盖：矩阵 130 行 / F01–F16 + W 全覆盖；宿主服务/命令/官方入口映射 100%；
包 A/B 原生入口列留 T24 填写。平台 gate：S1/S2/S3/S4/S5 = **PASS（原型级）**；
产品级 Windows 验收（IME/真实产品 NodeViews/覆盖安装等）见下方待办。

## 已知问题与剩余工作

| ID | 症状/复现 | 归属 | 影响 | 阻塞 gate | 下一步 |
| --- | --- | --- | --- | --- | --- |
| GAP-01 | iframe 继承 Tauri globals；同源 iframe/窗口可调 app 命令 | 新发现（Tauri 行为） | 禁止同源 guest；需 broker 身份+守卫 | T18 | T18 实现 broker 连接身份与命令授权 |
| GAP-02 | command handler 内同步 `WebviewWindowBuilder::build()` 死锁 | 原型踩坑 | 窗口须 setup/主线程创建 | T20 | 产品壳按此实现 |
| GAP-03 | S2 未覆盖产品 React NodeView/MathLive/真实中文 IME/DPI | 原型限制 | T03/T15 未验收 | T15 | P2 实现后 Windows 实测 |
| GAP-04 | S4 快照未接真实 EditorSession revision；单页；未测隐藏窗口/长文档/附件 | 原型限制 | T16 未验收 | T16 | P2 产品化 |
| GAP-05 | S3 未接真实 FastAPI WorkspaceContext/幂等表 | 原型限制 | T09/T10 未完成 | T09/T10 | P1 实现 |
| GAP-06 | S5 未接真实运行时/Rust 指针/包格式 | 原型限制 | T17–T20 未完成 | T17–T20 | P3 实现 |
| GAP-07 | S1 的 WebSocket/下载隔离证据不充分 | 原型限制 | 离线/网络边界未认证 | T18 | 专用恶意包测试 |
| GAP-08 | 无真实中文 IME/多 DPI 实机矩阵 | 平台待办 | Windows gate 部分未验 | T15/T26 | 用户手工/自动化补测 |

## 从干净副本复验

1. `git checkout feat/ui-workshop`（本地分支）→ 确认 HEAD 与 `overlay` 状态；`python tools/verify_package.py`（任务包）应 PASS。
2. 基线：`frontend: npx tsc -b --noEmit`、`npx vitest run --maxWorkers=2`；`backend: pytest -q`。
3. 原型：`docs/ui-workshop/prototypes/p0/*/` 下按各 evidence 文档的命令复跑（Tauri 原型：
   `cargo build --release` → `run_s1_probe.py` / `run_s1_windows_probe.py` / `run_s2_probe.py` / `run_s4_probe.py`；
   纯 Python 原型：`pytest test_s3.py|test_s5.py` + `run_demo.py`）。
4. Windows 待验收操作与证据路径见各 evidence 文档「限制」段。

## 产物清单

- 任务包解压副本（工作区外）：`F:\Work\KE Project\taskpack-ui-workshop-2026-10-18\`
- 代码：overlay（e54d37b）+ T00/T01 工具与 fixtures + P0 原型（s1_runtime/s2_editor/s3_save/s4_print/s5_txn）
- 文档：`docs/ui-workshop/progress.md`、`feature-baseline.csv`、`known-failures.md`、`adr/ADR-000/001`、`evidence/*`、本报告
- 证据：Windows 实机结果 JSON（S1/S1b/S2/S4）、双平台 pytest 输出；截图/日志由原型临时目录生成（不入库）

## 下阶段交接

- **当前可继续**：T08（文档 codec 边界）→ T09（WorkspaceContext/写入一致性）→ T10（常驻 Core/SaveCoordinator）→
  T11（协议）→ T12（分域迁移）→ T13（Core 门槛）。T02/T03/T04/T05/T06 的「产品化收尾」分别并入 P1–P3 对应任务。
- **必须先满足的 gate**：T18（broker/隔离）依赖 T11/T13 契约；T16 打印产品化依赖 T10/T14；T21/T26 Windows 认证依赖各产品化任务。
- **未决架构点**：guest 包离线资源来源（自定义协议 vs 本地 HTTP origin）在 T17/T18 定型；若自定义协议在目标 WebView2
  不可用，按 ADR-001 后备路线切换并更新 ADR。
