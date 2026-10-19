# F01–F16 guest 原生入口覆盖审计报告

- 日期/时区：2026-10-19（Asia/Shanghai）
- 分支/HEAD：`feat/ui-workshop` @ `3117c7d`（本地分支，审计前后工作树干净；未 push、未 Release）
- 审计对象：**F01–F16 验收域的 guest（UI 包）原生入口覆盖**，即「一个外部 guest 包能否经受控协议/Broker 完成该功能域的代表性用户任务」
- 审计方式：源码 + 文档静态审计；guest 链路 U 测试本轮复跑（6 files / **45 tests passed**）；Windows W 证据**只做文档交叉核对，未复跑**（见 §7）
- 结论一句话：**F01–F16 guest 原生入口覆盖尚未达成**——16 项中 **0 项已实现、3 项部分、13 项未实现**；`feature-baseline.csv` 的 121 条 F 域基线行里，`packAEntry`/`packBEntry` **0 行**登记、`officialBaselineResult` **130/130 行仍为 `NOT_RUN`**。

> 范围声明：本报告**不判定官方 UI 自身功能是否好用**（那是官方 UI 基线/回归的范畴）；只判定「guest 入口是否可达、是否有真实实现与证据」。凡无 U/W 证据的项不写「已通过」。

---

## 0. 结论摘要（先看这里）

### 0.1 量化统计

| 维度 | 实测值 | 依据 |
| --- | --- | --- |
| F01–F16 状态 | **已实现 0 / 部分 3（F02、F10、F14）/ 未实现 13** | §3 逐项 |
| guest 协议方法 | 共 **5** 个：真实产品实现 2 个完整（`protocol.capabilities`、`context.snapshot`）+ `command.invoke` 仅 **2 条**白名单命令；**桩 2** 个（`context.write`、`print.snapshot`） | `frontend/src/core/protocol/types.ts:119-138` |
| 可声明能力 | 6 个；有协议消费点的 3 个（`ui.shell`/`context.read`/`print.request`）；**无任何消费点 3 个**（`panel.sidebar`/`panel.dock`/`editor.commands.readonly`）；**`context.write` 不在可声明集合 → guest 永远拿不到写能力** | `frontend/src/core/packs/manifest.ts:13-20`、`frontend/src/core/broker/broker.ts:51-56` |
| 宿主事件 | 5 类已定义（`context-changed`/`theme-changed`/`selection-changed`/`document-saved`/`host-shutdown`），产品 guest 装配中**发射 0 类** | `types.ts:65-70`、`core/protocol/channel.ts:229`；`WorkshopGuestFrame.tsx` 无 `emit` 调用 |
| `feature-baseline.csv` | 130 行（F 域 121 行 + P3/P4 9 行）；`packAEntry` 非空 **0**、`packBEntry` 非空 **0**、`officialBaselineResult=NOT_RUN` **130** | 本报告 §2.2 统计脚本口径 |
| pack A/B 参考 UI | **不存在**；仓库内只有 T19/W02 等**探针包**（`docs/ui-workshop/core/packs/probe/`），不是两套结构不同的参考 UI | `find`/`grep`；`P5-T26-W05-protocol.md:33` 自述「guest 原生入口全任务覆盖（F01–F16）未做」 |
| guest 链路 U 测试（本轮复跑） | 6 files / **45 passed**（contract 12、broker 10、binding 8、productHostAdapter 9、guestHost 4、WorkshopGuestFrame 2） | 见 §7 复现命令 |

### 0.2 与既有交付文档的口径关系

既有文档已如实写「**部分**」并注明「guest 入口全任务覆盖未逐项验证」（`HANDOVER-FINAL.md:134`、`reports/milestone-assessment.md:65`、`reports/T26-acceptance-status.md:73`、`reports/FINAL-DELIVERY-STATUS.md:53`、`evidence/P5-T26-W05-protocol.md:33`）。本报告的增量是把它**量化为「0 已实现 / 3 部分 / 13 未实现 + 0/121 行登记」**，并给出可执行的最小实现顺序（§5）。若沿用「部分」一词需注意：这里的「部分」仅指 3 个切片，F01–F16 的**主体能力（读内容、写文档、编辑命令、历史、附件、搜索、导入导出、打印、设置、桌面行为）对 guest 全部不可达**。

---

## 1. 审计口径与来源（不编造任务包要求）

### 1.1 任务包原件缺失与替代来源（重要）

`astranota-ui-workshop-taskpack-2026-10-18` 的 `ACCEPTANCE.md` / `TASKS.md` / `ARCHITECTURE.md` **不在当前仓库**（`git log --all -- "*ACCEPTANCE*" "*TASKS*"` 无提交历史，仓库内亦无同名文件）。因此 F01–F16 的定义按下述**仓库内可追溯来源**提取，未凭空补写：

| 内容 | 来源（文件:行） | 说明 |
| --- | --- | --- |
| F01–F16 域名、一句话需求、requiredPlatforms | `docs/ui-workshop/tools/build_feature_baseline.py:228-243` | 脚本注释明确标注来源为「**ACCEPTANCE.md §C**」；本报告 §3 的「一句话需求」逐字取自该表 |
| 每域的 hostService/hostCommand/officialPanel/workshopTaskId 映射 | 同文件 `:47-62`（`DOMAIN_META`） | 由 T01 人工映射，用于定位官方入口与工坊任务 |
| 121 条 F 域逐项基线行 | `docs/ui-workshop/feature-baseline.csv`（由上述脚本生成） | 列定义引「任务包 ACCEPTANCE.md **B1**」 |
| 「guest 原生入口覆盖」的验收含义 | `docs/ui-workshop-feasibility.md:233`、`:250`；`reports/P0-report.md:48`；CSV 列 `packAEntry`/`packBEntry` | 可行性文档第 8 节把「**包内原生入口覆盖**」列为功能完整性五维之一，并要求「**两套结构明显不同的 UI 必须经真实入口完成同样的用户任务**」；P0 报告注明「包 A/B 原生入口列留 T24 填写」 |

