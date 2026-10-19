# 任务包逐任务状态（交接口径，2026-10-19 夜）

> 口径：**passed / in_progress（已实现但任务包定义未全部满足）/ blocked / 未发布候选**。
> 本表按任务包 `TASKS.md` T00–T28 汇总，证据指针见 `validation-matrix.csv` 与 `evidence/`。
> 结论：**T01/T07/T08 正式 passed；T27 blocked（无 Windows VM）；T26 认证未达成；其余为 in_progress
> （产品切片/部分 W 验证）；最终交付状态 `EXPERIMENTAL_TRUSTED_PACKS`。** 不把部分实现写成 passed。

## P0（T00–T07）

| 任务 | 状态 | 已实现 / 证据 | 未闭环 |
| --- | --- | --- | --- |
| T00 基线/测量底座 | in_progress | 分支/overlay、环境探测、fixtures、bench 脚本、T00-baseline/measurements | 两 shell 预热/内存/切换与 Windows 启动/PDF 全量测量未逐项采齐（后续 P0–P5 有替代 W） |
| T01 功能矩阵 | **passed** | `feature-baseline.csv` 130 行（F01–F16+W，hostService/hostCommand/officialPanel/workshopTaskId）、fixtures、known-failures | — |
| T02 S1 运行域/ACL/恢复原型 | in_progress | iframe/MessagePort/child WebviewWindow 原型；Windows 10/10；产品侧 A7 隔离 W 6/6、broker W 12/12 | capability 文件级 scoping/自定义协议来源的产品化收尾 |
| T03 S2 持续编辑面原型 | in_progress | 双 shell 原型 Windows 10/10；产品 T14 EditorSession 保存 W 9/9 | 真实产品 NodeView/MathLive/人工 IME 未在产品原型口径内覆盖 |
| T04 S3 保存切片原型 | in_progress | S3 双平台 10/10；产品 T09/T10 context+SaveCoordinator（e2e 19/19） | 原型→产品全链的任务包级验收未单独裁定 |
| T05 S4 独立打印原型 | in_progress | 原型 Windows 真实 PDF 6/6；产品 T16 打印管线（隐藏 renderer+ready 握手） | 长文档/分页/主题/源码打印矩阵未全 |
| T06 S5 包事务原型 | in_progress | S5 双平台 10/10；产品 T17/T19 安装事务/回滚 | 各提交点杀进程的完整产品级注入矩阵未全 |
| T07 路线 ADR | **passed** | `ADR-001` 定独立 origin iframe + MessagePort；P0_REPORT=P0_READY | — |

## P1（T08–T13）

| 任务 | 状态 | 已实现 / 证据 | 未闭环 |
| --- | --- | --- | --- |
| T08 codec | **passed** | 无 DOM probe、canonical 规则、roundtrip 8/8 字节稳定 | — |
| T09 WorkspaceContext | in_progress | 原型 10/10；产品 `context_registry`/`routers/context`（epoch/CAS/幂等）+ 单测；全量后端 847 | 全业务端点/附件/导入/恢复/打印绑定与慢 I/O in-flight 未全迁移 |
| T10 Core/SaveCoordinator | in_progress | Core 无 DOM 21 例 + 真实后端 e2e 19/19；EditorArea flag 接线、A8 W 9/9 | 产品 RecoveryStorage（Tauri/IndexedDB）未实现；切档/外部改盘专项未全 |
| T11 类型化协议 | in_progress | 契约/传输/背压 18 例 + W 7/7；5 方法/5 事件/错误码；contract 快照 | 事件背压/重放未做；新增命令方法已按 additive 扩展 |
| T12 分域迁移 | in_progress | 只读域 5 例 + 写域 6 例；契约 51 路径/63 方法；后端全绿 | 重命名/删除/附件/导入导出/print job 未绑定；前端未全面切换 |
| T13 Core 门槛 | in_progress | UI-free 门禁 21/21 + 单实例/退出协调 W 6/6 | 打印 job/Rust 原生恢复合并验证未纳入门槛 |

## P2（T14–T16）

| 任务 | 状态 | 已实现 / 证据 | 未闭环 |
| --- | --- | --- | --- |
| T14 EditorSession+保存 | in_progress | Core 保存桥/切档 e2e、字节一致 12/12、A8 产品保存 W 9/9（frontmatter 保留） | 切档/外部改盘/恢复点专项、Windows 实机字节回归未全 |
| T15 输入/焦点/布局 | in_progress | CDP/WebView2 IME+DPI **W 7/7**（渲染层） | **人工真实系统 IME / 多 DPI 未测** |
| T16 可信打印面 | in_progress | 打印核心 12 例 + S4 W 6/6 + 产品管线 ready 握手 | 隔离安装端到端打印、长文档分页/主题/源码、取消清理未全 |

