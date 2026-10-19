# UI 创意工坊实施进度与证据台账

> 任务包：`astranota-ui-workshop-taskpack-2026-10-18`（sha256 zip `09969e62…52fa`，自校验 PASS）。
> 状态词：`todo / in_progress / passed / failed / blocked / deferred`；验收结果另用 `PASS / FAIL / BLOCKED / NOT_RUN / NOT_APPLICABLE`。
>
> ⚠️ **本文件是逐任务台账（按时间顺序追加，保留历史表述）——最终交付状态以
> [`HANDOVER-FINAL.md`](HANDOVER-FINAL.md) + [`reports/FINAL-DELIVERY-STATUS.md`](reports/FINAL-DELIVERY-STATUS.md)
> 为准。** 下方「当前接手点」与任务表为会话起点快照（2026-10-19 01:00），其中里程碑/回归数字已被
> 后续证据取代（当前里程碑 = `EXPERIMENTAL_TRUSTED_PACKS`，见 `reports/milestone-assessment.md`）。

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
当前里程碑状态（2026-10-19 交付整理更新）：**`EXPERIMENTAL_TRUSTED_PACKS`**（ACCEPTANCE A 节，见 `reports/milestone-assessment.md`）；
  本块其余回归数字为会话起点（01:00）快照，历史参考，不用于对外表述（最新基线见 `HANDOVER-FINAL.md`）。
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
| T10 | in_progress | frontend/src/core/session/*；联调 core/session/e2e_t10.ts + run_t10_e2e.sh | evidence/P1-T10-core-savecoordinator.md（21 例 U + tsc 0 + 无 DOM/React 守卫）、**P1-T10-e2e.md（真实后端 19/19 PASS）** | 产品 RecoveryStorage（Tauri 文件/IndexedDB）未实现；真实 UI 加载/切换接线、慢 I/O in-flight、索引 history 绑定未完成（T14/T15/T12） | 产品 RecoveryStorage + T11 协议 |
| T11 | in_progress | frontend/src/core/protocol/{types,channel,transport,+tests}；probe/* + s1 原型 protocol 场景 | evidence/P1-T11-protocol.md（**18 例**：契约/传输/大消息/channel 隔离/背压 E_BUSY）、P1-T11-transport-probe.md（Windows/WebView2 **7/7**） | iframe 浏览器 DOM 适配器未入包（探针 ad-hoc，归 T17）；事件背压未做；P3 包命令未入方法表 | T17 包加载器接入正式 iframeAdapter → T12 分域迁移 |
| T17 | in_progress | core/packs/* + 产品 pack_store 安装/验签/read_asset/session 状态 | P3-T17-pack-loader.md（14）、P4-T24 签名/信任链、P3-T17-pack-asset-command、**P3-T19-product-host-adapter（session 命令 + 适配器 U）** | 产品 iframe 心跳宿主组件/启用停用 UI/A7·A5 W；zip 离线包；首次安装确认 UI | 宿主组件 → A7/A5 W |
| T18 | in_progress | frontend/src/core/broker/{broker,binding,+2 tests}；protocol command.invoke；probe/* + s1 原型 broker 场景 | evidence/P3-T18-broker.md（**37 例**：broker 9+binding 9+protocol 19）、**P3-T18-broker-probe.md（Windows/WebView2 12/12）** | 真实产品 guest 连接建立/产品壳接线；三档授权 UI（T22）；后端写口来源收紧端到端 | 产品 guest 连接接线 + T22 授权 UI → T21 Windows 包安装 |
| T21 | in_progress | 原型 pack_store_proto.rs+probe（W 20/20）；产品壳 pack_store.rs（scan/install/list/verify/activate/rollback/recover/**uninstall**）+ 命令注册 + Rust 测试；前端适配器/UI 集成 | evidence/P3-T21-pack-install-probe.md（W 20/20）、P3-T21-product-pack-store.md（**cargo 34/34 + release 构建**）、P3-T23-workshop-integration.md | 签名校验；Windows 端到端交互 W（安装→启用→回滚→卸载）；升级 UI；与 T20 启动恢复合并 | Windows E2E W → T21/T26 |
| T12 | in_progress | backend: context_registry tree/search/save_article + routers/context.py + 2 test files | evidence/P1-T12-domain-migration-slice.md（只读域 5 例）、**P1-T12-write-domain-slice.md（写域 6 例 + 契约 51 路径/63 方法 + 全量 846 collected 双平台绿）** | 重命名/删除/附件/导入导出/print job 未绑定；真实 store/indexer/history/watcher 未迁移；前端未切换调用 | 其余写域 + 真实 store 迁移 → T14 接线 |
| T13 | in_progress | core/gate/t13_gate.ts + run_t13_gate.sh；SaveCoordinator 恢复日志修复 | **P1-T13-core-gate.md（UI-free 门禁 21/21 PASS）**、**P1-T13-instance-probe.md（Windows 单实例/退出协调 6/6）** | 打印 job（T16）、Rust 原生恢复（T20）未覆盖；产品工作区打开流程合并验证待做 | 补打印/Rust 恢复项 → P1 阶段报告 |
| T14 | in_progress | core/session/* + EditorArea flag 分支 + e2e；base URL 修复；上下文写 frontmatter merge（后端） | product-adapter（6）、core-save-bridge（8+e2e 11/11）、editor-wiring、byte-consistency（12/12）、**A8 产品 UI 保存 W 9/9（autosave→/api/context/write、frontmatter 保留）** | 切档/外部改盘/恢复点专项；Windows 实机字节回归；默认开启评估 | 切档/外部改盘专项 → 默认开启评估 |
| T15 | in_progress | s2 harness __s2 + tauri capabilities + run_t15_cdp_probe.py | **evidence/P2-T15-ime-zoom-probe.md（Windows/WebView2 CDP 8/8）** | 真实 OS 中文 IME/多 DPI 拖拽/失焦遮挡未测；产品 EditorSession 接线后需回归 | 真实 IME/DPI 矩阵补测 + T14 接线回归 |
| T16 | in_progress | core/print/*；产品 print_snapshot.rs（隐藏 renderer + PrintToPdf + **ready 握手/超时兜底**）；public/print-render.html | P2-T16-print-core.md（12 例）、S4 W 6/6、**P2-T16-product-print.md（管线 + ready 握手；cargo 38、前端 130 files/1795 passed）** | Windows 端到端 W（隔离安装）；长文档分页/主题/源码；打印 UI 与取消清理；握手运行时验证 | 隔离安装 W + 打印 UI → T26 |
| T22 | in_progress | frontend/src/core/packs/{installPolicy,installPolicy.test} | evidence/P3-T22-install-confirmation.md（9 例 U：预览/风险/签名阻止/显式确认门禁/一次性 token/过期/一致性；packs 共 23 例） | 工坊控制面 UI（T23）；真实下载/签名验证；来源信任持久化；Windows W 交互 | T23 工坊控制面 UI + 签名验证 → T21/T26 W |
| T23 | in_progress | components/workshop/{WorkshopPanel,WorkshopEntry,+tests}；core/packs/{tauriPackAdapter,localTrustStore}；App flag 入口 | P3-T23-workshop-panel.md（7 例）、P3-T23-workshop-integration.md（适配器 6 例+入口 3 例）、**P4-T24-trust-ui.md（信任/签名徽章+授予/撤销；全量 128 files/1783 passed）** | 真实签名数据源；Windows 端到端交互 W；启动 recover 合并；卸载后清理 | Windows E2E W + 签名数据源 → T21/T26 |
| T20 | in_progress | desktop pack_store recover_all + lib.rs setup 启动恢复 + 状态文件/事件；adapter dialog；safeMode UI；原型 seed/recover 探针 | P3-T20-startup-recover.md（cargo 33/33）、**P3-T20-startup-recover-probe.md（Windows 启动恢复 W 9/9）** | 产品安装目录端到端 W 未做；safeMode 未阻断危险操作；与单实例/退出协调合并；卸载清理 | 产品目录端到端 W + safeMode 阻断策略 → T26 |
| T19 | in_progress | core/packs/* + 产品 read_asset/session/**workshop 协议** + host adapter + guestHost + UI | U 证据 + **P5-T26-A7-A5-guest（W 11/11：真实入口/能力上限/心跳崩溃/safeMode/停用持久化）** | broker dispatcher 完整协议线/SDK 打包；真实 renderer crash 注入；zip 离线包 | SDK 协议线 + 子资源 → T26 |
| T24 | in_progress | core/packs/* + 工坊信任 UI + 产品 Rust 验签 + 打包器签名工具 + **签名数据源接线（list/scan→UI）** | trust-policy（10）、pack-signature（8+parity）、trust-ui、keyring（8）、rust-signature（cargo 38/38）、sign-tool（5/5）、**signature-datasource（列表/预览真实签名状态；全量 130 files/1795 passed）** | 正式发布密钥流程；Windows 验签安装 E2E；非 active 版本签名/审计 | 发布密钥流程 + Windows 验签 E2E → T26 |
| T25 | in_progress | docs/ui-workshop/tools/build_validation_matrix.py；validation-matrix.csv（18 行） | evidence/P4-T25-validation-matrix.md（自动生成矩阵：9 项 W、2 项 A、2 项 A/U、3 项回归基线、1 项构建） | 产品 E2E W/真实 IME/多 DPI 列未加入；CI 门禁化；随 T26 补平台版本列 | 矩阵 CI 门禁 + T26 认证数据 → 发布候选评估 |
| T26 | in_progress | run_all_w_probes.py、T26 计划、隔离构建工具、A2–A8 产品 W 探针（含 **A7/A5 guest 11/11**） | P5-T26-windows-witnesses（13/13）、smoke（7/7）、A2（9/9）、A3（9/9）、A4+A6（16/16）、A5 UI（11/11）、**A8 尝试 6/8（CDP 输入不触发编辑器脏标记，未通过，记录限制）** | 真实 IME/多 DPI、安装包升级/回滚、切档/外部改盘专项；SDK 协议线 | IME/DPI + 升级演练 → 认证 |
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

## P1 进度（T10 端到端联调，2026-10-19）

- **T10 e2e 19/19 PASS**：真实隔离 uvicorn（产品后端 T09 `/api/context/*`）+ Node Core
  SaveCoordinator/HttpTransport/RecoveryJournal 真实保存链：workspace/context 打开、两次保存落盘、
  journal 提交、requestId 结果查询、revision CAS 冲突、切库旧 epoch stale 不落盘、新 epoch 保存、
  外部改盘 conflict_external 不覆盖。证据：`evidence/P1-T10-e2e.md` + `T10-e2e-results.json`。
- 说明：后端跑 WSL Linux（A 证据，非 Windows/WebView2 W 证据）；产品 RecoveryStorage、真实 UI 接线留后续。
- 下一步：T11 类型化协议契约（host↔guest），然后 T12 分域迁移。

## P1 进度（T11 协议契约，2026-10-19）

- 新增 Core 协议包 `frontend/src/core/protocol/`：
  - 单一类型来源：协议版本 1、10 种结构化错误码、握手/请求/响应/取消/事件消息、方法表
    （capabilities/snapshot/write/print.snapshot）、`ProtocolPort` 传输抽象、`PROTOCOL_CONTRACT` 快照；
  - `GuestClient`/`HostDispatcher`：版本+能力协商、类型化 request、取消（AbortSignal）、超时、
    错误码化、事件广播；`createInMemoryPorts` 端口模拟；
  - 契约测试 12 例全过、tsc 0、DOM/React 源码守卫。
  证据：`evidence/P1-T11-protocol.md`。
- 下一步：Tauri 传输最小探针（Windows WebView2 MessagePort 握手，复用/扩展 S1 原型）→ T12 分域迁移。

## P1 进度（T11 传输探针，2026-10-19）

- **Windows/WebView2 传输探针 7/7 PASS**：真实 protocol `GuestClient`（sandbox iframe）↔ 真实 `HostDispatcher`
  （主窗口）完成 handshake（能力协商/context-epoch 绑定）、类型化 `context.write`（completed/fileDurable）、
  host→guest 事件（theme-changed/context-changed）；UA=Edg/155 证明真实 WebView2。
- **关键发现**：MessagePort 无法 transfer 进 opaque-origin sandbox iframe（e.data.port 为空），
  退化为 window.postMessage JSON 桥后全部通过 → 首发 guest 传输定为 postMessage JSON 桥（结构化 clone +
  channel/方向标签）；MessagePort 需独立 origin/WebviewWindow（T18 决策）。
- 证据：`evidence/P1-T11-transport-probe.md` + `T11-transport-probe-results.json`。
- 下一步：生产版 iframeTransport（channel/背压/错误映射/版本握手）+ 接包加载器（T17）→ T12 分域迁移。

## P1 进度（T11 传输核心，2026-10-19）

- 新增 `core/protocol/transport.ts`（DOM-free）：带 `channelId`/方向标签的 wire 传输（信封
  `{__keProtoChannel, dir, payload}`、隔离/畸形丢弃计数、内存端点对）；`GuestClient` 增加背压
  （`maxInflight` 超出 → `E_BUSY` retryable，错误码契约显式升级）。
- 测试：协议层 **18 例全过**（契约 12 + 传输 6：wire 往返/256KB 大消息/channel 隔离/畸形/背压/错误），tsc 0。
- 下一步：T17 包加载器接入正式 iframe DOM 适配器；T12 分域迁移。

## P3 进度（T17 包加载器 Core，2026-10-19）

- 新增 Core 包层 `frontend/src/core/packs/`：
  - `manifest.ts`：包清单 + 能力 allowlist + 路径/哈希/apiVersion/声明式命令校验（未知能力无损拒绝）；
  - `store.ts`：PackStore（不可变版本目录、staging→rename、state.json 单提交点+jjournal、
    安装/激活/回滚/完整性校验、recover 自动回滚损坏 active）+ MemoryPackFs；
  - `pack.test.ts` 14 例全过、tsc 0、无 DOM/React 守卫。
  证据：`evidence/P3-T17-pack-loader.md`。
- 下一步：真实 Tauri fs 适配 + T18 broker 能力强制 → Windows 安装/回滚实机证据（T21）；
  T12 分域迁移继续。

## P3 进度（T18 Broker Core，2026-10-19）

- 新增 Core `frontend/src/core/broker/broker.ts`：连接身份（pack/version/role/capabilities/context/epoch/
  declaredCommands）+ 方法→能力映射 + epoch 过期 E_STALE_CONTEXT + 声明式命令白名单（E_FORBIDDEN）+
  有界代理（maxInflight→E_BUSY、payload 上限→E_BAD_PAYLOAD+limit）；official/trusted/guest 三档。
- 协议显式升级：新增 `command.invoke`（契约快照同步）；broker 9 例 + protocol 19 例全过、tsc 0。
  证据：`evidence/P3-T18-broker.md`。
- 下一步：Broker↔HostDispatcher 接线（连接建立注入 connection、能力回传）+ Windows/WebView2 恶意/故障
  测试包越权探针（W）；再进 T22 三档授权 UI 与 T12/13 收尾。

## P3 进度（T18 Broker 接线 + W 探针，2026-10-19）

- Broker↔HostDispatcher 接线：`brokeredHandlers(broker, connection)`（握手回传受信能力、所有方法经
  Broker 授权）；binding 9 例 + broker 9 例 + protocol 19 例 = **37 例全过**，tsc 0。
- **Windows/WebView2 恶意/故障 guest 探针 12/12 PASS**：guest 只能经受控协议面；越权写 E_CAPABILITY、
  未声明命令 E_FORBIDDEN、超限 payload E_BAD_PAYLOAD、未知方法 E_UNKNOWN_METHOD、opaque iframe 直接调
  Tauri 被拒（Origin 校验）、攻击后 host 仍健康。
- 证据：`evidence/P3-T18-broker.md`、`P3-T18-broker-probe.md` + `T18-broker-probe-results.json`。
- 下一步：真实产品 guest 连接建立（包激活 → 能力集合 → 协议会话）与 T22 授权 UI；T21 Windows 包安装/
  回滚实机；T12 分域迁移继续。

## P3 进度（T21 原生包存储 W 证据，2026-10-19）

- Rust 原生包存储原型 `pack_store_proto.rs`（T17 语义等价）：staging→rename、state.json 单提交点+journal、
  清单/能力/路径/sha256 校验、activate/rollback/verify/recover；真实 WebView2 窗口驱动。
- **Windows 真实文件系统探针 20/20 PASS**：安装/升级/回滚、损坏自动回退、坏哈希/穿越/重复拒绝、
  崩溃注入 state 不变、无 staging/journal 残留、磁盘文件内容与损坏保持校验。
  证据：`evidence/P3-T21-pack-install-probe.md` + `T21-pack-install-probe-results.json`。
- 下一步：Rust store 接产品 Tauri 主进程 + 启动 recover（T20）；TS PackStore 与 Rust 单一事实来源决策；
  T22 下载/候选扫描/首次安装确认 UI。

## P1 进度（T12 只读域迁移切片，2026-10-19）

- 产品后端上下文只读域落地：`/api/context/tree`、`/api/context/search`（context+epoch 绑定，
  两工作区完全隔离；旧 epoch 409；关闭上下文 404）；旧全局端点保持可用（App 不破坏）。
- 契约显式更新：OpenAPI 50 路径 / 62 方法 / +2 schema；后端全量 **840 collected**，WSL 与 Windows
  Py3.10 全绿。证据：`evidence/P1-T12-domain-migration-slice.md`。
- 下一步：写域（article/attachment/import/export/print）逐域绑定；真实 store/indexer/history 迁移；
  T13 Core 门槛（无 App/EditorArea 挂载验证）→ 进 P2（T14 EditorSession/T16 打印产品化）。

## P1 进度（T13 Core 门槛，2026-10-19）

- **UI-free Core 门禁 21/21 PASS**（纯 Node + 真实后端，无 App/EditorArea/happy-dom）：
  打开工作区 → 可信快照 → Core 保存（真实落盘）→ abort 恢复/重试 → 只读域 tree/search → 切库 epoch
  屏障 → 租约关闭协调；未覆盖项（单实例/退出协调、打印 job、Rust 恢复）显式记录。
  证据：`evidence/P1-T13-core-gate.md` + `T13-core-gate-results.json`。
- 附带修复：SaveCoordinator 恢复日志「重试残留」缺陷（成功保存清理同文档旧记录）+ 单测；
  Core 会话层 23 例、tsc 0。
- 下一步：补 T13 剩余项（单实例/退出协调原型、打印 job 产品化 T16、Rust 恢复 T20）并出 P1 阶段报告；
  并行 T12 写域迁移。

## P1 进度（T13 单实例/退出协调 W 证据，2026-10-19）

- **单实例 + 退出协调 Windows 实机 6/6 PASS**：`tauri-plugin-single-instance` 第二实例立即退出并路由
  `second-instance-detected` 到第一实例；WM_CLOSE 后 `ExitRequested`/`Exit` 协调标记落盘。
  证据：`evidence/P1-T13-instance-probe.md` + `T13-instance-probe-results.json`。
- 附带修复原型壳「`.build()` 后漏接 `.run()` 事件循环导致启动即退出」的工程坑。
- T13 剩余：打印 job（T16）、Rust 原生恢复（T20）、产品工作区打开流程合并验证。
- 下一步：P1 阶段报告（T08–T13 状态与 P1_READY 口径）；T12 写域迁移；T16 打印产品化。

## P1 进度（T12 写域切片，2026-10-19）

- 受控文章保存 `/api/context/article/save`：Articles/**.md 限制、frontmatter（title+ke_version）、
  复用 CAS/幂等/原子写、上下文隔离；6 例全过；契约 51 路径/63 方法；后端全量 **846 collected**，
  WSL 与 Windows Py3.10 全绿。证据：`evidence/P1-T12-write-domain-slice.md`。
- 下一步：其余写域（重命名/删除/附件/导入导出/print job）与真实 store/indexer 迁移；P1 阶段报告；
  T14/T15 前端接线。

## P1 阶段报告（2026-10-19）

- `reports/P1-report.md`：P1 状态 `P1_READY_PENDING` —— T08 passed；T09/T10/T11/T12 切片与 T13 Core 门禁
  （UI-free 21/21 + 单实例/退出协调 W 6/6）已交付；T13 剩余打印 job（T16）/Rust 原生恢复（T20）/
  产品工作区流程合并验证。
- 测试基线：backend 846 collected（WSL+Windows 全绿）、frontend 116 files/1690 passed+1 skipped（exit 0）、
  tsc 0；Core 新增单测 74。
- 下一阶段：T14/T15（EditorSession 产品接线 + 真实 IME/DPI W）、T16（打印产品化）、T17/T18（包加载器/
  broker 产品化）、T20/T21（Rust 恢复/安装验收）、T12 剩余域。

## P2 进度（T14 适配层起步，2026-10-19）

- Core ↔ 既有产品 UI 适配层：`createCoreSaveFn`（产品 SaveFn 语义，仅 file_durable resolve/类型化冲突错误）、
  `createEditHook`（O(1) 标脏）、`createSaveStateReporter`（状态条回调）、`switchDocument`/`hasDirtyDocument`；
  SaveCoordinator 增加 `subscribe`。无 React 测试覆盖（session 29 例全过、tsc 0）。
  证据：`evidence/P2-T14-product-adapter.md`。
- 下一步：真实 EditorArea/SaveQueue 接线（与 `/api/context/*` 联调，双写开关）；T15 IME/DPI Windows 验收；
  T16 打印产品化（隐藏窗口/长文档/job 取消）。

## P2 进度（T15 WebView2 CDP 实机 8/8，2026-10-19）

- **Windows/WebView2 CDP 探针 8/8 PASS**：真实 WebView2 页面内 IME 组词（imeSetComposition+insertText）、
  焦点（真实鼠标点击→contenteditable active）、撤销、Tauri setZoom（dpr 2→2.5）后继续输入。
  证据：`evidence/P2-T15-ime-zoom-probe.md` + `T15-ime-zoom-probe-results.json`。
- 限制：IME 为 CDP 浏览器级模拟（非物理键盘+OS IME）；多 DPI 拖拽/失焦遮挡未测；探针钩子仅原型。
- 下一步：T14 真实 EditorArea 接线后回归 T15；T16 打印产品化；T12 剩余写域。

## P2 进度（T16 打印 Core，2026-10-19）

- Core 打印层 `frontend/src/core/print/printJob.ts`：仅消费指定 revision 可信快照；Job 状态机
  （queued→rendering→printing→done/failed/canceled）、串行打印、取消（任意阶段）、超时 abort、
  输出路径校验；12 例全过、tsc 0；与 S4 真实 PDF W 证据互补。
  证据：`evidence/P2-T16-print-core.md`。
- 下一步：隐藏 renderer + Rust PrintToPdf 产品接线、长文档分页/主题/源码打印、取消清理与 job 对账、
  打印 UI 与 Windows W 验收；T14 真实 EditorArea 接线回归。

## P3 进度（T22 安装确认 Core，2026-10-19）

- 首次安装确认 Core：`buildInstallPreview`（身份/来源/能力风险/warnings；无效签名 blocked）+
  `PendingInstallGate`（stage 无副作用、**只能 confirm 显式安装**、token 一次性/过期、cancel）；
  9 例全过（packs 共 23），tsc 0。证据：`evidence/P3-T22-install-confirmation.md`。
- 下一步：T23 工坊控制面 UI（渲染预览/确认/进度/回滚）；真实包下载/候选扫描/签名验证；
  T21 Windows 安装交互 W 证据。

## P3 进度（T23 控制面 UI 骨架，2026-10-19）

- `WorkshopPanel`：已安装包列表/回滚修复、安装预览（身份/来源/签名/能力风险/warnings/blocked）、
  确认安装与取消；`WorkshopAdapter` 注入接口（产品=Tauri Rust 命令，测试=内存替身）；
  7 例 React 测试全过（产品测试栈，无新依赖），tsc 0。证据：`evidence/P3-T23-workshop-panel.md`。
- 下一步：集成进 App/路由（工坊入口）+ 产品 Rust 包命令适配器；真实选择包/进度/取消；Windows W 交互。

## P3 进度（T21 产品壳 Rust 包存储，2026-10-19）

- 产品壳新增 `pack_store.rs`（7 个命令：scan/install/list/verify/activate/rollback/recover）；
  staging→rename→state 单提交点+journal、哈希/能力/路径校验、损坏自动回退；包目录
  `app_data_dir()/workshop-packs`（与笔记库隔离）。cargo test **32 passed**（3 个新单测）、
  release 构建成功。证据：`evidence/P3-T21-product-pack-store.md`。
- 下一步：前端 `invoke` 适配器 + WorkshopPanel 集成（真实包目录选择/进度/取消）；卸载/签名；
  Windows 端到端交互 W（T21/T26）；与 T20 启动恢复合并。

## P3 进度（T23/T21 前端集成，2026-10-19）

- `tauriPackAdapter.ts`（scan/list/install/rollback/recover → 产品 Rust 命令）+
  `WorkshopEntry` flag 入口（默认零渲染）+ App 接入；能力风险复用 installPolicy。
- 测试：工坊+packs 39 例全过、tsc 0；**全量前端 122 files / 1733 passed + 1 skipped（exit 0）**。
  证据：`evidence/P3-T23-workshop-integration.md`。
- 下一步：Tauri dialog/真实包目录选择；Windows 端到端交互 W（安装→启用→回滚→卸载）；
  T20 启动 recover/safe mode；签名/来源信任与卸载。

## P3 进度（T20 启动恢复，2026-10-19）

- 产品壳启动 recover：`recover_all` + 状态文件 + `workshop://recover-status` 事件（不阻断启动）；
  真实 Tauri dialog 目录选择接入包安装入口。cargo test **33 passed**、release 构建；adapter 7 例、tsc 0。
  证据：`evidence/P3-T20-startup-recover.md`。
- 下一步：Windows 端到端交互 W（含损坏包启动→safe mode 可见/可修复→安装→回滚→卸载）；
  safeMode 前端呈现；签名/来源信任；P2/P3 阶段报告。

## P2/P3 阶段报告（2026-10-19）

- `reports/P2-P3-report.md`：P2 in_progress（T14 适配层/T15 CDP W 8/8/T16 打印 Core）、
  P3 EXPERIMENTAL_CORE_ONLY（T17/T18+W/T20 启动恢复/T21 产品 Rust+W/T22/T23 UI 集成），
  **项目级仍判 `P0_READY`**（工坊未在产品 UX 完整落地，不满足 IMPLEMENTED_WINDOWS_PENDING）；
  给出证据索引、完成度判定表、最短路径优先级与风险清单。
- 测试基线：前端 122 files/1733 passed+1 skipped；后端 846 collected；产品 cargo 33 passed。

## P2/P3 进度（T20 safeMode UI 呈现，2026-10-19）

- safeMode 前端呈现：WorkshopPanel「检查/修复全部包」（adapter.recoverAll → workshop_pack_recover_all）+
  safeMode 警告横幅；WorkshopEntry 监听 `workshop://recover-status` 显示 safe mode 徽标。
- 测试：工坊+packs 43 例全过、tsc 0；**全量前端 122 files / 1737 passed + 1 skipped（exit 0）**。
- 下一步：Windows 端到端交互 W（损坏包启动→safe mode→修复/回滚→卸载）；P2 T14 真实接线。

## P3 进度（T19 包隔离宿主 Core，2026-10-19）

- `PackageHost`：start（校验→受限 Broker 连接）/reportCrash（suspended→超限 failed+deactivate+
  recover+safeMode）/restart（切库新 epoch）/stop/subscribe；7 例全过、tsc 0。
  证据：`evidence/P3-T19-package-host.md`。
- 下一步：真实 guest WebView（iframe）会话装配（Broker/Dispatcher + 包入口资源加载）；
  与 T20 safeMode UI/启动恢复联动；Windows 故障注入 W；T14 接线决策（见 P2/P3 报告最短路径）。

## P3 进度（T21 卸载闭环，2026-10-19）

- 产品壳 `workshop_pack_uninstall`（空 state 提交→删目录，失败回滚 state；重复卸载 E_NOT_FOUND）+
  Rust 单测；前端适配器 uninstall + 工坊面板**内联二次确认**卸载按钮（非原生 confirm）。
- 验证：产品 cargo **34 passed**、release 构建；工坊+packs 测试 53 例；全量前端
  **123 files / 1747 passed + 1 skipped（exit 0）**。
- 下一步：Windows 端到端交互 W（安装→启用→回滚→卸载）；包签名/来源信任；最终交接报告。

## 交接报告（当前真实状态版，2026-10-19）

- `docs/ui-workshop/HANDOVER.md`：项目级口径 P0_READY（判定表见 §1）、T00–T29 状态总表、
  Core/后端/Tauri/原型代码索引、9 项 Windows W 证据索引与运行命令、复现验证步骤、
  剩余风险（OS IME/产品接线/Windows E2E/签名信任等）、下一阶段优先级、约束遵守声明。
- 本报告不代表工坊可发布；分支仍仅本地、未推送/未 Release。

## P3 进度（T19 包隔离宿主 W 探针，2026-10-19）

- **T19 Windows/WebView2 实机探针 8/8 PASS**：真实 PackageHost + Broker + HostDispatcher + sandbox iframe
  guest（真实协议客户端）：会话连接受限（guest/context.read/epoch/命令白名单）、guest 经 broker 只读
  snapshot、崩溃两次 suspended、超限 failed + deactivate + recover + safeMode。
  证据：`evidence/P3-T19-package-host-probe.md` + results JSON。
- 剩余：真实包入口资源加载（T17 产品化）、真实 WebView 崩溃信号、与 T20 safeMode UI/持久化联动、
  Windows 端到端交互 W。下一步：T14 接线决策/最小实现；T24 可信包限定 Core。

## P4 进度（T24 可信包限定 Core，2026-10-19）

- `trustPolicy`：builtin/trusted/community 三档、签名/下载未签名策略、等级能力限制（阻止而非静默裁剪）、
  `requiresExplicitConfirm`、TrustStore 授权持久化；PackageHost 运行期 `capabilityCeiling` 裁剪 Broker 能力。
- 测试：packs **49 例**（trust 9 + packageHost 新增 1）全过、tsc 0。
  证据：`evidence/P4-T24-trust-policy.md`。
- 下一步：真实签名验证（PKI）与来源信任 UI（工坊控制面 grant/revoke）；Rust 持久化 TrustStore；
  T20/T21 端到端合并；Windows 交互 W；T25 平台矩阵骨架。

## P4 进度（T25 平台验证矩阵，2026-10-19）

- `tools/build_validation_matrix.py` 自动扫描 evidence/*-results.json + 回归基线，生成
  `validation-matrix.csv`（18 行：9 W / 2 A / 2 A/U / 3 回归 / 1 构建；S1 的 2 项已知发现单独标注）。
  证据：`evidence/P4-T25-validation-matrix.md`。
- 下一步：矩阵 CI 门禁化（FAIL 阻断）；接入产品 E2E W/真实 IME/多 DPI；T14 接线/T16 产品打印。

## P4 进度（T25 矩阵门禁 + T14 接线决策，2026-10-19）

- T25：`build_validation_matrix.py --check` 门禁模式（存在 FAIL 退出非 0；PASS_WITH_FINDINGS 显式标注）。
- T14：`adr/ADR-002-t14-editor-save-integration.md` —— 适配器优先/flag 双轨（`VITE_KE_CORE_SAVE`，默认关闭）、
  禁止双写、上下文解析与失败降级、验收门槛与回滚方式；实现顺序（coreSaveBridge → EditorArea flag 分支 →
  产品验收 W）已定。

## P2 进度（T14 Core 保存桥，2026-10-19）

- ADR-002 步骤 1 完成：`coreSaveBridge`（上下文解析/409 switch/快照/revision 推进/冲突映射/
  invalidate）+ 单元 8 例 + **真实后端 e2e 11/11**（切库后旧桥保存被拒，不静默写入）。
  证据：`evidence/P2-T14-core-save-bridge.md`；矩阵新增 T14 A 行并门禁 PASS。
- 下一步：ADR-002 步骤 2（EditorArea flag 分支，禁止双写）+ 字节一致性/恢复点回归。

## P2 进度（T14 EditorArea flag 接线，2026-10-19）

- ADR-002 步骤 2 完成：`coreSaveRuntime`（flag 默认关闭/每文档 SaveFn 缓存/内容 provider）+ EditorArea
  保存路径 flag 分支（traits 先行、旧链/Core 二选一、禁止双写、ArticleMeta 不被覆盖）；
  docTraits 源码守卫更新；全量前端 **126 files / 1769 passed + 1 skipped**、tsc 0。
  证据：`evidence/P2-T14-editor-wiring.md`。
- 下一步：字节一致性验证（flag on/off 同编辑输出对比）；flag-on UI e2e（保存/切档/外部改盘/恢复点）
  + Windows/WebView2 实机保存 W；通过后评估默认开启。

## P4 进度（T24 签名验证 Core，2026-10-19）

- `core/packs/signature.ts`：规范化清单载荷（字段固定顺序，含能力/entry/命令/资产 sha256）、
  Ed25519 验签（实现可注入，默认 WebCrypto）、三态 valid/missing/invalid + reason、不抛异常；
  可被 T22 安装预览与 T24 信任策略直接消费；8 例全过、tsc 0。
  证据：`evidence/P4-T24-pack-signature.md`。
- 下一步：密钥信任根/轮换/撤销；签名生成工具链 + Rust 侧验签；来源信任 UI；T20/T21 端到端 + Windows W。

## P3 进度（T20 启动恢复 W 探针，2026-10-19）

- **Windows 启动恢复 W 探针 9/9 PASS**：播种损坏包（含/不含 previous）→ 启动 recover_all →
  自动回退/`corrupt-no-fallback` → safeMode 状态文件与事件 → 应用仍正常启动。
  证据：`evidence/P3-T20-startup-recover-probe.md` + results JSON；矩阵新增 T20 W 行（20 行，门禁 PASS）。
- 下一步：产品安装目录端到端 W（隔离数据目录）；safeMode 阻断危险操作策略；与单实例状态合并。

## P4 进度（T24 信任 UI 贯通，2026-10-19）

- 信任授权 UI：工坊已安装包行显示信任等级 + 签名状态徽章；授予 trusted / 撤销信任按钮；
  LocalTrustStore 过渡持久化（localStorage，可平滑替换 Rust）；tauriAdapter 接通 TrustStore。
- 测试：localTrustStore 3 例 + WorkshopPanel 2 例 + adapter 1 例；工坊+packs 77 例全过、tsc 0；
  **全量前端 128 files / 1783 passed + 1 skipped（exit 0）**。证据：`evidence/P4-T24-trust-ui.md`。
- 下一步：签名状态接入真实验签与公钥信任根；TrustStore 产品化（Rust）；Windows 信任安全演练；
  T16 打印产品接线。

## P4 进度（T24 信任根 Core，2026-10-19）

- `core/packs/keyring.ts`：ed25519 公钥信任根（raw/hex）、轮换重叠期、撤销（E_SIGNATURE_REVOKED）、
  过期（E_SIGNATURE_EXPIRED）、未知/非法公钥 invalid、不抛异常；与 T24 签名验证组合；
  `BUILTIN_PACK_KEYRING` 显式空占位（待真实发布密钥）。8 例全过、tsc 0。
  证据：`evidence/P4-T24-keyring.md`。
- 下一步：真实发布密钥签发/分发 + 打包器签名工具链 + Rust 侧验签；工坊签名数据源接线；
  Windows 信任安全演练；T16 打印产品接线。

## P2 进度（T16 打印产品切片，2026-10-19）

- 产品打印管线：`print.rs` 抽取 `render_window_pdf_to(window_label,…)`；新增 `print_snapshot.rs`
  （启动时 env 门控隐藏 renderer + `print_snapshot_pdf` 注入快照/校验路径/PrintToPdf）；
  前端 `TauriPrintTransport`。cargo **34 passed** + release 构建；全量前端
  **130 files / 1793 passed + 1 skipped**、tsc 0。证据：`evidence/P2-T16-product-print.md`。
- 下一步：隔离安装 Windows 端到端 W（隐藏 renderer/PDF/取消清理）；renderer ready 握手；
  长文档分页/主题/源码模式；打印 UI 接线与取消对账。

## P5 进度（T26 W 证据一键门禁，2026-10-19）

- `tools/run_all_w_probes.py`：顺序复跑 11 项 Windows/WebView2 W 探针并聚合，
  结果 **11/11 PASS**（S1 的 2 项已知发现标 PASS_WITH_FINDINGS），`--check` 门禁 PASS；
  产出 `evidence/windows-witnesses-summary.json`。证据：`evidence/P5-T26-windows-witnesses.md`。
- 剩余：产品壳端到端交互 W（隔离安装）、真实 OS IME/多 DPI、Windows 安装包升级回归；
  之后才能给 T26 认证结论（不冒进）。

## P4 进度（T24 产品 Rust 验签，2026-10-19）

- 产品壳 `pack_store` 增加 ed25519 验签：canonical 载荷与 TS 逐字节一致（跨语言 parity 测试）、
  env 公钥配置（key/revoked/expiresAt）、scan 暴露 signatureStatus、install 硬拒绝 invalid 签名。
- 测试：产品 cargo **38 passed**（+4）、TS signature 9 例（含 parity）、tsc 0。
  证据：`evidence/P4-T24-rust-signature.md`。
- 下一步：真实发布密钥签发/配置分发、打包器签名工具链、工坊 UI 签名数据源、Windows 验签 E2E。

## P4 进度（T24 打包器签名工具，2026-10-19）

- `tools/sign_pack.mjs`：生成发布密钥（PEM+raw hex）、给包目录 manifest 签名（ed25519）、self-test；
  canonical 载荷与 TS/Rust 逐字节一致（三语言 parity 锁定）。self-test **5/5 PASS**。
  证据：`evidence/P4-T24-sign-tool.md` + `T24-sign-tool-selftest.json`。
- 剩余：正式发布密钥生成/保管/轮换流程、公钥进产品构建配置、工坊 UI 签名数据源、
  Windows 验签安装端到端 W。

## P4 进度（T24 签名数据源贯通，2026-10-19）

- Rust `list_packs` 返回 active 版本真实签名状态；tauriAdapter 映射到工坊列表徽章与安装预览
  （invalid → blocked + 原因）；签名链路贯通：打包签名工具 → Rust 验签 → UI。
- 测试：cargo 38 passed、工坊+packs 87 例、全量前端 130 files/1795 passed、tsc 0。
  证据：`evidence/P4-T24-signature-datasource.md`。
- 剩余：正式发布密钥流程（离线签名/公钥构建配置/轮换）、Windows 验签安装 E2E、非 active 版本签名/审计。

## P3/P5 进度（T19 已安装包 entry 真实资源 W + 12 探针门禁，2026-10-19）

- T19 升级：原型新增 `pack_read_asset` 与 `S1_PACK_SEED_PACK_DIR`（从真实包目录安装）；
  host 探针从**已安装包**读取 entry HTML（`guestSource=pack-entry`，7,807 bytes）注入 guest，
  PackageHost/Broker/崩溃升级/safeMode 全部通过（W **8/8**）。
- 一键 W 门禁扩展为 **12 探针**（含 T19E），修复 T15 CDP IME 偶发竞态（preedit 取消 + 重试）后
  **12/12 PASS**；矩阵 **21 行**、`--check` PASS。证据：`P5-T26-windows-witnesses.md`、
  `P3-T19-pack-entry-probe.md`。

## P4 进度（T24 密钥生命周期 ADR，2026-10-19）

- `adr/ADR-003-pack-signing-key-lifecycle.md`：ed25519 密钥分级/离线私钥保管/公钥进产品
  （Rust env + TS keyring）/轮换重叠期/吊销紧急响应/审计与可验证性/被拒方案/实施清单。
  与已实现的能力（三语言 parity、Rust 硬拒绝、UI 数据源、签名工具）串联，明确 T24/T26 收尾项。
- 下一步：生成正式 release 密钥并登记公钥；打包脚本串联签名→Rust scan 校验；撤销/轮换 Windows E2E 演练。

## P3 进度（T19 多资源+心跳崩溃检测 W，2026-10-19）

- 多资源离线包（entry/css/js 从已安装包读取，安装期哈希校验）+ **心跳真实崩溃检测**
  （iframe 移除 → 心跳中断 → 宿主自动 reportCrash → suspended → 超限 failed/deactivate/recover/safeMode）
  W **8/8**；旧 T19 单资源探针同步 8/8（未回归）。
- 一键 W 门禁扩至 **13 探针**：**13/13 PASS**；矩阵 **22 行**、`--check` PASS。
  证据：`evidence/P3-T19-multiasset-heartbeat-probe.md`、`P5-T26-windows-witnesses.md`。

## P2 进度（T16 ready 握手，2026-10-19）

- 产品打印 renderer 从固定 400ms 等待升级为**显式 ready 握手**：`print_snapshot_ready` 命令 +
  token + 轮询 ≤5s，超时记录并兜底继续打印（不因环境差异断打印）。
  cargo **38 passed**、release 构建成功。证据：`evidence/P2-T16-product-print.md`（收尾更新）。
- 剩余：隔离安装 Windows E2E W（含握手真实路径/取消清理）、长文档分页/主题/源码模式、打印 UI 接线。

## P2 进度（T14 字节一致性，2026-10-19）

- ADR-002 验收门槛「保存字节一致性」达成：同一最终 markdown 经**旧链 PUT** 与 **Core 上下文写**落盘
  逐字节一致；LF 与 CRLF+BOM 两场景均无损（真实后端 e2e **12/12 PASS**）。
  证据：`evidence/P2-T14-byte-consistency.md` + results JSON。
- 剩余：flag 开启路径 UI e2e（保存/切档/外部改盘/恢复点）、Windows/WebView2 实机保存 W；
  通过后才评估 `VITE_KE_CORE_SAVE` 默认开启。

## P5 进度（T25 矩阵增强 + T26 验收计划，2026-10-19）

- T25 矩阵基线扩展：补 Core 各模块单测（session 41/protocol 18/broker 18/packs 71/print 14/
  workshop UI 16）、前端全量 1795、后端 846、产品 cargo 38，与 W/A 证据行同表；--check PASS。
- T26：`reports/T26-windows-acceptance-plan.md` —— 隔离策略（独立 identifier/数据目录/端口/清理/
  不发布）、A1–A8 验收场景（启动/打印/recover/safeMode/签名/信任/安装回滚卸载/包宿主/Core 保存）、
  前置条件与完成定义；执行后方可给认证结论（当前未执行，不冒进）。

## P6/T26 进度（隔离产品冒烟，2026-10-19）

- 打通 T26 隔离测试构建：复制 src-tauri + 覆盖 identifier/productName/frontendDist → cargo build
  （TAURI_CONFIG 环境覆盖对 plain cargo 无效，已改为副本方案）；启动真实产品壳测试实例：
  W **7/7 PASS** —— 主窗口、独立 appData、**产品启动 recover 状态文件真实生成**、隔离单实例、
  用户运行中的 AstraNota（PID 69108）不受影响、进程清理。
  证据：`evidence/P5-T26-isolated-smoke.md` + results JSON；步骤：`tools/t26_isolated_build.md`。
- 限制/补充：复制 sidecar 到测试 exe 同目录后**后端可工作**（A2/A4–A8 可执行）；强制结束会遗留 sidecar
  孙进程，T26 脚本须优雅关闭 + 路径白名单清理（已写入 tools/t26_isolated_build.md）。

## P6/T26 进度（A2 真实产品打印 W，2026-10-19）

- **A2 完成**：隔离产品壳 + CDP 调用真实 `print_snapshot_pdf` → 隐藏 renderer 状态 ok、PDF 63KB
  (%PDF)、不覆盖/E_PATH、ready 握手无超时兜底、用户实例不受影响（W **9/9**）。
- W 探针发现并修复真实缺陷：`PrintRenderState` 未 `.manage()`（State 注入失败）；新增
  `print-render-status.json` 可观测性；测试构建需 frontendDist 相对路径（否则 file:// origin 导致
  IPC 失败）。证据：`evidence/P5-T26-A2-print.md`。
- **事故记录**：首版 runner 误用 `taskkill /IM knowledgeeditor.exe` 误杀用户运行中 App（原 PID 69108）；
  已修复清理规则（PID/路径白名单）并重启用户 App（PID 82360 正常）。T26 文档已写入禁止按镜像名杀进程红线。

## P6/T26 进度（A3 启动 recover/safeMode 产品 W，2026-10-19）

- **A3 完成（W 9/9）**：产品级启动恢复场景 A（v2 损坏 + previous v1 → 自动回退、磁盘 active=1.0.0、
  safeMode=false）与场景 B（无回退 → corrupt-no-fallback、safeMode=true），两场景主进程均存活；
  用户运行实例未受影响。证据：`evidence/P5-T26-A3-recover.md`。
- 工程发现：测试构建与主构建共享 target 会互相覆盖 exe（误用主构建会被单实例接管、静默退出）；
  已将测试构建固定到 `C:\ke-tmp\uiws-t26\bin`，A2 在稳定路径复跑仍 9/9。

## P6/T26 进度（A4+A6 产品 W 16/16，2026-10-19）

- **A4 签名信任链（真实产品）**：valid/missing/invalid/revoked 扫描状态与安装硬拒绝全部生效；
- **A6 安装生命周期**：install v1→v2（自动激活）→重复 activate（幂等）→rollback→uninstall 全链路通过；
- 修复真实缺陷：`workshop_pack_activate` 非幂等会破坏 previous/rollback 目标 → 幂等返回 + 单测
  （cargo **39 passed**）。证据：`evidence/P5-T26-A4-A6-install.md`。
- 剩余 A5/A7/A8、真实 IME/多 DPI、安装包升级/回滚演练。

## P6/T26 阶段验收（2026-10-19）

- `reports/T26-acceptance-status.md`：A1–A6 已完成（真实产品壳 W：smoke 7/7、打印 9/9、
  recover/safeMode 9/9、A4+A6 16/16、原型 13/13）；A7/A8/真实 IME/多 DPI/安装包升级未完成 →
  **T26 未最终认证**；项目级仍 `P0_READY`（不冒进）。
- 下一阶段顺序：A5/A7（产品包宿主+信任 UI）→ A8 → 真实 IME/多 DPI → 安装包升级/回滚 → 认证评估。

## P6/T26 进度（A5 工坊信任 UI 产品 W 11/11，2026-10-19）

- flag 构建（VITE_KE_WORKSHOP=1）+ 隔离工作区/测试构建 + CDP DOM 交互：工坊入口可见、面板加载
  真实已安装包列表、真实签名徽章 valid、授予 trusted → localStorage TrustStore 持久化 + 徽章更新、
  撤销 → community 清除；用户实例不受影响。证据：`evidence/P5-T26-A5-ui.md`。
- A5 剩余：能力上限在真实包会话的运行时强制执行（依赖 A7 产品侧包宿主装配）。

## P6/T26 进度（A8 尝试 + 隔离事故披露，2026-10-19）

- A8（Core 保存 flag 产品 UI）尝试：产品启动/文章打开/编辑器加载/标记写入均成功，但 CDP 合成输入
  未触发 ProseMirror 事务/autosave（日志仅 GET），保存校验失败 → **A8 未通过，记录自动化限制**，
  不得当证据；证据：`evidence/P5-T26-A8-save-attempt.md`。
- **隔离缺陷**：产品 data_dir 不随 identifier 变化 → 测试构建需注入隔离 APPDATA（已修复全部 runner）；
  早期运行只读显示了用户真实工作区列表（无编辑/保存）；已清理真实 app_config 中被注入的 hello.md 记录。
- **操作事故**：两次误杀用户 App（taskkill 镜像名 / 误用用户 PID），均已重启并写入红线；后续仅按
  测试进程 PID + 路径白名单清理。

## P6/T26 进度（A8 追加尝试 + base URL 修复，2026-10-19）

- A8 追加：真实 SendInput 输入成功进入编辑器，但仍无保存调用（日志仅 GET）→ A8 保持 pending；
  后续需人工真实编辑或测试保存入口。
- 发现并修复真实集成缺陷：`coreSaveRuntime` 默认桥未使用产品后端 `window.__KE_API_BASE__`
  （Core 保存会打到 Tauri 资源域）；已修复 + runtime 测试 5 例/tsc 0。

## P6/T26 进度（A8 通过 W 9/9，2026-10-19）

- **A8 完成**：隔离产品构建（VITE_KE_CORE_SAVE=1）+ 当前源码 sidecar → 编辑器 autosave 经 Core
  上下文链落盘（日志 `/api/context/write`），frontmatter 元信息保留；真实 SendInput 编辑验证。
- 排查中修复 3 个真实缺陷：Core 桥 base URL、sidecar 版本不匹配（旧打包后端无 /api/context）、
  上下文写入丢 frontmatter（后端 merge 语义 + 测试）。
- 证据：`evidence/P5-T26-A8-save.md`；A8 期间自动化限制尝试保留于 `P5-T26-A8-save-attempt.md`。

## P3/P5 进度（ADR-004 + 产品 read_asset，2026-10-19）

- `adr/ADR-004-product-package-host.md`：产品侧包隔离宿主设计——真实 entry 经产品命令读取、
  sandbox iframe + **隔离守卫**（验证是否继承 Tauri globals，失败禁用包）、Core PackageHost/Broker 装配、
  能力上限（T24 信任等级 ∩ manifest）、心跳崩溃检测与停用/恢复/safeMode、flag 门控、验收与实施顺序；
- 已实现 A7 第一步：产品 `workshop_pack_read_asset`（路径/大小/未安装安全校验，cargo **40 passed**）。
  证据：`evidence/P3-T17-pack-asset-command.md`。

## P3/P5 进度（A7 数据/命令层，2026-10-19）

- 产品 Rust 增加 `workshop_pack_session_status/report`（状态枚举/packId 安全校验/原子写
  `workshop-session-status.json`），cargo **41 passed**；
- 前端 `productHostAdapter`：PackageHostBackend 映射、entry+css/js 注入、会话状态、隔离守卫、
  T24 能力上限（7 例 U、tsc 0）。证据：`evidence/P3-T19-product-host-adapter.md`。
- 下一步（ADR-004 步骤 4-5）：iframe 心跳宿主组件 + 工坊启用/停用 UI + safeMode 禁用 + A7/A5 产品 W。

## P3/P5 进度（A7 会话控制层，2026-10-19）

- `core/packs/guestHost.ts`：PackageHost 启动+T24 能力上限+真实 entry+心跳崩溃检测+状态落盘+stop，
  4 例 U（含超时 3 次 → failed + safeMode）通过、tsc 0。
  证据：`evidence/P3-T19-guest-host-controller.md`。
- 剩余：`WorkshopGuestFrame` UI 薄封装（sandbox iframe/isolationGuard/postMessage wire/启用停用/
  safeMode 禁用）→ A7/A5 产品 W。

## P3/P5 进度（A7 UI 最小闭环，2026-10-19）

- `WorkshopGuestFrame`：启用/停用 guest、能力上限/真实 entry（产品 read_asset）、sandbox iframe、
  心跳监听、隔离守卫、safeMode 横幅；`tauriPackAdapter.createGuestBackend()`；工坊面板按包渲染；
  2 例组件测试通过、tsc 0。证据：`evidence/P3-T19-guest-frame-ui.md`。
- 下一步：A7/A5 产品 W（CDP 驱动真实产品壳：启用→active→能力子集→移除 iframe→自动 suspended→
  超限 failed+safeMode→停用持久化）。

## P5/T26 进度（A7/A5 产品 W 首跑 8/11 + CSP 发现，2026-10-19）

- 真实产品壳：capacity 拒绝 ✓、trusted 启用 active+iframe ✓、会话状态落盘 ✓、停用 stopped ✓；
- **CSP `script-src 'self'` 阻断 sandbox srcdoc 内联包脚本 → 心跳 0 → 崩溃检测不触发**；
  A7/A5 未通过；ADR-004 修订：改用 `workshop://` 自定义协议提供包 origin（含包文档 CSP）。
  证据：`evidence/P5-T26-A7-A5-guest-attempt.md`。
- 保留修复：guestHost 无心跳兜底、组件心跳诊断计数、测试构建同步源码流程修正。

## P5/T26 进度（A7/A5 产品 W 11/11，2026-10-19）

- **A7/A5 完成**：workshop:// 自定义协议提供包独立 origin（包文档 CSP）、iframe src 加载、
  能力上限运行时强制（community→E_CAPABILITY_TIER）、心跳崩溃检测→failed→safeMode、停用持久化 stopped。
- 修复：deactivate 覆盖 stopped、failed 时 safeMode 同步、停用按钮可用性；cargo **44 passed**、
  前端 packs/workshop **100 passed**。
- T26 仅剩：真实 OS 中文 IME/多 DPI、安装包升级/回滚演练（T27）、SDK 协议线/真实 renderer crash 注入。

## P6/T26 进度（IME/DPI 产品 W 7/7，2026-10-19）

- 产品 WebView2 编辑器：IME 组词路径、DPI/缩放（dpr 2→1.5）、缩放后仍可输入且恢复；W 7/7。
  证据：`evidence/P5-T26-ime-dpi.md`（明确边界：CDP 合成输入，不能替代人工真实 IME 实测）。
- T26 剩余：人工真实系统 IME/多 DPI、安装包升级/回滚（T27）。

## P6/T26 进度（A7 隔离核对，2026-10-19）

- guest 独立 origin `http://workshop.localhost`；guest 仍可见 __TAURI_INTERNALS__ 但 invoke 实测
  timeout（remote IPC 未生效）→ W 5/5 PASS，附**残余风险**与硬化清单（SDK 自检/配置审计/独立
  WebviewWindow 评估）。证据：`evidence/P5-T26-A7-isolation.md`。

## P6/P7 进度（T27 计划 + 里程碑评估，2026-10-19）

- `reports/T27-installer-upgrade-plan.md`：安装/覆盖升级/降级/兼容 I 证据计划（可执行构建命令、
  场景断言 U1–U6、证据采集、红线：专用环境/授权/不碰用户安装）。
- `reports/milestone-assessment.md`：按 ACCEPTANCE A 节口径逐项核对，当前里程碑
  **`EXPERIMENTAL_TRUSTED_PACKS`**（受信实验包；隔离残余风险/离线包/恢复 I 门禁/表单交接/SDK/
  协议线/网络边界/性能未通过或 NOT_RUN 均列出）；不声明更高状态。
- HANDOVER 增加「里程碑评估」段。

## P6/T26 进度（隔离硬化尝试，2026-10-19）

- 包文档守卫脚本（移除 __TAURI_INTERNALS__）尝试**无效**（属性不可配置）；cargo 46 passed（含
  inject_guard 单测），但隔离保证改为依赖：独立 origin + Tauri IPC authority remote 拒绝
  （capabilities 无 remote 声明）+ Tauri 升级回归；残余风险保留在里程碑评估中。
  证据：`evidence/P5-T26-A7-isolation.md` 追加节。

## P6/T26 进度（W01 ZIP 离线包，2026-10-19）

- 产品命令 `workshop_pack_stage_zip/install_staged/abort_staged`：安全解压（条目/大小/总量/zip-slip/
  符号链接/缺 manifest 拒绝）+ staging 路径白名单；前端 adapter/面板 ZIP 按钮与 staging 路由；
- 验证：Rust cargo **50 passed**；产品 W **8/8**（有效 zip 安装 + zip-slip/E_STAGED 拒绝 + 用户实例安全）。
  证据：`evidence/P5-T26-W01-zip.md`；W01 仍缺 I 门禁（T27）。

## P6/T26 进度（guest internals 自检上报，2026-10-19）

- 协议守卫脚本无法移除 `__TAURI_INTERNALS__`（不可配置）→ 改为 postMessage 自检上报；宿主展示
  残余风险提示（`guest-isolation-warning`）并记录诊断；隔离探针复跑 **6/6 PASS**。
  证据：`evidence/P5-T26-A7-isolation.md` 追加节。

## 会话末段最终交接（2026-10-19）

- `HANDOVER-FINAL.md`：代码基线/回归数字/11 个真实产品 W 场景证据索引/里程碑判定
  （EXPERIMENTAL_TRUSTED_PACKS）/残余风险/事故记录/下一步建议。

## P6/T26 进度（W05 产品协议线，2026-10-19）

- 产品 guest host 接入真实 Broker/HostDispatcher；SDK GuestClient 经 t19-wire 完成握手 +
  context.snapshot（真实后端/修订/哈希）；会话状态 active/能力子集；W **7/7 PASS**。
  证据：`evidence/P5-T26-W05-protocol.md`。
- W05 剩余：subscribe/断连重连/慢包/超时 queryResult/取消冲突语义、write/print/command 产品实现。

## P6/T26 进度（W06 边界功能级验证，2026-10-19）

- guest 真实执行环境：fetch 相对/loopback/外部全阻断、blob worker 不执行、WebSocket 不连接、
  越权 context.write → E_CAPABILITY（granted 列表）——W **8/8 PASS**。
  证据：`evidence/P5-T26-W06-boundary.md`。
- 剩余：导航/下载/伪造消息系统化、loopback 资源白名单、Tauri 升级回归。

## P6/T26 进度（W07 尝试，未完成，2026-10-19）

- guest 无限循环故障探针：故障包安装成功，但实例停在 WorkspacePicker（KE_WORKSPACE 已激活而后端
  UI 未进入主界面），无法启用 guest → **W07 保持 NOT_RUN**，记录尝试与环境问题，不当作证据。
  证据：`evidence/P5-T26-W07-fault-attempt.md`。架构风险（同渲染进程阻塞）仍需独立设计与验证。

## P6/T26 进度（W07 无限循环类别通过，2026-10-19）

- 修正测试环境（预置 app_config/settings 自动打开工作区）后：guest 无限循环 → 宿主 IPC 仍可响应、
  心跳中断检测 suspended → 连续超限 failed + safeMode → 停用 stopped 持久化 → 宿主存活；W **8/8**。
  证据：`evidence/P5-T26-W07-fault.md`（前次尝试保留）。
- W07 剩余：CPU/内存压力、boot crash、桥接超时、连续启动失败、原生 Rust 恢复 + I 门禁。

## P6/T26 进度（W09 性能基线 FAIL，2026-10-19）

- 真实产品 W 3/7：启动 2.1s OK、无双编辑器；**256KB 打开 60.9s 未打开、512KB 23s、输入约
  991ms/字符、guest 启用 81s 未成功** → W09 未达预算，需性能剖析/优化；记录限制（公式密集 fixture、
  CDP 开销、重负载叠加）。证据：`evidence/P5-T26-W09-perf.md`。

## P6/T26 进度（W09 归因修正，2026-10-19）

- 诊断：plain256 首次 60.9s 属点击未命中（测量无效）；formula256 真实打开 10.6s；小文档打开 328ms/
  输入 13ms/guest 57ms 正常 → W09 修正为「正常路径 OK，大公式文档打开超预算」，需优化与严谨复测。
  证据：`evidence/P5-T26-W09-perf-diag.md`。

## P6/T26 进度（W09 复测：大文档打开 FAIL，归因体积，2026-10-19）

- MARKER 判定复测：plain256 12.2s、plain512 46.5s、formula256 11.5s 均打开成功；**瓶颈为文档体积
  而非公式**；小文档 328ms/输入 13ms/guest 57ms 正常 → W09 大文档打开 FAIL，需优化后复测。
  证据：`evidence/P5-T26-W09-perf-plain.md`。

## P6/T26 进度（W09 工坊口径 PASS，2026-10-19）

- 产品 W：打开文档、34 次逐字符输入后仅 1 次保存（防抖合并）、无双编辑器（1 实例）、8 次切换后
  仍 1 实例、堆增长 4.7MB → W09 工坊硬指标 **6/6 PASS**。
- 大文档首次打开慢属产品既有 @tiptap/markdown 解析限制（editor/index.ts P3-2 记录，非工坊回归）。
  证据：`evidence/P5-T26-W09-workshop.md`。

## P6/T26 进度（W02 表单交接 Core，2026-10-19）

- `core/session/formHandoff.ts`：begin/setField/submit/原子提交/迟到或重复幂等/关闭后拒绝/
  连接失效拒绝/失败保留可重试/drain；6 例 U 通过、tsc 0。产品 guest→host 接线与 W 未做。
  证据：`evidence/P5-T26-W02-formhandoff.md`。

## P6/T26 进度（W02 产品 title 交接 W 7/7，2026-10-19）

- 产品 host 白名单命令桥（article.set-title/set-tags，小写命令名符合 manifest schema）→ 后端
  `/api/articles/{rel}/meta` 原子写；guest SDK 经 Broker command.invoke 提交 title，未知命令
  E_COMMAND_NOT_ALLOWED；产品 W **7/7 PASS**。证据：`evidence/P5-T26-W02-form.md`。
- W02 剩余：tags/公式/重命名草稿、迟到命令、候选启动失败、提交后编辑器 UI 同步、IME 组字交接。

## P6/T26 进度（W02 title+tags 交接 W 8/8，2026-10-19）

- guest 经 Broker command.invoke 提交 title 与 tags，宿主后端 `/meta` 原子写，frontmatter 同时更新
  （`title: W02 交接标题` + `tags: [w02, 交接]`）；未知命令拒绝；产品 W **8/8 PASS**。
  证据：`evidence/P5-T26-W02-form.md`（guest 源码/探针已更新）。

## P6/T26 进度（W04 外部开发者路径 W 7/7，2026-10-19）

- `tools/create_pack.mjs`：外部脚手架（manifest/assets hash/README/自检 5/5，非法 id 与能力拒绝）；
- 真实产品 W **7/7**：外部脚手架 → 外部签名 → 产品安装（signature valid）→ guest active，
  无需修改宿主源码。证据：`evidence/P5-T26-W04-sdk.md`。
- W04 剩余：SDK 发布形态（npm/tgz/模板仓库）、文档站/示例集、签名工具分发。

## P6/T26 进度（W07 扩展故障类别：内存/CPU 压力 W 21/21，2026-10-19）

- 新增 `tools/run_t26_fault_mem_probe.py`（隔离产品构建 + 隔离 APPDATA/工作区 + 签名包 + CDP +
  按路径白名单清理；两场景可单跑 `--scenario mem|cpu` 或 `all`）。
- 场景 a 内存压力 **W 11/11**：guest 独立 renderer 累计分配 2048MB（32×64MB，0 allocation 失败，
  3.3s），期间宿主 IPC 13 采样 max **3.6ms**/0 超时、renderer 工作集 +2057MB、心跳持续 active；
  保持 2s 后注入 renderer 崩溃（**CDP Page.crash 注入，非自然 OOM**）→ ≈1.0s 检出 suspended →
  failed + safeMode → 停用 stopped 持久化；宿主存活、guest renderer 进程消失。