**推断与假设（必须随结论一起读）**：
1. 任务包 `ACCEPTANCE.md §C` 的**逐项通过标准原文不可得**，本报告只能按 §C 的一行域名 + 可行性文档第 8 节功能矩阵推断「代表性用户任务」；若任务包原文对某域另有细化标准，以原文为准。
2. 本报告按**最严格口径**假设「F01–F16 每一域都应存在 guest 原生入口」。若主理人/任务包确认 F16（桌面行为）、F01（工作区生命周期）、F11（回收站）等属**宿主独占、不要求 guest 入口**，则应从覆盖硬指标中豁免；但即使豁免 3 域，剩余 13 域中仍只有 3 个切片「部分」。
3. `packAEntry`/`packBEntry` 两列即任务包要求的「包 A / 包 B 原生入口」登记位；**列空 = 未登记 = 不能声称覆盖**。

### 1.2 状态判定标准（本报告自定，供复核）

| 状态 | 判定条件 |
| --- | --- |
| **已实现** | guest 经受控协议可达 + **产品真实实现（非桩）** + 有 U 或 W 证据覆盖该域代表性任务，缺一不可 |
| **部分** | 满足三者之一：guest 可达但仅覆盖该域一小片；协议/授权/宿主侧就绪但产品 guest 侧为桩或未接线；只有探针级证据 |
| **未实现** | 无 guest 可达入口；或所需能力不可授予；或只在文档/类型里「定义」而产品无接线 |

官方 UI 现有功能**不计入** guest 覆盖；`NOT_RUN` 不算通过；纯类型定义不算实现。

### 1.3 已阅读的审计对象（实现侧）

- 前端：`core/packs/guestHost.ts`、`productHostAdapter.ts`、`packageHost.ts`、`manifest.ts`、`trustPolicy.ts`、`store.ts`、`tauriPackAdapter.ts`（guest 工厂）；`components/workshop/WorkshopGuestFrame.tsx`、`WorkshopPanel.tsx`；`core/protocol/{types,channel,transport}.ts` 及 contract 测试；`core/broker/{broker,binding}.ts`；`core/session/coreSaveBridge.ts`（关联）。
- 后端：`backend/app/routers/context.py`、`backend/app/services/context_registry.py`（snapshot/tree/search/article/save/write/request）、`backend/app/routers/*`（workspace/documents/fs/attachments/search/tags/index/trash/history/drafts/import_export 等官方域路由，用于判定「宿主已有能力、只差 guest 暴露」）。
- Rust：`desktop/src-tauri/src/workshop_protocol.rs`（workshop 自定义协议/ CSP/硬化）、`pack_store.rs`（pack 生命周期 + `workshop_pack_session_status/report`）、`lib.rs`（命令注册）、`menu.rs`、`print_snapshot.rs`。
- SDK/探针：`docs/ui-workshop/sdk/src/index.ts`（握手/request/heartbeat/autoConnect）、`core/packs/probe/{t19_guest,w02_guest}.ts`。
- 文档证据：`feature-baseline.csv`、`P5-T26-A7-A5-guest.md`、`P5-T26-A7-isolation.md`、`P5-T26-W05-protocol.md`、`P5-T26-W02-form.md`、`P5-T26-W02-formhandoff.md`、`P5-T26-W04-sdk-dist.md`、`P5-T26-W06-boundary.md`、`P5-T26-A2-print.md`、`P5-T26-A8-save.md`、`P1-T12-*`、`P6-final-verification.md`、`P0-report.md`、`HANDOVER-FINAL.md`、`reports/milestone-assessment.md`、`reports/FINAL-DELIVERY-STATUS.md`、`adr/ADR-004-product-package-host.md`、`docs/ui-workshop-feasibility.md`。

---

## 2. 覆盖统计

### 2.1 逐域汇总表

| 项 | 一句话需求（ACCEPTANCE §C） | CSV 基线行数 | guest 现有通道 | 状态 |
| --- | --- | ---: | --- | --- |
| F01 | 工作区创建/打开/最近/关闭、文档标签与导航 | 10 | 无（`workspace.*` 未暴露；只有 `E_STALE_CONTEXT` 拒绝语义） | **未实现** |
| F02 | 文档和目录新建/改名/移动/删除/元数据 | 6 | 仅 `command.invoke` 2 条命令：`article.set-title` / `article.set-tags`（W 文档记录 8/8） | **部分** |
| F03 | 全部文本格式、列表、链接、任务、撤销/重做、大纲定位 | 42 | 无（`editor.commands.readonly` 能力可声明但无方法/无消费点） | **未实现** |
| F04 | 行内/块公式、MathLive 输入、公式转换、长公式 | 1 | 无 | **未实现** |
| F05 | 表格全部深层操作 | 1 | 无 | **未实现** |
| F06 | KE 模块、信息块、脚注、视频、特殊节点与未知标记 | 3 | 无（无内容读取通道，guest 拿不到文档正文/节点） | **未实现** |
| F07 | 手动/自动保存、恢复登记、持续输入恢复 | 3 | `context.write` 协议存在但**能力不可授予** + 产品桥为桩 | **未实现** |
| F08 | 草稿/历史恢复、外部修改、重载 | 4 | 无方法；`document-saved`/`context-changed` 事件已定义未发射 | **未实现** |
| F09 | 附件选择/拖放/粘贴上传、引用、孤儿管理 | 5 | 无（guest 网络被 CSP `connect-src 'none'` 阻断，且无附件方法） | **未实现** |
| F10 | 搜索、高亮、tags、索引重建 | 5 | 仅 tags **写入**切片（`article.set-tags`，W 记录落盘）；搜索/索引无通道 | **部分** |
| F11 | 回收站恢复/永久删除 | 3 | 无 | **未实现** |
| F12 | 源码模式、原字符串、frontmatter、BOM/CRLF、HTML | 1 | 无内容读/写通道（`context.snapshot` 只返回 revision/diskHash） | **未实现** |
| F13 | KE/普通 Markdown/ZIP 导入导出、附件映射 | 6 | 无 | **未实现** |
| F14 | PDF 预览及真实导出 | 1 | `print.snapshot` 协议+能力+Broker 授权齐备，但产品实现返回**桩值**（无真实 PDF） | **部分** |
| F15 | 设置、主题、补全、快捷键、维护功能 | 19 | 无；`theme-changed` 已定义未发射 | **未实现** |
| F16 | 桌面菜单、关闭/重载、单实例等桌面行为 | 11 | 无（guest 不应也不能触达窗口/菜单；`host-shutdown` 已定义未发射） | **未实现** |

### 2.2 统计口径明细

