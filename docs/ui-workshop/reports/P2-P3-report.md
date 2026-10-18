# UI 工坊阶段交付报告：P2 / P3（编辑面 · 打印 · 包运行时）

- **阶段/完成状态：P2 `in_progress`；P3 `EXPERIMENTAL_CORE_ONLY`（实验性核心，未达 IMPLEMENTED_WINDOWS_PENDING）**
- **项目级完成度口径（任务包 ADR/ACCEPTANCE F）：仍为 `P0_READY`**
  - 理由：工坊能力尚未在产品 UX 中完整落地（旧 App 仍是唯一可达界面；Core/协议/包运行时/打印为
    可测试核心 + 原型 W 证据，未完成 P4/P5 的产品集成与 Windows 认证）。
- **代码基线**：`feat/ui-workshop`（v1.2.18 `4c71233` + overlay `e54d37b`）；未推送、未发 Release
- **平台**：Windows 11 + WebView2 155（W）；WSL2 Linux（A/U）；测试数据全部临时目录，零用户笔记
- **测试基线（本报告时点）**：
  - 前端 **122 files / 1733 passed + 1 skipped（exit 0）**，tsc 0
  - 后端 **846 collected（WSL 3.14 + Windows 3.10 全绿）**
  - 产品 Rust **cargo test 33 passed**、release 构建成功
  - Core 新增单测：session 29+ / protocol 19 / broker 18 / packs 29 / print 12

## 任务状态（P2）

| 任务 | 状态 | 交付物 | 证据 | 剩余 |
| --- | --- | --- | --- | --- |
| T14 官方 EditorSession/宿主编辑面/shell | in_progress | Core 适配层（`productAdapter`：产品 `SaveFn`↔Core 三阶段/abort/冲突）、`SaveCoordinator.subscribe`；无 React 测试覆盖 | `evidence/P2-T14-product-adapter.md`（session 29 例） | **真实 EditorArea/SaveQueue 接线**（双写开关/恢复点/源码直存兼容/外部改盘对话框）；真实产品 W 回归 |
| T15 持续编辑面 + IME/焦点/缩放 | in_progress | S2 换壳原型（10/10）；**WebView2 CDP 实机探针 8/8**（IME 组词/焦点/撤销/setZoom dpr 2→2.5） | `evidence/P0-S2-prototype.md`、`P2-T15-ime-zoom-probe.md` | 真实 OS 中文 IME、多 DPI 拖拽、失焦/遮挡；T14 接线后回归 |
| T16 打印产品化 | in_progress | S4 真实 PDF 原型（6/6）；Core 打印 Job（快照绑定/队列/取消/超时/路径校验，12 例） | `evidence/P0-S4-prototype.md`、`P2-T16-print-core.md` | 产品隐藏 renderer + Rust PrintToPdf 接线；长文档分页/主题/源码打印；取消清理；打印 UI + W |

## 任务状态（P3）

