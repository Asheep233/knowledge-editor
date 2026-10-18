# UI 创意工坊实施进度与证据台账

> 任务包：`astranota-ui-workshop-taskpack-2026-10-18`（sha256 zip `09969e62…52fa`，自校验 PASS）。
> 状态词：`todo / in_progress / passed / failed / blocked / deferred`；验收结果另用 `PASS / FAIL / BLOCKED / NOT_RUN / NOT_APPLICABLE`。

## 当前接手点

```text
日期/时区：2026-10-19 01:00 (Asia/Shanghai)
仓库/分支：knowledge-editor / feat/ui-workshop（基于 master v1.2.18）
HEAD（分支起点）：4c71233（v1.2.18）；overlay 提交：e54d37b
overlay patch SHA-256 / 状态：cfaebc7ac59e42d91ca23dc1c05e17f94d3f38b596aac415ad80a6c1d75eaa92 / APPLIED（README 手合并 3 行）
未提交改动摘要：无
基线差异：任务包基线 v1.2.16（9dd19e7）→ 实施基线 v1.2.18（4c71233，领先 18 提交）；
  verify_package 对原仓库报告 MIXED_OR_DIFFERENT_BASE；补丁对当前 HEAD 自动应用通过（README 除外）。
  v1.2.17（审查修复）/v1.2.18（导出回归修复）全部保留；参考报告中的 v1.2.16 数字仅作参考，
  所有验收在本基线上重跑。
OS / Node / Python / Rust / Tauri / WebView2：
  Windows 11 + WSL2（Ubuntu）；Node 24.19.0（CI 用 22，需在 lockfile/npm ci 上复核）；Python 3.14.4；
  cargo 1.97.1；Tauri v2 + WebView2 已在本机完成 v1.2.17/18 真机/安装包验收（W/I 证据可执行）。
Windows 实机可用性：可用（本机；通过 CDP/安装包实测过 v1.2.17、v1.2.18）。
本轮基线命令与结果（2026-10-19）：
  - frontend: npx tsc -b --noEmit → 0 错
  - frontend: npx vitest run --maxWorkers=2 → 108 files / 1617 passed + 1 skipped，exit 0
  - backend:  python3 -m pytest backend/tests -q → exit 0（全绿；数量见 evidence/T00-baseline.md）
已知失败归属：无新增；历史 v1.2.16 报告中「3 个 Linux 超长文件名失败」在当前基线未复现
  （参见 CHANGELOG_DEV v1.2.17：已随 CI 可移植性修复收敛）。
测试数据目录：临时目录/沙箱（C:\ke-tmp\ke-sandbox 等）；禁止真实笔记。
当前里程碑状态：**P0_READY**（T00/T01/T07 完成；S1–S5 原型与路由 ADR 已交付；T02–T06 产品化在 P1–P3 收尾）
```

## 任务进度