- 场景 b CPU 压力 **W 10/10**：40ms 分片 setTimeout 满载 6.0s（独立 renderer ≈**0.80 core**）期间
  宿主 IPC max **2.5ms**、心跳 +14、会话 active 未误判；2500ms 长任务链饥饿 → ≈**1.6s** 心跳超时检出
  suspended → failed + safeMode → 停用 stopped 持久化（worker 被 CSP 阻断，W06 已证）。
- 证据：`evidence/P5-T26-W07-fault-mem.md`、`evidence/T26-W07-mem-results.json`（含原始 checks/metrics）；
  用户 App 未运行 → 用户实例影响 N/A，未触碰用户进程/数据。
- W07 剩余：boot crash、桥接超时、连续启动失败、原生 Rust 恢复、I 门禁；自然 OOM 崩溃路径未触发
  （2GB 压力上限受同机安全约束，崩溃检测用注入验证）。

## P6/T26 进度（W04 SDK 发布形态 W 7/7，2026-10-19）

- 新增 `docs/ui-workshop/sdk/`：`@astranota/ui-workshop-sdk` 源码（TS）+ 构建脚本 + 产物
  `dist/guest-sdk.js`（iife，全局 `KeWorkshopSDK`）/`dist/guest-sdk.mjs`（ESM）；
  外部包可内联 dist 后 `autoConnect` 握手、`request('context.snapshot')`、`heartbeat`。