- **逐项统计**：已实现 **0/16（0%）**；部分 **3/16（18.75%）**；未实现 **13/16（81.25%）**。
- **按基线行统计**：`packAEntry`/`packBEntry` 登记 **0/121**。而且 3 个「部分」切片**对不上任何一条具体基线行**：CSV 的 F02 行是 `GET /api/tree`、`PUT /api/fs/*` 等（guest 不可达），F10 行是 `GET /api/search|tags|/api/index/rebuild`（guest 只有 tags **写**，连 tags 读都没有），F14 只有验收域行；文章 meta / print 的 guest 切片在 CSV 里没有对应行。→ **按逐行口径，guest 原生入口登记与覆盖 = 0/121**；仅存在 3 个跨行的能力切片。
- **证据等级**：F02、F10 有 1 条 W 证据（`P5-T26-W02-form.md`，title/tags 切片，文档记录 8/8）；F14 只有 U（协议/授权）无 W；其余 13 项无任何 guest 域级 U/W 证据。
- **官方基线行**：`officialBaselineResult` **130/130 = NOT_RUN**；现有「官方 UI 基线回归绿」仅指**整套回归套件**（`P6-final-verification.md`：前端 1819 passed / 后端 847 collected / cargo 50），**不是**逐项真实入口核对。

---

## 3. 逐项审计 F01–F16

> 每项固定四段：**需求 / 判定 / guest 现状与证据 / 缺口与最小实现建议**。行号基于 HEAD `3117c7d`。

### F01 工作区创建/打开/最近/关闭、文档标签与导航

- **需求**：guest 包能完成工作区生命周期与文档标签导航类用户任务（官方入口：WorkspacePicker / 顶栏工作区；hostService `WorkspaceService`；关联 T09/T12）。
- **判定**：**未实现**。
- **guest 现状与证据**：协议无任何 `workspace.*`/`context.open` 方法（`core/protocol/types.ts:119-138`）；Broker 只有 `E_STALE_CONTEXT` 拒绝旧 epoch 的语义（`core/broker/broker.ts:84-89`），无「上下文已切换」主动通知。宿主侧能力其实存在：后端 `POST /api/context/{open,switch,current,close,lease,release}`（`backend/app/routers/context.py:87-131`，A 证据 `P1-T09-product-slice.md`）；但这些端点**未暴露给 guest**，且 guest 被 CSP 禁止直连（`workshop_protocol.rs:61-68`）。CSV F01 10 行全部 `NOT_RUN`、`packAEntry` 空。
- **缺口与最小实现建议**：工作区生命周期应保持**宿主独占**（安全边界），guest 只需「只读当前上下文 + 切换通知」。最小实现：①在 `ProtocolMethods` 增加 `context.current`（返回 contextId/epoch/root 摘要）与 `context.tree`（见 F02/F10 复用，后端 `/api/context/tree` 已有，A 5 例）；②由宿主在切换上下文时 `dispatcher.emit({type:'context-changed',...})`（见 F08 共性缺口 G4），guest 收到后自行失效缓存；③**不开放** open/switch/close 给 guest。验收：U（GuestClient 收事件/读 current）+ W（切工作区后 guest 收到事件且旧连接请求被 `E_STALE_CONTEXT`）。

### F02 文档和目录新建/改名/移动/删除/元数据

- **需求**：guest 能通过真实入口完成文档/目录的创建、改名、移动、删除与元数据（title/tags）修改。
- **判定**：**部分**（仅元数据切片）。
- **guest 现状与证据**：`command.invoke` 白名单仅 2 条命令：`article.set-title` / `article.set-tags`（`frontend/src/core/packs/productHostAdapter.ts:142-173`；`components/workshop/WorkshopGuestFrame.tsx:66-72`）。宿主经后端 `PUT /api/articles/{rel}/meta` **真实原子写**，W 证据文档记录 8/8（`evidence/P5-T26-W02-form.md`：title/tags 落盘、未知命令拒绝）；核心状态机 U 6/6（`evidence/P5-T26-W02-formhandoff.md`）。命令白名单由 manifest 声明（`manifest.ts` 的 `commands` → `packageHost.ts:114` → `broker.ts:99-105`）。**新建/改名/移动/删除（文档与目录）无任何 guest 通道**；F02 CSV 6 行全 `NOT_RUN`。
- **缺口与最小实现建议**：①把写命令接入 `formHandoff` 状态机（`core/session/formHandoff.ts`，已有 U 6/6）以保证重命名草稿交接/迟到命令语义；②新增白名单命令 `article.create` / `article.rename` / `article.move` / `article.delete`，host 侧映射到既有后端（`routers/documents.py`、`fs.py`；或 T12 写域继续迁移后的 context 端点），逐命令做路径/确认门禁（删除需宿主确认 UI）；③在 `feature-baseline.csv` 对应 F02 行填 `packAEntry`/`packBEntry` 与 `officialBaselineResult`。验收：U（白名单/参数/未知命令拒绝）+ W（探针包经真实入口建/改/移/删文件后磁盘断言）。

### F03 全部文本格式、列表、链接、任务、撤销/重做、大纲定位

- **需求**：guest 包能通过真实入口触发全部文本格式/列表/链接/任务/撤销重做/大纲定位类编辑动作，且行为与官方一致。
- **判定**：**未实现**。
- **guest 现状与证据**：能力 `editor.commands.readonly` 可声明（`manifest.ts:13-20`、`trustPolicy.ts:37-41`），描述为「发起只读编辑命令（选择/滚动/复制，不写正文）」（`core/packs/installPolicy.ts:44`），但：协议**无 editor 方法**、Broker `METHOD_CAPABILITIES` 无映射（`broker.ts:51-56`）、产品**无 handler/消费点**（全仓 `grep editor.commands.readonly` 仅出现在 manifest/trustPolicy/installPolicy）；`command.invoke` 白名单不含任何 `editor.*`。官方动作目录在 `frontend/src/state/shortcuts.ts`（CSV 42 行，全部 `NOT_RUN`、`packAEntry` 空）。S2/ADR-001 结论是官方编辑面不交给包（`adr/ADR-001-runtime-route.md`），因此 guest 只能「请求宿主代为执行」，当前无此桥。
- **缺口与最小实现建议**：明确二选一并写进 ADR：①**首发不做编辑命令**——从首发能力表移除 `editor.commands.readonly`（避免「可声明但不可用」的假能力，见 G5），F03 记录为 de-scope；或②实现只读编辑命令桥：新增协议方法 `editor.command`（如 `selection.get`/`scrollTo`/`outline.list`/`copySelection`），Broker 能力 `editor.commands.readonly`，host handler 映射到官方 Editor 命令目录（复用 `shortcuts.ts` action id），并禁止写正文（写必须走 F07/F12 的文档通道）。验收：U（能力矩阵/越权）+ W（两套 UI 各自真实入口）。