| 任务 | 状态 | 交付物 | 证据 | 剩余 |
| --- | --- | --- | --- | --- |
| T17 包加载器 | in_progress | Core manifest 校验 + PackStore（14 例）；产品 Rust 包存储 | `P3-T17-pack-loader.md`、`P3-T21-product-pack-store.md` | 安装候选扫描 UI/来源信任；TS 与 Rust 单一事实来源收口 |
| T18 broker/能力隔离 | in_progress | Core Broker + Dispatcher 接线（18 例）；**Windows 恶意/故障 guest 探针 12/12** | `P3-T18-broker.md`、`P3-T18-broker-probe.md` | 真实产品 guest 会话建立；三档授权策略持久化；后端写口来源端到端 |
| T19 包隔离宿主/崩溃处理 | not_started | — | — | 依赖 T18 产品会话 + T20 |
| T20 原生恢复/单实例/退出协调 | in_progress | 原型单实例+退出协调 W 6/6；**产品壳启动 recover_all + safe mode 状态 + 事件** | `P1-T13-instance-probe.md`、`P3-T20-startup-recover.md` | safeMode 前端呈现/阻断；Windows 故障启动 W；卸载；状态与单实例合并 |
| T21 Windows 安装/升级/回滚 | in_progress | 原型 Rust 存储 W **20/20**；产品壳 Rust 命令（cargo 33/33 + release 构建）；前端 Tauri 适配器 + dialog 目录选择 | `P3-T21-pack-install-probe.md`、`P3-T21-product-pack-store.md`、`P3-T23-workshop-integration.md` | **Windows 端到端交互 W**（安装→启用→回滚→卸载，含损坏/safe mode）；安装包升级回归 |
| T22 首次安装确认 | in_progress | Core 预览/能力风险/签名阻止/显式确认门禁（9 例） | `P3-T22-install-confirmation.md` | 真实下载/签名验证；来源信任持久化；Windows 交互 |
| T23 工坊控制面 | in_progress | WorkshopPanel（7 例）+ 入口（3 例）+ App flag 集成；全量前端回归绿 | `P3-T23-workshop-panel.md`、`P3-T23-workshop-integration.md` | 真实安装/进度/取消/卸载交互；safeMode 横幅；视觉验收 |

## Windows/WebView2 W 证据索引（累计）

| 证据 | 结果 |
| --- | --- |
| S1 iframe 运行域/ACL/Rust 恢复 | 23/25（2 发现约束） |
| S1b child WebviewWindow 对照 | 10/10 |
| S2 持续编辑面换壳 | 10/10 |
| S4 独立打印真实 PDF | 6/6 |
| T11 协议传输（MessagePort 关键发现） | 7/7 |
| T13 单实例/退出协调 | 6/6 |
| T15 IME/焦点/缩放（CDP） | 8/8 |
| T18 恶意/故障 guest Broker | 12/12 |
| T21 原生包存储（Windows 文件系统） | 20/20 |
| T19 包隔离宿主（会话/崩溃/safeMode） | 8/8 |

## 完成度判定（对任务包口径）

| 候选状态 | 判定 | 依据 |
| --- | --- | --- |
| `P0_READY` | **成立（当前）** | 五原型 + 路由 ADR + Windows 证据；P0 报告已交付 |
| `IMPLEMENTED_WINDOWS_PENDING` | **不成立** | 工坊能力未在产品 UX 完整落地（T14 接线、T16/T19 产品化、T23 真实交互未完成） |
| `EXPERIMENTAL_TRUSTED_PACKS` | **不成立** | guest 包运行会话/能力持久化/真实安装交互未完成（仅核心+探针） |
| `LOCAL_WORKSHOP_RELEASE_CANDIDATE` | **不成立** | 无 P4/P5 集成、无安装包升级/回滚演练、无 Windows 认证 |

## 通往下一里程碑的最短路径（建议优先级）

1. **T14 接线**（最高价值）：EditorArea 保存回调 → Core SaveFn（flag + 回退），跑通真实产品保存/切档/外部改盘；
   完成后 P2 方可判 `IMPLEMENTED_WINDOWS_PENDING` 候选。
2. **T16 产品接线**：隐藏 renderer + Rust PrintToPdf + 取消清理；打印 UI。
3. **T21/T23 真实交互闭环**：安装→启用→回滚→卸载（含 safeMode 横幅/修复入口）→ Windows E2E W。
4. **T19/T24/T25**：包隔离宿主、可信包限定、平台验证矩阵；之后才可能 `EXPERIMENTAL_TRUSTED_PACKS`。
5. **T26–T29**：Windows 认证、发布候选、交接报告（需主理人授权才可 Release）。

## 风险与限制

- 真实 OS 中文 IME/多 DPI/失焦遮挡、Windows 安装包升级/回滚演练尚未执行（T15/T21/T26）。
- 产品旧 App 未改动默认行为：所有工坊入口默认关闭（`VITE_KE_WORKSHOP` 未开），不隐藏旧 App/不冒充 Core。
- 大量证据为原型/核心级（A/U/B），标注明确，未冒充 Windows 认证通过。