- 协议契约修正：SDK 初版握手消息误用 `handshake.request`，宿主 HostDispatcher 只识别
  `type:'handshake'` → E_TIMEOUT；修正后 SDK 自检 **4/4**、真实产品 W **7/7 PASS**。
  证据：`evidence/P5-T26-W04-sdk-dist.md`、`evidence/T26-W04-sdk-dist-results.json`。
- W04 剩余：npm/tgz 正式发布流程与版本策略、文档站/示例集/调试工具、发布密钥分发规范。

## P6/T27 进度（W08/T27 I 门禁就绪检查 dry-run NOT_READY，2026-10-19）

- 新增 `tools/run_t27_gate_check.py`（**只读 dry-run，绝不安装/不修改系统**）：
  候选 `AstraNota_1.2.18_x64-setup.exe` + 28 个历史安装包 + NSIS 配置齐备 → 6/8 PASS；
  阻塞 = `KE_T27_AUTHORIZED` 未授权 + `KE_T27_ISOLATED_ENV` 未声明 → **ready=false**。
- 明确口径：**这是就绪检查，不是 I 通过**；W03/W08 的 I 门禁仍 **NOT_RUN**，execute 需主理人授权 +
  专用隔离环境。证据：`evidence/P5-T26-W08-gate-prep.md`、`evidence/T27-gate-readiness.json`；
  执行计划见 `reports/T27-installer-upgrade-plan.md`。