| Task ID | 状态 | 实现提交/文件 | 验收 ID 与证据 | 剩余问题 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| T00 | in_progress | e54d37b（overlay）、scripts/ui-workshop/{sandbox-env,collect-env,bench}.sh/ps1、docs/ui-workshop/fixtures/、tools/make_fixtures.py | evidence/T00-baseline.md、evidence/T00-measurements.md、evidence/env-*.txt | 两 shell 预热/内存/切换、Windows 侧启动与 PDF 基线尚未采集 | Windows 测量脚本 + 数据采集 |
| T01 | passed | tools/build_feature_baseline.py、feature-baseline.csv（130 行，含 hostService/hostCommand/officialPanel/workshopTaskId 映射）、fixtures/、known-failures.md | 源码自动生成 + F01–F16/W 全覆盖映射；fixtures（basic/256KB/512KB/附件）已就绪 | 逐项「真实入口核对」结果列留 T12/T26 验收轮填写（不属于 T01 交付定义） | — |
| T02–T06 | in_progress | T02: s1_runtime/；T03: s2_editor/；T04: s3_save/；T05: s4_print/ + s1_runtime/print_proto.rs；T06: s5_txn/ | evidence/P0-S1-prototype.md（iframe 23/25）、P0-S1b-windows-probe.md（child WebviewWindow **10/10**）、P0-S2-prototype.md（WebView2 换壳 **10/10**）、P0-S4-prototype.md（WebView2 真实 PDF **6/6**）、S3/S5 双平台 10/10 | T02 尚缺 capability 文件级 scoping/自定义协议来源；T03 未覆盖产品 NodeView/MathLive/真实 IME；T05 未接真实 session revision/隐藏窗口/长文档；T04/T06 未接入真实后端/运行时 | capability scoping + 自定义协议来源；S2/S4；T07 ADR |
| T07 | passed | adr/ADR-001-runtime-route.md、reports/P0-report.md | S1/S1b/S2/S3/S4/S5 原型 + Windows 证据已写入 ADR；P0_READY 里程碑见 P0 报告 | T02–T06 产品化收尾（capability/NodeView/真实后端/打印产品化）在 P1–P3 继续 | 进入 P1（T08→T09→T10） |
| T08 | passed | core/codec/probe{,2,3}.ts + run_probe*.sh + CANONICAL-RULES.md | probe2（10 类扩展无 DOM 分层，全部可 parse/serialize）；probe3（8 样本保存管线 roundtrip 台账：声明 R1–R6 后 **fixpoint2 8/8 字节稳定**；ke 标记保留、BOM/CRLF 还原）；DOM-free API 边界已明确 | 唯一性细节（如首次空行归并）已按声明规范处理；真实 UI 行为一致性留 T26 复核 | T10 Core 直接引用 ke.ts traits + serializer 边界 |
| T09 | in_progress | 原型 core/workspace_context/；**产品切片** backend/app/services/context_registry.py + routers/context.py + tests/test_ui_workshop_context.py + 契约快照更新 | evidence/P1-T09-workspace-context.md（原型双平台 10/10）、P1-T09-product-slice.md（产品后端 8 例 + 全量 835 collected exit 0，WSL/Windows） | 注册表内存态；既有业务端点仍全局 workspace_root 未绑定；附件/导入/恢复/打印 job 绑定与真实慢 I/O in-flight 查询留 T12/T10 | T12 分域迁移统一 ContextRegistry + T10 Core 接入 |
| T10 | in_progress | frontend/src/core/session/{types,saveCoordinator,memoryTransport,httpTransport,recoveryJournal,+3 测试} | evidence/P1-T10-core-savecoordinator.md（21 例 U + tsc 0 + 无 DOM/React 守卫；HTTP 映射/恢复日志/崩溃恢复） | 真实 HTTP 端到端联调未跑；产品 RecoveryStorage（Tauri 文件/IndexedDB）未实现；真实加载切换接线/索引 history 绑定未完成（T14/T15/T12） | e2e 联调 T09 + 产品 RecoveryStorage → T11 协议 |
| T08–T28 | todo | | | | 按 TASKS.md 依赖推进 |

## 单项验收记录

（格式见任务包 REPORT_TEMPLATE.md；随任务推进追加）

## 路线 ADR

见 `docs/ui-workshop/adr/`；已记录 ADR-000（实施基线选择）。

## 本轮交付（2026-10-19，T00/T01 种子）

- `scripts/ui-workshop/sandbox-env.sh|.ps1`：隔离测试数据目录（KE_WORKSPACE/KE_APP_CONFIG/LEGACY/WebView2 user data）
- `scripts/ui-workshop/collect-env.sh` → `evidence/env-*.txt`：环境快照
- `scripts/ui-workshop/bench.sh` → `evidence/T00-measurements.md`：
  tsc 19.7s / build 21.9s（dist-build 2,830,583 B）/ backend health 805ms（隔离目录）
- `docs/ui-workshop/tools/make_fixtures.py` → `fixtures/`：basic.md、large-256kb.md、
  large-512kb.md、附件占位、fixtures-manifest.json（5 files，确定性可复现）
- `docs/ui-workshop/tools/build_feature_baseline.py` → `feature-baseline.csv`：
  130 行种子（快捷键动作 42 / API 路由 / 工具栏 / 设置 / 原生菜单 / 导出与对话框 / F01–F16+W 验收域）
- `docs/ui-workshop/known-failures.md`：当前无新增失败；历史 3 条登记且本基线未复现

## P0 原型进展（2026-10-19）

- **S5 包/私有状态原子事务（T06 部分）**：`prototypes/p0/s5_txn/` 完成不可变安装
  （路径穿越/zip bomb/篡改/同版本改字节拒绝）、单提交点激活（journal→fsync→os.replace）、
  崩溃恢复（4 个提交点进程终止用例）、回滚不动 Core 笔记、私有状态隔离与迁移回调；
  Linux WSL + Windows Python(NTFS) 各 10/10 通过。证据：`evidence/P0-S5-prototype.md`。
  未验证：真实运行时/包格式/Tauri/Rust 指针（留给 T17–T20）。