### F04 行内/块公式、MathLive 输入、公式转换、长公式

- **需求**：guest 能完成行内/块公式插入、MathLive 输入与公式转换、长公式场景，且渲染与官方一致。
- **判定**：**未实现**。
- **guest 现状与证据**：官方公式能力在 `components/editor/MathEditorModal.tsx` 与 Tiptap/MathLive 编辑面内部；guest 既无命令通道（同 F03），也无内容读取通道（`context.snapshot` 不返回正文，`types.ts:121`），无法发起或校验公式编辑。CSV F04 1 行 `NOT_RUN`。
- **缺口与最小实现建议**：依赖 F03 的只读命令桥 + F06/F12 的内容读通道；最小可交付是「guest 请求宿主打开官方公式编辑器/插入公式节点」（命令 `editor.math.insert`，由宿主执行并打开官方 MathEditorModal），MathLive 输入本身仍由官方编辑面承担，guest 只触发不渲染。验收：W（guest 触发 → 官方公式编辑器出现 → 文档节点落盘为官方格式）。

### F05 表格全部深层操作

- **需求**：guest 能完成表格深层操作（插行/列、合并、删除、列宽等），行为与官方一致。
- **判定**：**未实现**。
- **guest 现状与证据**：官方入口为 `components/editor/TableBubbleMenu.tsx` 与工具栏表格菜单；无 `editor.table.*`/`table.*` 方法、无白名单命令；CSV F05 1 行 `NOT_RUN`。
- **缺口与最小实现建议**：同 F03/F04 的只读/受控命令桥；最小交付 `editor.table.command`（受限动作枚举，host 侧执行）或 de-scope 记录。验收：W（guest 触发插行/删表后文档结构与官方一致）。

### F06 KE 模块、信息块、脚注、视频、特殊节点与未知标记

- **需求**：guest 能读写 KE 特殊节点（模块/信息块/脚注/视频/未知标记）且往返保真。
- **判定**：**未实现**。
- **guest 现状与证据**：**guest 根本没有文档内容读通道**：`context.snapshot` 返回 `{relPath, revision, diskHash}`（`types.ts:121`），后端 `context_registry.snapshot` 同样只回 revision/diskHash 与 context_id，不含 content（`backend/app/services/context_registry.py::snapshot`）；`context.write` 是桩且能力不可授予（见 F07/G2）。KE codec/保真只在官方 Core/编辑面（T08 原型 `docs/ui-workshop/core/codec/`；官方 `ke.ts`/serializer），guest 无入口。CSV F06 3 行 `NOT_RUN`。
- **缺口与最小实现建议**：**内容读通道是解锁 F06/F12/F04 等的最高杠杆项**（P0-1）：给 `context.snapshot` 增加 `content`（受 512KiB/请求上限约束，或新增分页/摘要方法）或新增 `context.content` 方法；由 backend `context_registry` 返回当前 revision 对应的正文（含未保存恢复登记内容需另评审）。验收：U + W（guest 读取 `fixtures/basic.md` 与官方一致；特殊节点 roundtrip 字节级）。

### F07 手动/自动保存、恢复登记、持续输入恢复

- **需求**：guest 能触发/参与手动与自动保存、恢复登记与持续输入恢复，且保存语义与官方一致（CAS/revision/持久化标志）。
- **判定**：**未实现**（协议骨架就绪，但**结构性不可达** + 产品桥为桩）。
- **guest 现状与证据**：
  1. 协议方法 `context.write` 已定义 CAS/幂等结果类型（`types.ts:122-134`），Broker 授权映射为能力 `context.write`（`broker.ts:52`），U 覆盖（`broker.test.ts`/`binding.test.ts`，本轮 18 例 pass）；
  2. **但 `context.write` 不在可声明能力集合**（`manifest.ts:13-20` 只有 6 个能力，`trustPolicy.ts:37-41` 同样没有）→ 任何包都不可能声明该能力 → guest 角色请求必得 `E_CAPABILITY`（与 W06 越权证据一致：`P5-T26-W06-boundary.md` W-T26-W06-6 `granted=[ui.shell,context.read]` 时 `context.write` 被拒）；只有 `role:'official'` 才能绕过能力检查（`broker.ts:92-95`、`broker.test.ts:67`）；
  3. 产品 `ProductBrokerBackend.write` 是**桩**：直接返回 `{requestId, status:'completed', revision:1, fileDurable:true}`，**不调用任何后端、不落盘**（`components/workshop/WorkshopGuestFrame.tsx:60-62`）——即使未来授予能力，也会产生「假完成/假 durable」的静默数据风险；
  4. 宿主官方保存链是真实且已验证的，但与 guest 无关：`core/session/coreSaveBridge.ts`、`CoreSaveCoordinator`（U 21 例）、后端 `POST /api/context/write`（`context.py:168-176`，A 6 例 `P1-T12-write-domain-slice.md`）、A8 产品 UI 保存 W 9/9（`P5-T26-A8-save.md`）。
- **缺口与最小实现建议**：先做**能力策略决策**（P0-2）：①若首发允许 guest 写文档：把 `context.write` 加入 `ALLOWED_CAPABILITIES` 与 `trustPolicy.capabilitiesByTier`（建议仅 `trusted`/`builtin`，`community` 不给）、实现产品桥调用 `/api/context/write`（复用 CoreSaveBridge 的 contextId/epoch，返回真实 revision/durability），并**删除伪造完成桩**；②若首发不允许：从协议契约移除/标记 `reserved` 并更新契约快照，F07 明确 de-scope。验收（①）：U（真实 revision/冲突/幂等）+ W（guest 保存 → 宿主磁盘字节与官方保存一致、CAS 冲突返回 conflict、恢复登记可查询）。

### F08 草稿/历史恢复、外部修改、重载