## 交付整理（最终）：验证矩阵 + 交付状态文档（2026-10-19）

- 验证矩阵 `validation-matrix.csv` 重新生成（**51 行**，`--check` PASS）：新增纳入 A7/A5 guest、
  A7 隔离、A8 保存、IME/DPI、隔离冒烟、W04 外部路径、W04 SDK 发布形态、W07 内存/CPU 扩展等
  results JSON；新增 T27 就绪检查 **READINESS 行（NOT_READY 6/8，非验收通过）**；
  基线修正 cargo 38→**50**、工坊 UI 单测 18→**19**（本地复跑核对）；W09 大文档性能继续
  **KNOWN_FAIL（已知限制）**，未改成通过。
- 文档：新增 `reports/FINAL-DELIVERY-STATUS.md`（一页式：已通过/部分/未通过 + 下一步）；
  `HANDOVER-FINAL.md` 重写为最终交付状态（基线/W 证据索引/里程碑/残余风险/NOT_RUN/复现命令/事故）；
  `reports/T26-acceptance-status.md` 修正过期「项目级 P0_READY」表述为
  **`EXPERIMENTAL_TRUSTED_PACKS`**（ACCEPTANCE A 节 + `milestone-assessment.md` 口径），更正
  A7 隔离核对 5/5→**6/6**，补录 W04 SDK/T27 就绪；`HANDOVER.md` 顶部标注为历史阶段快照。
