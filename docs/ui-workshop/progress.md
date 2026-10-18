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
当前里程碑状态：**P0_READY**（项目级口径不变）；P1 `P1_READY_PENDING`；P2 `in_progress`；P3 `EXPERIMENTAL_CORE_ONLY`。判定依据见 `reports/P1-report.md`、`reports/P2-P3-report.md`
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
| T17 | in_progress | frontend/src/core/packs/{manifest,store,+test} | evidence/P3-T17-pack-loader.md（14 例 U：清单无损拒绝/安装事务/回滚/崩溃恢复/损坏回退） | 真实 Tauri fs 与 Windows 安装证据；候选扫描/首次安装确认 UI；能力执行强制（T18）；包签名 | Tauri fs 适配 + T18 broker 强制 → Windows 安装证据（T21） |
| T18 | in_progress | frontend/src/core/broker/{broker,binding,+2 tests}；protocol command.invoke；probe/* + s1 原型 broker 场景 | evidence/P3-T18-broker.md（**37 例**：broker 9+binding 9+protocol 19）、**P3-T18-broker-probe.md（Windows/WebView2 12/12）** | 真实产品 guest 连接建立/产品壳接线；三档授权 UI（T22）；后端写口来源收紧端到端 | 产品 guest 连接接线 + T22 授权 UI → T21 Windows 包安装 |
| T21 | in_progress | 原型 pack_store_proto.rs+probe（W 20/20）；产品壳 pack_store.rs（scan/install/list/verify/activate/rollback/recover/**uninstall**）+ 命令注册 + Rust 测试；前端适配器/UI 集成 | evidence/P3-T21-pack-install-probe.md（W 20/20）、P3-T21-product-pack-store.md（**cargo 34/34 + release 构建**）、P3-T23-workshop-integration.md | 签名校验；Windows 端到端交互 W（安装→启用→回滚→卸载）；升级 UI；与 T20 启动恢复合并 | Windows E2E W → T21/T26 |
| T12 | in_progress | backend: context_registry tree/search/save_article + routers/context.py + 2 test files | evidence/P1-T12-domain-migration-slice.md（只读域 5 例）、**P1-T12-write-domain-slice.md（写域 6 例 + 契约 51 路径/63 方法 + 全量 846 collected 双平台绿）** | 重命名/删除/附件/导入导出/print job 未绑定；真实 store/indexer/history/watcher 未迁移；前端未切换调用 | 其余写域 + 真实 store 迁移 → T14 接线 |
| T13 | in_progress | core/gate/t13_gate.ts + run_t13_gate.sh；SaveCoordinator 恢复日志修复 | **P1-T13-core-gate.md（UI-free 门禁 21/21 PASS）**、**P1-T13-instance-probe.md（Windows 单实例/退出协调 6/6）** | 打印 job（T16）、Rust 原生恢复（T20）未覆盖；产品工作区打开流程合并验证待做 | 补打印/Rust 恢复项 → P1 阶段报告 |
| T14 | in_progress | frontend/src/core/session/productAdapter.ts + test；SaveCoordinator.subscribe | evidence/P2-T14-product-adapter.md（适配层 6 例 + session 29 例 + tsc 0） | 未接真实 EditorArea/SaveQueue（双写开关/恢复点/源码直存兼容）；无 W 证据 | 接线真实 EditorArea + 后端上下文端点 → T15 IME/DPI W |
| T15 | in_progress | s2 harness __s2 + tauri capabilities + run_t15_cdp_probe.py | **evidence/P2-T15-ime-zoom-probe.md（Windows/WebView2 CDP 8/8）** | 真实 OS 中文 IME/多 DPI 拖拽/失焦遮挡未测；产品 EditorSession 接线后需回归 | 真实 IME/DPI 矩阵补测 + T14 接线回归 |
| T16 | in_progress | frontend/src/core/print/{printJob,test} | evidence/P2-T16-print-core.md（12 例 U：快照绑定/状态机/串行/取消/超时/路径校验）+ 既有 S4 真实 PDF W 6/6 | 产品隐藏 renderer+Rust PrintToPdf 接线；长文档分页/主题/源码打印；取消清理与 job 对账；打印 UI + W | 隐藏 renderer 接线 + 长文档 → T21/T26 W |
| T22 | in_progress | frontend/src/core/packs/{installPolicy,installPolicy.test} | evidence/P3-T22-install-confirmation.md（9 例 U：预览/风险/签名阻止/显式确认门禁/一次性 token/过期/一致性；packs 共 23 例） | 工坊控制面 UI（T23）；真实下载/签名验证；来源信任持久化；Windows W 交互 | T23 工坊控制面 UI + 签名验证 → T21/T26 W |
| T23 | in_progress | frontend/src/components/workshop/{WorkshopPanel,WorkshopEntry,+tests}；core/packs/tauriPackAdapter；App flag 入口 | evidence/P3-T23-workshop-panel.md（7 例）、**P3-T23-workshop-integration.md（适配器 6 例 + 入口 3 例 + 全量 122 files/1733 passed）** | 真实包目录选择（dialog/zip）；Windows 端到端交互 W；签名/来源信任/卸载；启动 recover 合并 | Tauri dialog + Windows E2E W → T21/T26 |
| T20 | in_progress | desktop pack_store recover_all + lib.rs setup 启动恢复 + 状态文件/事件；adapter dialog；**safeMode UI 呈现（徽标/横幅/全部修复）** | evidence/P3-T20-startup-recover.md（cargo 33/33 + build；工坊+pack 43 例；全量 122 files/1737 passed） | Windows 端到端 W；safeMode 未阻断危险操作；与单实例/退出协调合并；卸载 | Windows 包故障启动 W → T24/T26 |
| T19 | in_progress | frontend/src/core/packs/{packageHost,packageHost.test} | evidence/P3-T19-package-host.md（7 例 U：会话/完整性/崩溃升级/safeMode/重启 epoch/停止） | 真实 guest WebView 会话装配与包入口加载；与 T20 恢复联动；Windows 故障注入 W | 装配真实 guest 会话 → T21/T24 W |
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