## P0 原型进展（续 2026-10-19）

- **S3 保存垂直切片（T04 部分）**：`prototypes/p0/s3_save/` 完成
  可信快照（全文+revision+磁盘指纹）→ 保存三阶段（accepted/recovery_durable/file_durable）→
  revision CAS、外部改盘冲突、切库 epoch 迟到写拒绝、两工作区同相对路径隔离、
  requestId 幂等 + queryResult、崩溃三阶段恢复（恢复日志后/正文写入后/提交后）且
  恢复不覆盖外部新内容；Linux WSL + Windows Python(NTFS) 各 10/10 通过。
  证据：`evidence/P0-S3-prototype.md`。未验证：真实 FastAPI/WorkspaceContext（T09）、
  真实 Core 与 UI 网络时序（T10/W02）。

## P0 原型进展（S1 实机，2026-10-19）

- **S1 运行域/命令面/原生恢复（T02 部分，Windows/WebView2 实机）**：
  迷你 Tauri 原型（独立 identifier）验证：sandbox iframe（opaque origin）无法访问宿主 DOM、无法导航顶层、
  无法跨源 fetch 后端/宿主、写请求无副作用；**opaque origin 的 Tauri invoke 被拒**（`Origin header is not a valid URL`）。
  **发现**：iframe 继承宿主 Tauri 初始化脚本（`__TAURI_INTERNALS__`/`__TAURI__` 可见），且
  `allow-same-origin` 同源对照 iframe 的 invoke **成功** → 隔离边界是 Origin，iframe 不能当安全边界。
  Rust 原生恢复状态机实测：坏启动崩溃 ×2 → safe mode（Rust 写状态）→ 显式恢复，真实进程 `exit 99` 驱动。
  证据：`evidence/P0-S1-prototype.md` + `P0-S1-probe-results.json`。
  下一步：child WebviewWindow + capability/ACL 精确匹配原型（T02b），再决定 iframe/独立窗口路线（T07 ADR）。

## P0 原型进展（S1b child WebviewWindow，2026-10-19）

- **S1b（T02 续，Windows/WebView2 实机 10/10）**：child WebviewWindow 对照实验：
  - 同源 guest 窗口（http://tauri.localhost）：app 命令全局可达（whoami 返回 guest label；未守卫写命令成功）
    → 证明 **app 命令默认对所有 webview 可见**；label 守卫命令被拒（防御原型生效）；
    且同源 guest 可**直连后端 loopback**（`ok:200`）→ 同源包运行域不可用于不受信包；
  - 独立来源 guest 窗口（http://127.0.0.1:8123）：Tauri ACL 拒绝 app 命令（`Command ... not allowed by ACL`）、
    后端 CORS 拒绝 loopback（`blocked:TypeError`）、零副作用 → **独立来源窗口具备默认 IPC 隔离**；
  - 工程坑记录：command handler 内同步 `WebviewWindowBuilder::build()` 会死锁，窗口须在 Rust setup/主线程创建。
  证据：`evidence/P0-S1b-windows-probe.md` + `P0-S1-windows-probe-results.json`。
  下一步：capability 文件级 scoping + 自定义协议来源（离线包）实验，随后 T07 ADR 定运行域。

## P0 原型进展（S2 持续编辑面，2026-10-19）

- **S2（T03 部分，WebView2 实机 10/10）**：`s2_editor/harness.ts` 在真实 WebView2 内创建单个 Tiptap Editor，
  挂 shell A → 编辑/记录 → **只移动 view.dom** 到 shell B → 断言 view/DOM 身份、正文、undo/redo、焦点、
  synthetic composition、源码草稿保持；再移回 shell A 二次断言。结果经 Tauri `report_results` 落盘。
  证据：`evidence/P0-S2-prototype.md` + `P0-S2-probe-results.json`。
  限制：最小 StarterKit、无产品 React NodeViews/MathLive、synthetic IME、两 shell 为 vanilla 容器（真实两框架 T24）。

## P0 原型进展（S4 独立打印，2026-10-19）