- 一致性核对：文档中所有「通过」均引用 evidence 文件；部分通过一律标「部分」；未推送/未 Release。


## P6 进度（F01–F16 覆盖审计，2026-10-19）

- 报告 `reports/F01-F16-COVERAGE.md`（fdac4ea）：F01–F16 guest 入口 0 已实现/3 部分/13 未实现；
  G1 内容读通道、G2 写通道假桩、G3 print 桩、G4 事件 0 发射、G7 台账空白列为 P0 缺口。
- 后续：G1/G2 修复（内容读 + 真实写）与逐项台账补齐为下一阶段优先项。

## P6 进度（Agent Team 并行：G1/G2、W02 迟到、W07 boot，2026-10-19）

- G1/G2 闭环（1ea4c62，W 14/14）：guest 可读正文 + 真实写回（context.write trusted/builtin，假桩删除）；
- W02 迟到请求/旧连接失效（d502d9d，W 12/12，重放验证、不落盘）；
- W07 boot crash/连续启动失败（5921ec4，44 checks 40 PASS/4 真实缺口，PASS_WITH_FINDINGS）；
- F01–F16 审计（fdac4ea，0 已实现/3 部分/13 未实现，G1/G2 结构阻塞已闭环）；
- T27 I 门禁：云端执行交接单（582f386），待主理人 VM 执行后登记 I 证据。
- 矩阵 53 行 --check PASS。