- **需求**：guest 侧能感知草稿/历史恢复、外部修改与重载，并在这些事件后保持/失效正确状态。
- **判定**：**未实现**。
- **guest 现状与证据**：协议无 `history.*`/`drafts.*` 方法；宿主事件 `document-saved`、`context-changed` 已在 `HostEvent` 定义（`types.ts:65-70`），但产品 guest 装配**从未发射**：`WorkshopGuestFrame.tsx` 只构造 `HostDispatcher`（:163-175）而全组件无 `dispatcher.emit(...)` 调用；`HostDispatcher.emit` 仅被 `channel.ts:229` 定义、U 测试使用（`protocol.contract.test.ts:165`）。宿主侧历史/草稿/恢复能力存在但仅官方可用：`backend/app/routers/history.py`、`drafts.py`；启动恢复 A3 W 9/9（`P5-T26-A3-recover.md`）；CSV F08 4 行 `NOT_RUN`。
- **缺口与最小实现建议**：先做**事件发射**（最小、低风险，P0-4）：宿主保存成功/失败、外部改盘检测、恢复完成时 `dispatcher.emit` 对应事件（guest SDK `onEvent` 已支持），使 guest 能失效缓存/提示；`history.list/restore` 等写语义建议 de-scope（历史恢复应由宿主 UI 承担）。验收：U（事件到达 guest）+ W（外部改盘/保存后 guest 收到事件，旧 revision 操作返回 conflict/stale）。

### F09 附件选择/拖放/粘贴上传、引用、孤儿管理

- **需求**：guest 能完成附件选择/拖放/粘贴上传、引用与孤儿管理。
- **判定**：**未实现**。
- **guest 现状与证据**：无 `attachments.*` 协议方法、无白名单命令；guest 处于 `workshop://` 独立 origin 且包文档 CSP `connect-src 'none'`（`workshop_protocol.rs:61-68`），**不能直连后端上传**；附件上传必须经宿主 Broker 中转，当前无此通道。官方附件能力在 `backend/app/routers/attachments.py` 与官方编辑面，guest 不可达。CSV F09 5 行 `NOT_RUN`。
- **缺口与最小实现建议**：需要新能力 + 协议升版（P2）：定义 `attachments.upload`（建议 base64/分片 + 单包与总量上限 + MIME/扩展名白名单，host 侧落盘到附件目录）与 `attachments.list`（只读）；拖放/粘贴的 OS 文件选择需宿主桥（Tauri dialog 只能在宿主）；孤儿管理归宿主清理任务，guest 只读引用。验收：W（guest 上传小文件 → 附件目录存在 + 引用可解析；超限/非法类型拒绝）。

### F10 搜索、高亮、tags、索引重建

- **需求**：guest 能搜索文档、获得高亮、读写 tags、触发/感知索引重建。
- **判定**：**部分**（仅 tags 写入切片）。
- **guest 现状与证据**：`command.invoke` `article.set-tags` 可真实写 tags 并落盘（W 文档记录 `P5-T26-W02-form.md` W-T26-W02-4b）；但无**搜索/读取搜索/高亮/索引重建**通道。能力 `context.read` 的说明写「读取当前工作区文档树/搜索（经受控协议）」（`installPolicy.ts:45`），但协议里**只有** `context.snapshot`，没有 tree/search 方法（G5：能力描述与实现不一致）。宿主侧其实是全的：`POST /api/context/tree`、`POST /api/context/search`（`context.py:142-157`，A 5 例 `P1-T12-domain-migration-slice.md`）、官方 `routers/search.py`、`tags.py`、`index.py`；CSV F10 5 行 `NOT_RUN`。
- **缺口与最小实现建议**：新增 `context.tree` 与 `context.search` 两个协议方法（后端已有、只需协议+Broker+产品桥白名单，最小成本），能力 `context.read`；高亮由 guest 自行渲染，索引重建归宿主（可发事件）。验收：U + W（guest 搜索返回与官方一致结果、tree 与官方文件树一致）。

### F11 回收站恢复/永久删除

- **需求**：guest 能完成回收站恢复与永久删除。
- **判定**：**未实现**。
- **guest 现状与证据**：无 `trash.*` 方法/命令；官方回收站路由与面板（`backend/app/routers/trash.py`、`frontend/src/components/trash/`）仅宿主 UI；CSV F11 3 行 `NOT_RUN`。
- **缺口与最小实现建议**：属高危写操作，建议**宿主独占 + de-scope guest 入口**并在任务包/ADR 记录；如必须开放，最小为 `command.invoke` `trash.restore`（永久删除需宿主二次确认对话框，不允许 guest 直接触发 purge）。验收：明确 de-scope 记录或 W（guest 恢复 → 文件回原路径；purge 被拒或经宿主确认）。

### F12 源码模式、原字符串、frontmatter、BOM/CRLF、HTML

- **需求**：guest 能读写源码/原字符串/frontmatter/BOM/CRLF/HTML 且字节/规范级保真。
- **判定**：**未实现**。
- **guest 现状与证据**：无内容读通道（`context.snapshot` 只回 revision/diskHash，`types.ts:121`；后端同）；无真实写通道（F07）；源码模式在官方 `components/editor/SourceModeView.tsx`，字节保真核心在官方 codec（T08 原型 `docs/ui-workshop/core/codec/` 已验 R1–R6/fixpoint 8/8，属宿主侧）。CSV F12 1 行 `NOT_RUN`。
- **缺口与最小实现建议**：依赖 P0-1（内容读）+ P0-2（真实写）；最小交付：`context.snapshot` 返回 `content`（原字符串）+ `context.write` 真实落盘，随后用 A/B 包做 BOM/CRLF/frontmatter 字节级 W 回归（可复用 T14 byte-consistency 方法 `P2-T14-byte-consistency.md`）。验收：W（guest 读→写 roundtrip 字节稳定；frontmatter 合并语义与官方一致）。

### F13 KE/普通 Markdown/ZIP 导入导出、附件映射

- **需求**：guest 能导入/导出 KE Markdown、普通 Markdown、ZIP 文档包，并正确处理附件映射。
- **判定**：**未实现**。
- **guest 现状与证据**：无任何 import/export 协议方法或命令；官方入口为导出菜单（CSV 中 `UI.export.ke/plain/zip/pdf` 6 行，`domain=F13`）与 `backend/app/routers/import_export.py`，仅宿主 UI 可用；guest 无法选择路径/写文件（沙箱）。CSV F13 6 行 `NOT_RUN`。
- **缺口与最小实现建议**：导出属「宿主代写文件」操作，最小设计：`command.invoke` `export.document`（参数：格式枚举 KE/plain/zip，目标由**宿主**弹 Tauri dialog 选择，guest 不接触路径），host 复用 import_export 路由；导入（ZIP/文件）建议后续（I 门禁未做）。验收：W（guest 请求导出 → 宿主对话框 → 文件与官方导出字节/规范一致）。