- **S4（T05 部分，Windows/WebView2 真实 PDF 6/6）**：`print_proto.rs`（产品 print.rs 简化移植：对指定
  renderer 窗口 PrintToPdf）+ `s4_print/harness.ts`（内存 session 快照 → 只读 HTML：未保存标记/
  KaTeX 行内+根号公式/表格）→ 真实 PDF **90,002 B / 1 页**，PyMuPDF 文本校验含 `UNSAVED-SNAPSHOT-MARK`
  与公式排版文本；打印**不隐式保存**（临时源笔记 sha256 不变），输出在系统临时目录。
  证据：`evidence/P0-S4-prototype.md` + `P0-S4-probe-results.json`。
  限制：快照未接真实 EditorSession revision、单页、未测隐藏窗口/长文档/图片附件/主题，留 T16。
- **P0 五原型全部完成**（S1/S1b 运行域+恢复、S2 持续编辑面、S3 保存垂直切片、S4 独立打印、S5 事务）。
  下一步：**T07 路线 ADR + P0 阶段报告**，然后进入 P1（T08 codec → T09 WorkspaceContext → T10 Core）。

## P0 收口（2026-10-19）

- **T07 通过**：`adr/ADR-001-runtime-route.md` 基于 3 组 Windows/WebView2 实机原型给出路线：
  首发 **iframe+MessagePort（强制 opaque origin）** 作为 shell 渲染域 + 独立来源 WebviewWindow 后备；
  编辑面常驻主 webview（只移动 DOM）；打印面独立 renderer + Rust PrintToPdf；Rust 原生恢复；S5 单提交点事务。
- **T01 通过**：feature-baseline.csv 130 行，F01–F16 + W 验收域全覆盖，并补齐 hostService/hostCommand/
  officialPanel/workshopTaskId 映射与 fixtures/失败台账（逐项结果列留 T12/T26 验收轮）。
- **P0 阶段报告**：`reports/P0-report.md`（状态 **P0_READY**；交付清单、Windows 证据、限制与下一阶段任务）。
- 下一阶段：P1（T08 文档 codec → T09 WorkspaceContext/CAS → T10 Core/SaveCoordinator → T11 协议 → T12 分域迁移 → T13 Core 门槛）。

## P1 进度（T08 起步，2026-10-19）

- T08 探针：纯 Node（无 DOM）跑 `@tiptap/markdown` parse→serialize：
  basic/list/CRLF 可无 DOM 运行；table 链抛 `window` 缺失；frontmatter/未知 ke-* /原始 HTML 需 product 扩展
  （本探针仅 StarterKit 被转义/规范化）。证据 `evidence/T08-codec-probe.md` + `.json`。
- 下一步：把 product 扩展按「可直接无 DOM / 需 shim / 必须 UI」分层，建 fixtures roundtrip 字节台账，
  提取 frontmatter/BOM/CRLF/未知标记的纯函数边界。

## P1 进度（T08 阶段二，2026-10-19）

- product 扩展 DOM 依赖分层完成：纯 Node 下 10 类结构（KeDocument/列表/数学/信息块/脚注/表格/未知 ke-*/
  HTML/附件视频模块/图片）均可 import+parse+serialize；关键前提：esbuild `--jsx=automatic`、显式基础表格节点、
  headless Editor 不创建 view（NodeView 不执行）。结论：codec 与 UI（React NodeView/KaTeX/MathLive）可解耦。
- 已识别 canonical 化差异（需在 T08 台账声明）：括号有序列表 → `.`；GFM 表格单元格对齐空格与前导换行。
- 证据：`evidence/T08-codec-probe2.md` + `.json`。下一步：fixtures 跑 product 保存管线 roundtrip 字节台账；
  frontmatter/BOM/CRLF/未知标记纯函数边界提取。

## P1 进度（T08 完成，2026-10-19）

- T08 passed：
  - `core/codec/probe2.ts`：product 扩展 10 类结构纯 Node 无 DOM 可 import+parse+serialize（前提：
    esbuild `--jsx=automatic`、显式 @tiptap/extension-table* 基础节点、headless 不创建 view）。
  - `core/codec/probe3.ts`：镜像产品 WYSIWYG 保存链，对 8 样本（fixtures + CRLF/BOM/自定义 frontmatter/
    未知 ke/公式）建立字节台账；声明 canonical 规则 R1–R6（`CANONICAL-RULES.md`），实测
    **fixpoint2 8/8 为 true**（第二次保存起 save→save 字节稳定），未知标记保留、BOM/CRLF 还原。
  - DOM-free 边界：`editor/ke.ts` traits 纯函数可直接提取；`setContent(md)` 需 DOM（Core 内用构造函数/
    MarkdownManager）；空 mathBlock 清理归 EditorSession/SaveCoordinator。
  - 证据：`evidence/T08-codec-probe{,2}.md`、`T08-roundtrip-ledger.md/.json`、`core/codec/CANONICAL-RULES.md`。