## P6 进度（G3/G4 打印+事件闭环，2026-10-19）

- print.snapshot 真实打印（PDF 真实/不覆盖/错误如实）+ 3 类宿主事件到达 guest；U+W 18/18 PASS。
  已知限制：打印阻塞主线程→心跳超时放宽 8s；PDF 测试输出诊断覆盖；公式 NodeView 打印为 LaTeX。
  证据：`evidence/P5-T26-G3G4-print-events.md`。

## P6 进度（G7 参考包 A/B，2026-10-19）

- pack A（读）/ pack B（写）参考 UI + 构建签名工具 + 产品 W **24/24**；私钥不入仓/dist gitignore。
  证据：`evidence/P5-T26-G7-reference-packs.md`。
- F01–F16 逐项台账仍 0/130（参考包只是载体）；SDK 事件订阅/当前文档发现通道仍缺。

## P6 进度（W07 桥接/sidecar/原生恢复 + F 台账 v1，2026-10-19）

- W07 bridge（5945aaf/f87f243）：39 checks 30 PASS/9 真实缺口（sidecar 自动重启/重启恢复 OK；
  自动重启后上下文丢失 404、超时 E_INTERNAL、可观测性缺口）；证据 `P5-T26-W07-fault-bridge.md`。
- F 台账 v1（4528897）：`run_feature_entry_probe.py` + CSV 登记 27/130 行（官方 UI 26 PASS）；
  第二轮待跑（pack A 事件/主题/停用修复）；不宣称 F01–F16 达成。