## P3（T17–T21）

| 任务 | 状态 | 已实现 / 证据 | 未闭环 |
| --- | --- | --- | --- |
| T17 包格式/安装/资源 | in_progress | manifest/资产 hash/原子注册表/ZIP 离线 W 8/8；预编译加载 | 升级 UI 与首次安装确认流程任务级裁定 |
| T18 Broker/隔离 | in_progress | Broker 37 例 + W 12/12；A7 隔离 W 6/6；旧连接/伪造请求/越权拒绝 | 写口来源收紧端到端、精确 ACL 矩阵未全 |
| T19 预览/启用事务+私有状态 | in_progress | guest 宿主 A7/A5 W 11/11；停用持久化；事务状态机 | renderer crash 注入/预览取消保留等专项未全 |
| T20 安全模式/启动恢复 | in_progress | Rust 恢复 cargo 33/33、W 9/9；boot 复测 43/45 | safeMode 未阻断危险操作；卸载清理/单实例合并未全 |
| T21 P3 运行时门槛 | in_progress | pack_store 全命令 + A4/A6 W 16/16（签名/安装/回滚/卸载） | 双 bundle 完整 S1–S5 故障注入报告未按门槛裁定 |

## P4（T22–T25）

| 任务 | 状态 | 已实现 / 证据 | 未闭环 |
| --- | --- | --- | --- |
| T22 SDK/工具 | in_progress | SDK dist（iife+ESM）自检 4/4；create/sign 工具 5/5；脚手架/兼容检查；W04 W 7/7 | 正式 npm 发布策略/迁移差异工具未全 |
| T23 工坊控制面 | in_progress | WorkshopEntry/Panel（安装/列表/信任徽章/授予撤销/回滚/卸载/恢复）；trust UI | 首次安装确认/升级 UI 任务级验收 |
| T24 官方包+第二参考 UI | in_progress | pack A（侧栏读/打印/事件）/ pack B（Dock+表单+命令）；W 24/24 | 第二 UI 未使用不同前端框架（任务包要求） |
| T25 外部 Agent E2E | in_progress | 外部签名包安装启用 W 7/7；SDK dist W 7/7；另交付接口文档/Runbook | 未走「只在干净目录交 SDK 模板」的完整外部 Agent 流程裁定 |

## P5（T26–T28）

| 任务 | 状态 | 已实现 / 证据 | 未闭环 |
| --- | --- | --- | --- |
| T26 全功能/故障/平台回归与认证 | in_progress（**认证未达成**） | A1–A8 W；W01/W02/W04/W05/W06/W07/W09 W；G1–G7；F 台账（F03 42/42、packA 26/packB 27 PASS）；矩阵 63 行 PASS | 红线上仍缺：T27 I 门禁、人工 IME/DPI、F 全量 guest 覆盖；W07 3 项已定稿限制 |
| T27 更新兼容+真实安装/升级 | **blocked（NOT_RUN）** | 就绪检查 NOT_READY 6/8；Linux 预检 PASS（脚本回归 39/39、SHA256 64/64）；交接包 v2 + `cloud_t27_gate.py` 自动化 | **无 Windows VM/环境**，U1–U6 未执行；用户已确认无法提供 → 决策 `DECISION-T27-I-gate-blocked.md` |
| T28 首发候选与最终交接 | in_progress（**候选，未发布**） | 交付文档/证据索引/矩阵/一致性/Runbook/接口文档/接口维护策略；分支已授权推送 | 未发布 Release；认证门禁未闭环 → 仅候选 |

## 交接结论

- **可直接交接的**：接口文档 + SDK/参考包 + 证据/矩阵 + 云端验收包 + 前端接入 Runbook + 推送分支。
- **明确不可宣称的**：T26 认证、正式发布、I 门禁通过、人工 IME/多 DPI 通过、F 全量 guest 覆盖。
- **恢复条件**：仅当获得 Windows 环境（跑 T27 U1–U6）且人工 IME/多 DPI 完成、经主理人授权后，才可复评
  里程碑是否前移；当前状态保持 **`EXPERIMENTAL_TRUSTED_PACKS`**。