### F14 PDF 预览及真实导出

- **需求**：guest 能请求当前文档的可信快照并预览/真实导出 PDF。
- **判定**：**部分**（协议/授权/桥接位就绪；产品实现是桩，未产出真实 PDF）。
- **guest 现状与证据**：`print.snapshot` 协议方法、能力 `print.request`、Broker 映射齐备（`types.ts:135`、`broker.ts:54`、`binding.ts`），U 覆盖（本轮 contract/broker 例通过）；产品 `ProductBrokerBackend.print` 直接返回 `{pdfToken: params.relPath, pages: 1}` **桩值**（`WorkshopGuestFrame.tsx:63-65`），没有调用真实打印管线；真实管线在宿主侧已产品化：`desktop/src-tauri/src/print_snapshot.rs`（隐藏 renderer + ready 握手）、A2 W 9/9（`P5-T26-A2-print.md`）、官方 ExportPdfDialog。CSV F14 1 行 `NOT_RUN`。
- **缺口与最小实现建议**：把产品桥接到真实管线（P0-3）：guest `print.snapshot` → host 生成快照 job → `print_snapshot_pdf` 产出 PDF → 返回真实 `pdfToken`/`pages`（token 需与 job 绑定、有 TTL/清理）。验收：W（guest 请求 → 真实 PDF 文件存在、页数与官方导出一致；越权/并发 job 拒绝）。

### F15 设置、主题、补全、快捷键、维护功能

- **需求**：guest 能读取/响应设置（主题、快捷键、补全、维护）相关状态，且不破坏官方设置。
- **判定**：**未实现**。
- **guest 现状与证据**：`theme-changed` 事件已在 `HostEvent` 定义（`types.ts:66`）但产品从不发射（G4）；无 settings 方法/命令；握手响应也不带主题等宿主状态（`HandshakeResponse` 字段见 `types.ts:46-54`）。官方设置面板 `components/settings/SettingsPanel.tsx`、Rust `settings.rs` 仅宿主；CSV F15 19 行 `NOT_RUN`。
- **缺口与最小实现建议**：最小只做**只读同步**：握手响应带 `theme`（或握手后发 `theme-changed`），主题切换时 `dispatcher.emit`；设置写入保持宿主独占（guest 无权限）。验收：U（握手/事件）+ W（切换主题后 guest 收到事件）。

### F16 桌面菜单、关闭/重载、单实例等桌面行为

- **需求**：桌面菜单、关闭/重载、单实例等桌面行为在包运行时保持正确（requiredPlatforms W+I）。
- **判定**：**未实现**（作为 guest 覆盖项未验证；宿主能力本身存在）。
- **guest 现状与证据**：guest 不应也不能触达原生菜单/窗口（隔离设计正确）；`host-shutdown` 事件已在类型中定义（`types.ts:69`）但产品不发射（唯一发射点是 `HostDispatcher.cancel` 的 U 路径，`channel.ts:234-237`）。宿主侧已实现且部分有证据：`desktop/src-tauri/src/menu.rs`、单实例/退出协调 W 6/6（`P1-T13-instance-probe.md`）、隔离启动/单实例 A1 7/7（`P5-T26-isolated-smoke.md`）、启动 recover A3 9/9；但**「包 A/B 处于 active 时执行菜单重载/关窗/单实例」**场景未验证。CSV F16 11 行 `NOT_RUN`。
- **缺口与最小实现建议**：不新增 guest API；定义 F16 的 guest 验收方式为「宿主桌面行为 + 会话恢复」：A/B 包启用 → 菜单重载/关窗重启/单实例二次启动 → 断言会话状态落盘（active→stopped/recover）、无僵尸 iframe、包指针与私有状态不损坏。验收：W（复用隔离构建 + CDP，扩展 T26 探针）。

---

## 4. 横向共性缺口（G1–G7）

| ID | 缺口 | 影响 F | 证据 |
| --- | --- | --- | --- |
| **G1** | **guest 无内容读通道**：`context.snapshot` 不返回正文，后端 snapshot 也不返回 content | F06、F12、F04、F09 读取、F13 导出校验 | `types.ts:121`；`context_registry.py::snapshot`；`P5-T26-W05-protocol.md` |
| **G2** | **写通道不可达 + 桩伪造完成**：`context.write` 不在可声明能力集合（guest 永远 `E_CAPABILITY`）；产品 write 返回假 `completed/revision:1/fileDurable:true` 不落盘 | F07、F12、F02 写域 | `manifest.ts:13-20`、`trustPolicy.ts:37-41`、`broker.ts:52/92-95`、`WorkshopGuestFrame.tsx:60-62`、`P5-T26-W06-boundary.md` |
| **G3** | **打印通道为桩**：`print.snapshot` 返回 `{pdfToken: relPath, pages:1}`，未接 A2 真实管线 | F14 | `WorkshopGuestFrame.tsx:63-65`；`P5-T26-A2-print.md` |
| **G4** | **宿主事件 0 发射**：5 类 HostEvent 全部「已定义未使用」，产品 guest 装配无 `emit` 调用 | F07/F08/F15/F01/F16 | `types.ts:65-70`、`channel.ts:229`；`WorkshopGuestFrame.tsx` 全文无 `emit` |
| **G5** | **能力声明与实现不一致（假能力）**：`editor.commands.readonly`/`panel.sidebar`/`panel.dock` 无任何协议方法/UI 挂载等功能消费点（仅出现在能力表/信任策略/测试数据中）；`context.read` 描述承诺 tree/search 但无对应方法 | F03/F04/F05、F01/F02/F10 读 | `installPolicy.ts:41-46`、`manifest.ts:13-20`、`broker.ts:51-56`；`grep` 全仓仅能力表/测试数据引用 |
| **G6** | **声明式命令面过窄**：`command.invoke` 仅有 2 条硬编码命令（`article.set-title/set-tags`），无通用宿主命令目录/注册表 | F02、F10、F13、F11 等所有需要「宿主代执行」的域 | `productHostAdapter.ts:142-173`；`WorkshopGuestFrame.tsx:66-72` |
| **G7** | **包 A/B 参考 UI 与逐项台账缺失**：无两套结构不同的参考包；`packAEntry`/`packBEntry` 0/121 登记；`officialBaselineResult` 130/130 `NOT_RUN` | F01–F16 全部（这是任务包验收证据载体） | CSV 统计；`P0-report.md:48`；`HANDOVER-FINAL.md:134`；`P5-T26-W05-protocol.md:33` |

