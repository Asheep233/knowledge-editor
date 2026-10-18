# UI 工坊阶段交付报告：P1（Core 与协议）

- **阶段/完成状态：P1 / `P1_READY_PENDING`** —— 核心闭环（T08/T09/T10/T11/T12 切片 + T13 Core 门禁）
  已通过真实后端/Windows 验证；T13 仍有 3 项门禁未覆盖（见下），故**不宣称 P1 完成**。
- **代码基线**：分支 `feat/ui-workshop`（v1.2.18 `4c71233` + overlay `e54d37b`），HEAD 见提交流水
- **平台**：Windows 11 + WebView2 155（W 证据）；WSL2 Linux（A/U 证据）；测试数据全部临时目录，
  **零用户笔记**；未推送、未发布 Release
- **测试基线（本报告时点）**：backend **846 collected，WSL+Windows 全绿**；frontend **116 files /
  1690 passed + 1 skipped（exit 0），tsc 0**；Core 新增单测 **74**（session 23 / protocol 19 / broker 18 / packs 14）

## 任务状态（T08–T13）

| 任务 | 状态 | 交付物 | 证据 | 剩余 |
| --- | --- | --- | --- | --- |
| T08 文档 codec 边界 | **passed** | Core codec 探针/分层；canonical 规则 R1–R6；保存管线 roundtrip 台账 | `evidence/T08-codec-probe{,2}.md`、`T08-roundtrip-ledger.md`、`core/codec/CANONICAL-RULES.md` | — |
| T09 WorkspaceContext/写入一致性 | in_progress | 产品后端 `/api/context/*`（上下文/租约/快照/CAS/幂等/结果查询）+ 测试 + 契约更新 | `evidence/P1-T09-workspace-context.md`（原型双平台 10/10）、`P1-T09-product-slice.md` | 注册表内存态；真实 store/indexer/history/watcher 未绑定；慢 I/O in-flight 状态机 |
| T10 Core/SaveCoordinator | in_progress | `frontend/src/core/session/`（SaveCoordinator/HttpTransport/RecoveryJournal）+ 单测 + 真实后端 e2e 19/19 | `evidence/P1-T10-core-savecoordinator.md`、`P1-T10-e2e.md` | 产品 RecoveryStorage（Tauri 文件）；真实 UI 加载/切换接线；索引/history 绑定 |
| T11 类型化协议 | in_progress | `frontend/src/core/protocol/`（契约/版本/能力/错误/取消/背压/wire transport）+ 契约测试 + Windows 传输探针 7/7 | `evidence/P1-T11-protocol.md`、`P1-T11-transport-probe.md` | 生产 iframe DOM 适配器（归 T17）；事件背压；P3 包命令入方法表 |
| T12 分域迁移 | in_progress | 只读域 `/api/context/tree\|search`；写域 `/api/context/article/save` | `evidence/P1-T12-domain-migration-slice.md`、`P1-T12-write-domain-slice.md` | 重命名/删除/附件/导入导出/print job；真实 store/indexer 迁移；前端切换调用 |
| T13 Core 门槛 | in_progress | **UI-free 端到端门禁 21/21**（打开→快照→保存→abort 恢复→切库→租约关闭）；**单实例/退出协调 W 6/6** | `evidence/P1-T13-core-gate.md`、`P1-T13-instance-probe.md` | 打印 job 与取消（T16）；Rust 原生恢复（T20）；产品工作区打开流程合并验证 |

## 本轮修复的缺陷（质量记录）

- **Core**：SaveCoordinator 恢复日志「abort 后重试成功 → 旧恢复记录残留」→ 保存成功时提交当前记录并清理
  同文档旧记录（新增单测；session 测试 23 例）。
- **原型壳**：`.build()` 后漏接 `.run()` 事件循环导致启动即退出 → 补 RunEvent 循环（同时接入
  ExitRequested/Exit 退出协调）；记录为启动路径 GAP，产品壳必须显式 run event loop。
- **协议**：背压错误码 `E_BUSY` 显式入契约（PROTOCOL_CONTRACT + 测试同步）。
- **e2e/runner 工程**：uvicorn 子 shell PID 导致进程残留、随机端口、失败时打印 stderr 等已固化。

## Windows/WebView2 W 证据索引（P0/P1 至本报告）

| 证据 | 结果 |
| --- | --- |
| S1 iframe 运行域/ACL/Rust 恢复 | 23/25（2 项为发现约束） |
| S1b child WebviewWindow 对照 | 10/10 |
| S2 持续编辑面换壳 | 10/10 |
| S4 独立打印真实 PDF | 6/6 |
| T11 协议传输探针 | 7/7（MessagePort 无法 transfer 进 opaque iframe 的关键发现） |
| T18 恶意/故障 guest Broker 探针 | 12/12 |
| T21 原生包存储（Windows 文件系统） | 20/20 |
| T13 单实例/退出协调 | 6/6 |

（S3/S5 为 Linux+Windows 双平台 pytest 10/10；T13 Core 门禁为 A 证据。）

## 风险与下一次门禁

| 风险 | 影响 | 缓解/下一步 |
| --- | --- | --- |
| T09 上下文注册表仍为进程内内存态，真实业务端点仍用全局 workspace_root | 多工作区并发与重启语义未定 | T12 逐域迁移 + 持久化幂等表 |
| T10/T11 尚未与真实产品 UI/包加载器接线 | “Core 可被官方 shell 与 guest 复用”未端到端证明 | T14 官方 shell 接线 + T17 包加载器（iframe 适配器） |
| 打印 job/取消、长文档/隐藏窗口未产品化 | T13 门禁剩余；T16 未完成 | T16 产品化 + W 验收 |
| Rust 原生恢复未接入产品壳 | T13/T20 未完成 | T20 bootPending/recover/safe mode 产品化 |
| 真实中文 IME/多 DPI 未验 | T15/T26 Windows 认证缺项 | T15/T26 实机矩阵（用户手工/自动化补测） |

## 下一阶段（P2/P3）解锁与优先级

1. **T14/T15**：EditorSession 产品接线（官方 shell、持续编辑面、源码通道、真实 IME/DPI W 验收）
2. **T16**：打印产品化（指定 revision 快照、隐藏窗口、长文档分页、取消/job 清理）
3. **T17/T18**：包加载器产品化（iframe DOM 适配器 + 包激活会话）与三档授权 UI（T22）
4. **T20/T21**：Rust 原生恢复 + 产品壳启动 recover；Windows 安装/升级/回滚验收
5. T12 剩余域、T13 剩余门禁项随上述任务收尾，之后给 P2/P3 阶段报告与完成度口径