- 下一步：T09（真实 FastAPI WorkspaceContext/租约/幂等/CAS）→ T10（常驻 Core/SaveCoordinator）。

## P1 进度（T09 原型，2026-10-19）

- T09 原型：独立 FastAPI `core/workspace_context/` 验证 context/epoch、租约排空、快照+revision CAS、
  磁盘指纹外部冲突、requestId 幂等与 in_flight/completed 结果查询、后台任务绑定上下文、切库屏障
  （accepted 写入在提交前发现 epoch 失效则不落盘）；Linux WSL + Windows Py3.10 各 **10/10**。
  证据：`evidence/P1-T09-workspace-context.md`。
- 下一步：T09 产品化移植（backend/app 的 WorkspaceContext 生命周期/路由屏障/附件导入恢复打印绑定），
  与 T10 Core/SaveCoordinator 合流；补既有后端测试与 API 快照。

## P1 进度（T09 产品纵向切片，2026-10-19）

- 产品后端增量落地：`backend/app/services/context_registry.py` + `backend/app/routers/context.py`
  新增 `/api/context/*` 9 端点（open/switch/current/close/lease/release/snapshot/write/request），
  实现 context/epoch、服务端租约排空、快照+revision CAS、磁盘指纹外部冲突、requestId 幂等与结果查询、
  路径穿越防护；既有端点行为未改。
- 契约显式更新（只做加法）：OpenAPI 快照 39→48 路径 / 51→60 方法 / +6 schema；
  trash 契约完整性测试新增 WORKSHOP_CONTEXT_PATHS/SCHEMAS 常量（既有 frozen 断言未弱化）。
- 测试：新 8 例全过；后端全量 WSL 835 collected exit 0、Windows Py3.10 exit 0。
  证据：`evidence/P1-T09-product-slice.md`。
- 下一步：T10 Core/SaveCoordinator（前端侧快照/保存/切库/迟到响应）接入这些端点；
  T12 把既有业务端点/后台任务逐步绑定 ContextRegistry。

## P1 进度（T10 起步，2026-10-19）

- 新增产品 Core 会话层 `frontend/src/core/session/`（无 React/DOM）：
  - `SaveCoordinator`：可信快照 (context/epoch/relPath/revision/diskHash) 绑定、O(1) 标脏、
    save 结果三阶段（accepted/recovery_durable/file_durable，仅 file_durable 才 saved）、
    abort/超时后 `reconcile` 查真实结果、切库后旧 epoch 迟到响应丢弃、revision/外部冲突状态；
  - `types.ts` 类型化边界 + `memoryTransport.ts` 故障注入替身 + 9 例 vitest；tsc 0；源码守卫证明无 DOM/React。
  证据：`evidence/P1-T10-core-savecoordinator.md`。
- 下一步：真实 HTTP Transport 对接 T09 `/api/context/*` 联调；恢复点/日志持久化与 recovery_durable 真实判定；
  再进入 T11 类型化协议契约。

## P1 进度（T10 续，2026-10-19）

- Core 会话层补齐：
  - `httpTransport.ts`：对接 T09 `/api/context/*` 的真实 HTTP Transport（completed/409 epoch→stale/
    409→conflict/非 2xx 抛错/query 404→null/超时 abort），单测覆盖映射；
  - `recoveryJournal.ts`：恢复日志（begin 持久化、file_durable 后 commit、崩溃后 load 恢复、损坏不阻断），
    注入式 RecoveryStorage（测试内存实现）；与 SaveCoordinator 集成（保存成功提交、abort 保留）；
  - 会话层测试 3 文件 **21 例全过**，tsc 0，源码守卫 5 文件无 DOM/React。
  证据：`evidence/P1-T10-core-savecoordinator.md`。
- 下一步：真实 HTTP 端到端联调（Node ↔ uvicorn T09 端点）+ 产品 RecoveryStorage（Tauri 文件）
  → T11 类型化协议契约。