> 附带风险提示（建议下一轮记录/处理）：在开放写能力前，`ProductBrokerBackend.write` 的伪造 `fileDurable:true/revision:1` 必须删除或改为真实调用，否则一旦被 guest 依赖会产生静默数据丢失；`ProductBrokerBackend.currentEpoch()` 固定返回 `1`（`WorkshopGuestFrame.tsx:46-48`），使 Broker 的「上下文关闭/epoch 过期」检测在产品 guest 路径下恒不生效（仅靠后端 409 兜底）。

---

## 5. 剩余工作清单（按优先级，可直接排下一轮任务）

### P0（不完成则「guest 原生入口覆盖」不可能达成；每项都有明确验收）

| # | 最小任务 | 对应 F | 关键文件 | 验收 |
| --- | --- | --- | --- | --- |
| P0-1 | **内容读通道**：`context.snapshot` 返回正文（或新增 `context.content`，含 revision 一致性/大小上限） | F06/F12/F04 读取、F09 读取 | `protocol/types.ts`、`backend/app/services/context_registry.py`、`WorkshopGuestFrame.tsx` | U + W：guest 读取 `fixtures/basic.md` 与官方一致 |
| P0-2 | **写能力策略决策与落地**：先决定首发是否开放文档写；开放则加 `context.write` 能力（仅 trusted/builtin）+ 产品桥真实调用 `/api/context/write` + 删除伪造完成；不开放则从契约移除并记录 de-scope | F07/F12/F02 写域 | `manifest.ts`、`trustPolicy.ts`、`WorkshopGuestFrame.tsx`、`broker.ts`、`protocol/types.ts` | U + W：真实 revision/CAS 冲突/幂等；磁盘字节断言 |
| P0-3 | **`print.snapshot` 接真实打印管线**（A2 已产品化，桥接即可） | F14 | `WorkshopGuestFrame.tsx`、`desktop/src-tauri/src/print_snapshot.rs` | W：guest 请求产出真实 PDF，页数与官方一致 |
| P0-4 | **宿主事件发射**：`document-saved`/`context-changed`/`theme-changed` 至少 3 类接真实状态源 | F07/F08/F15/F01 | `WorkshopGuestFrame.tsx`、`core/session/coreSaveBridge.ts`、主题 store | U（GuestClient onEvent）+ W（保存/切库/切主题后 guest 收到） |
| P0-5 | **pack A/B 参考 UI + 逐项台账**：建两套结构不同的参考包，按 121 条 F 行填 `packAEntry`/`packBEntry`/`officialBaselineResult`，抽样 W | F01–F16 | 新参考包目录、`feature-baseline.csv`、探针脚本 | CSV 无空列 + 抽样任务 W 通过（这是任务包验收的直接证据载体，缺它无法宣称覆盖） |

### P1（下一里程碑前应完成或显式 de-scope）

| # | 最小任务 | 对应 F | 验收 |
| --- | --- | --- | --- |
| P1-1 | 新增 `context.tree` / `context.search` 协议方法（后端 `/api/context/tree|search` 已 A 5 例） | F01/F02 读/F10 | U + A + W：与官方文件树/搜索结果一致 |
| P1-2 | 命令目录扩展：`article.create/rename/move/delete`（接 `formHandoff` + 宿主确认），F13 导出命令（宿主选路径） | F02/F13 | U + W |
| P1-3 | **能力表与实现对齐**：`editor.commands.readonly`/`panel.sidebar`/`panel.dock` 要么实现消费点（只读编辑命令/面板挂载），要么从首发能力表移除并更新 trustPolicy/ARCHITECTURE | F03/F04/F05 | 能力矩阵表 + 越权 U 测试 |
| P1-4 | F16 guest 行为验收办法（不新增 API）：A/B 包 active 时菜单重载/关窗/单实例 → 会话恢复断言，并入 T26 | F16 | W（隔离构建 + CDP） |
| P1-5 | 交付文档口径校准：把「F01–F16 部分」替换为本报告量化（0 已实现/3 部分/13 未实现；0/121 行登记），避免下一轮误读（仅建议，本报告不改其他文档） | — | 文档更新提交 |

### P2（可排后，但需显式记录 de-scope 理由）

| # | 最小任务 | 对应 F | 验收/说明 |
| --- | --- | --- | --- |
| P2-1 | 附件通道 `attachments.upload/list`（base64/分片 + 限额 + 新能力，协议升版） | F09 | W；需评审协议版本成本 |
| P2-2 | 历史/恢复只读接口（或正式 de-scope，历史恢复归宿主 UI） | F08 | 建议 de-scope + 事件已由 P0-4 覆盖 |
| P2-3 | 回收站命令（恢复可考虑；永久删除必须宿主确认）或 de-scope | F11 | 高危，默认建议宿主独占 |
| P2-4 | 工作区上下文只读接口（`context.current`）与切换事件（可并入 P0-4） | F01 | 不开放 open/switch/close |
| P2-5 | 协议 subscribe/断连重放/慢包（W05 剩余）作为事件化基础 | F 域事件（F07/F08/F15） | U + W |
| P2-6 | 主题等宿主状态进入握手（`HandshakeResponse.theme`） | F15 | 可与 P0-4 合并 |

---

## 6. 对交付文档的校准建议（本报告不修改这些文件）

现有表述「F01–F16 全功能基线逐项 guest 覆盖 = **部分**」容易被读成「大部分已覆盖」。基于本次审计，建议下一轮更新为可核查口径：

- `HANDOVER-FINAL.md:134`、`reports/milestone-assessment.md:65`、`reports/FINAL-DELIVERY-STATUS.md:53`、`reports/T26-acceptance-status.md:73`：将「部分」细化为「**guest 原生入口覆盖未达成：已实现 0/16、部分 3/16、未实现 13/16；`packAEntry`/`packBEntry` 0/121 行登记；官方基线逐项 130/130 `NOT_RUN`（仅整套回归套件绿）**」，并引用本报告。
- `reports/P0-report.md:48`「包 A/B 原生入口列留 T24 填写」：T24 实际工作为签名/信任链，该列至今未填；建议在台账中标明「**未完成、无 owner**」，避免被当作已闭环。
- `evidence/P5-T26-W05-protocol.md:33` 已诚实记录「F01–F16 未做」，无需改动；建议把本报告作为其跟踪链接。