## P6 进度（F 台账 v2，2026-10-19）

- 第二轮窗口：probe **40/40 checks PASS**；CSV 27/130 行（官方 UI 26 PASS、pack A/B 各 4 PASS，其余
  能力面 NOT_RUN）。v1 3 项失败根因=探针误关工坊面板（非产品失败），修复后事件三项 PASS 并标注方法。
- 未覆盖：F14 导出落盘、F16 原生菜单、F03 其余 35 行；**不宣称 F01–F16 整体达成**。
  证据：`evidence/P5-T26-F-ledger.md`（v2）。

## P6 进度（W07 B-6/A-10 修复+复测，2026-10-19）

- 443e0a6 修复：B-6 上下文重建重试；A-10 超时 → E_TIMEOUT/retryable；单测+32、tsc 0。
- 4780319 产品 W 复测：B-6、A-10 均 FAIL→PASS（snapshot 42ms 恢复；超时 E_TIMEOUT）；W07 bridge
  最终 32/39，剩 7 缺口（崩溃 UI/session/stale pid、启动 recover 无提示、no-fallback 不可修）。
  仍 PASS-with-gaps，不宣称全通过。

## P6 进度（W07 B-4/B-5/B-8 修复+复测，2026-10-19）

- deed2a7：RuntimeHealthBanner + host 不可用会话挂起/恢复 + stale runtime 清理；cargo 57、vitest 1915。
- e794a06：B-4/B-5/B-8 FAIL→PASS；W07 bridge 最终 40 checks 36 PASS/4 缺口（仅 C 类 recover UI 提示 +
  no-fallback 不可自动修复）；仍 PASS-with-gaps。