---

## 7. 审计限制与复现

- **本轮实际执行的验证**：`cd frontend && npx vitest run src/core/protocol/protocol.contract.test.ts src/core/broker/broker.test.ts src/core/broker/binding.test.ts src/core/packs/guestHost.test.ts src/core/packs/productHostAdapter.test.ts src/components/workshop/WorkshopGuestFrame.test.tsx --maxWorkers=2` → **6 files / 45 tests passed**（2026-10-19，WSL，git 工作树无改动）。
- **未执行的验证（不得写成通过）**：Windows W 证据（A7/A5、W05、W02、W04、W06、W07、A2 等）**未复跑**，仅核对文档内部一致性与引用链；Rust 未编译；后端 pytest 未复跑；官方 UI 功能未实测（不在本审计范围）。
- **静态审计边界**：结论基于 HEAD `3117c7d` 源码与文档；任何代码变更后需重跑本审计。行号引用基于该 HEAD。
- **口径边界**：F01–F16 的逐项通过标准原文不可得（任务包 `ACCEPTANCE.md §C` 不在仓库），「代表性用户任务」由 §1.1 的替代来源推断；如任务包原文另有定义，以原文为准并修订本报告。

---

## 附录 A：guest 可达面详表（HEAD `3117c7d`）

| 通道 | 能力 | 产品实现真实度 | 覆盖的 F 域 | 证据 |
| --- | --- | --- | --- | --- |
| `protocol.capabilities` | 无需能力 | 真实（握手元信息） | —（基础） | `types.ts:120`、`channel.ts` handshake、`P5-T26-W04-sdk-dist.md` |
| `context.snapshot` | `context.read` | 真实（后端 `/api/context/snapshot` HTTP） | F07/F08 的 revision 感知（非用户任务）；不含正文 | `WorkshopGuestFrame.tsx:49-58`、`P5-T26-W05-protocol.md` W-4 |
| `context.write` | `context.write`（**不可声明**） | **桩**：伪造 `completed/revision:1/fileDurable:true` | 无（不可达） | `WorkshopGuestFrame.tsx:60-62`、`manifest.ts:13-20`、`P5-T26-W06-boundary.md` W-6 |
| `print.snapshot` | `print.request` | **桩**：返回 relPath/1 页 | F14（仅协议层） | `WorkshopGuestFrame.tsx:63-65` |
| `command.invoke` | `ui.shell` | 真实但仅 2 条命令：`article.set-title`/`article.set-tags` | F02 元数据切片、F10 tags 切片 | `productHostAdapter.ts:142-173`、`P5-T26-W02-form.md` |
| 宿主事件 5 类 | 连接能力 | **0 发射** | F01/F07/F08/F15/F16（设计就绪未接线） | `types.ts:65-70`、`channel.ts:229` |
| 包生命周期（`workshop_pack_*`） | 宿主命令，guest 不可调用 | 真实（Rust） | —（工坊控制面，非 F 域） | `pack_store.rs:688-800`、`lib.rs:199-234` |
| 隔离/沙箱 | `sandbox="allow-scripts"` + workshop origin + CSP `connect-src 'none'` | 真实（W 有证据，含残余风险） | 所有域的前置边界 | `WorkshopGuestFrame.tsx:244-246`、`workshop_protocol.rs:61-68`、`P5-T26-A7-isolation.md` |

## 附录 B：`feature-baseline.csv` 逐域行数与登记统计（2026-10-19 核对）

| 域 | 行数 | `packAEntry` 非空 | `packBEntry` 非空 | `officialBaselineResult` |
| --- | ---: | ---: | ---: | --- |
| F01 | 10 | 0 | 0 | NOT_RUN ×10 |
| F02 | 6 | 0 | 0 | NOT_RUN ×6 |
| F03 | 42 | 0 | 0 | NOT_RUN ×42 |
| F04 | 1 | 0 | 0 | NOT_RUN ×1 |
| F05 | 1 | 0 | 0 | NOT_RUN ×1 |
| F06 | 3 | 0 | 0 | NOT_RUN ×3 |
| F07 | 3 | 0 | 0 | NOT_RUN ×3 |
| F08 | 4 | 0 | 0 | NOT_RUN ×4 |
| F09 | 5 | 0 | 0 | NOT_RUN ×5 |
| F10 | 5 | 0 | 0 | NOT_RUN ×5 |
| F11 | 3 | 0 | 0 | NOT_RUN ×3 |
| F12 | 1 | 0 | 0 | NOT_RUN ×1 |
| F13 | 6 | 0 | 0 | NOT_RUN ×6 |
| F14 | 1 | 0 | 0 | NOT_RUN ×1 |
| F15 | 19 | 0 | 0 | NOT_RUN ×19 |
| F16 | 11 | 0 | 0 | NOT_RUN ×11 |
| P3/P4 | 9 | 0 | 0 | NOT_RUN ×9 |
| **合计** | **130** | **0** | **0** | **NOT_RUN ×130** |

> 统计方法：`python3` 读取 CSV 逐列计数（`packAEntry`/`packBEntry` 去空白后非空计数；`officialBaselineResult` 唯一值）。F 域合计 121 行，与 `build_feature_baseline.py` 的 `domains` 定义 + 源码扫描行一致。


---

## 附：审计后状态更新（2026-10-19，Lead 追加，未改动上文审计结论）

- **G1/G2 已闭环**（commit `1ea4c62`，产品 W 14/14）：`context.snapshot` additive `content?/contentBytes?`
  （`context.read` 才返回）；`context.write` 进 manifest/trusted/builtin + Rust `ALLOWED_CAPS`，
  产品桥接真实 `/api/context/write`（completed/conflict/stale/failed，假桩删除）。
- 因此 G1「无内容读通道」、G2「写通道不可达+假桩」两项 P0 结构缺口**已消除**；
  但 F01–F16 **逐项登记仍为 0/121**，0 已实现/3 部分/13 未实现的统计**不因此改变**。
- 其余 P0 缺口 G3（print.snapshot 桩）、G4（事件 0 发射）、G7（参考 UI/台账）仍未处理。