## P6 进度（W07 C1-4/C2-2/C3-5 修复+复测，2026-10-19）

- a41d449：启动 recover 状态只读命令 + Panel startup notice（只读、可关闭、预置 safeMode 横幅）。
- dcb04d7：C1-4/C2-2/C3-5 FAIL→PASS；W07 bridge 最终 45 checks 43 PASS/2 缺口（C2-3 入口角标、
  C2-7 no-fallback 不可自动修复）；仍 PASS-with-gaps。

## P6 进度（F 台账 v3：F03 批量 + F14 尝试，2026-10-19）

- 78e5c25：checks 60/63；F03 +22 行（19 PASS/3 FAIL）；CSV 49/130 已登记（官方 45 PASS/3 FAIL）；
  F14 对话框/预览 PASS、最终导出 NOT_RUN（USERPROFILE 隔离限制）+ preview_pdf 真实 PDF 补充证据。
- 未覆盖：F03 剩余 12 行、F16 原生菜单等；不宣称 F01–F16 达成。

## P6 进度（W07 C2-3 + boot 三缺口修复+复测，2026-10-19）

- a80ec8b/b030b25：入口角标、启动失败可观测、孤儿 sidecar 自愈、损坏 settings 备份重置。
- 543bb08：四项 FAIL→PASS；W07 bridge 45/46（剩 C2-7 no-fallback 自动修复）、boot 43/45
  （剩 B1-6/B2-5 运行期无自愈需重启）。仍 PASS-with-gaps。
