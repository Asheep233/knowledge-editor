# UI 工坊里程碑评估（按 ACCEPTANCE.md A 节口径）

- 日期：2026-10-19 · 代码基线：分支 `feat/ui-workshop`（本地，未推送/未 Release）
- 结论：**`EXPERIMENTAL_TRUSTED_PACKS`**（受信实验包可用；隔离/离线/恢复仍有未通过项与残余风险）
- 明确**不**声明：`IMPLEMENTED_WINDOWS_PENDING` 已完成态、`LOCAL_WORKSHOP_RELEASE_CANDIDATE`

## 1. 判定依据

ACCEPTANCE A 节：
- `EXPERIMENTAL_TRUSTED_PACKS`：**只允许受信实验包；隔离、离线限制或恢复仍有未通过项**。

本实现现状与之一致：
- **只允许受信包**：T24 信任等级强制（community 能力不允许 → `E_CAPABILITY_TIER` 拒绝启动 guest，
  产品 W 已验证）；安装验签（篡改/撤销 → 拒绝安装）；签名/信任 UI 与 TrustStore 可用；
- **隔离**：guest 独立 origin（`http://workshop.localhost`）已成立；但 guest 仍可见
  `__TAURI_INTERNALS__`（invoke 实测 timeout、当前不可利用）→ **残余风险未通过**；
- **离线**：包为本地离线目录安装/加载；zip 离线包/多包格式未完成（W01 部分 NOT_RUN）；
- **恢复**：启动 recover/safeMode 产品级 W 9/9；但 W03（包与私有状态回滚）I 门禁、W07 原生故障
  恢复 I 门禁未执行；
- **Windows 实机**：A1–A8 均已真实产品壳 W 通过（smoke/A2 打印/A3 recover/A4+A6/A5 UI/A7+A5 guest/
  A8 保存/IME-DPI/A7 隔离）。

## 2. 已通过（证据索引）

| 类别 | 状态 | 证据 |
| --- | --- | --- |
| P0 原型五切片 | ✅ W/U/A | `P0-S1/S2/S4`、S3/S5 pytest、ADR-001 |
| 协议/传输/包隔离 | ✅ 原型 W + Core U | `P1-T10/T11/T18`、`P3-T19-*` |
| 产品 Core 保存 flag | ✅ 产品 W 9/9 + 字节一致 e2e 12/12 | `P5-T26-A8-save`、`P2-T14-byte-consistency` |
| 签名/信任/安装生命周期 | ✅ 产品 W（A4+A6 16/16、A5 11/11） | `P5-T26-A4-A6-install`、`P5-T26-A5-ui` |
| 产品 guest 宿主（A7/A5） | ✅ 产品 W 11/11 + 隔离核对 6/6（残余风险已记录） | `P5-T26-A7-A5-guest`、`P5-T26-A7-isolation` |
| 打印（隐藏 renderer） | ✅ 产品 W 9/9 | `P5-T26-A2-print` |
| 启动 recover/safeMode | ✅ 产品 W 9/9 | `P5-T26-A3-recover` |
| IME/DPI（自动化路径） | ✅ 产品 W 7/7（人工真实 IME 未做） | `P5-T26-ime-dpi` |
| 回归基线 | ✅ 前端 134 files/1819 passed+1 skipped（tsc 0）/后端 847/cargo 50/W 13/13 | `P6-final-verification`、`validation-matrix.csv` |

## 2b. T26 真实产品壳 W 场景证据（汇总；逐项见 `reports/T26-acceptance-status.md`、`validation-matrix.csv`）

| 场景组 | 结果 | 证据 |
| --- | --- | --- |
| A1–A8 产品验收场景 | A1 7/7、A2 9/9、A3 9/9、A4+A6 16/16、A5 11/11、A7+A5 11/11、A7 隔离 6/6、A8 9/9 | `P5-T26-isolated-smoke`、`-A2-print`、`-A3-recover`、`-A4-A6-install`、`-A5-ui`、`-A7-A5-guest`、`-A7-isolation`、`-A8-save` |
| IME/DPI（CDP/WebView2 渲染层） | W 7/7（非人工系统 IME） | `P5-T26-ime-dpi` |
| W01/W05/W06 功能级（部分类别） | W01 8/8、W05 7/7、W06 8/8 | `P5-T26-W01-zip`、`-W05-protocol`、`-W06-boundary` |
| W02 表单交接（切片） | Core U 6/6 + 产品 title/tags W 8/8 | `P5-T26-W02-formhandoff`、`-W02-form` |
| W04 外部开发者路径 + SDK 发布形态 | 外部路径 W 7/7 + SDK 发布形态 W 7/7（另脚手架自检 5/5、SDK 自检 4/4） | `P5-T26-W04-sdk`、`-W04-sdk-dist` |
| W07 故障类别（部分） | 无限循环 W 8/8 + 内存压力 W 11/11 + CPU 压力 W 10/10 | `P5-T26-W07-fault`、`P5-T26-W07-fault-mem` |
| W09 性能（工坊口径） | W 6/6；大文档首开为产品既有解析限制（非工坊回归） | `P5-T26-W09-workshop`、`-W09-perf*` |
| 原型壳 W 探针门禁 | 13/13 PASS | `P5-T26-windows-witnesses` |
| T27/W08 I 门禁就绪检查 | **NOT_READY 6/8（非验收通过）**：产物齐备，阻塞=未授权 + 隔离环境未声明 | `P5-T26-W08-gate-prep`、`T27-gate-readiness.json` |

## 3. 未完成 / NOT_RUN（阻止更高状态）

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| 真实人工系统 IME / 多 DPI | NOT_RUN | 需人工中文输入法与多显示器实测 |
| W08 覆盖升级/降级/兼容（I 证据） | NOT_RUN（就绪检查 NOT_READY 6/8） | 计划与产物已备：`T27-installer-upgrade-plan.md`；只读 dry-run 6/8（候选 1.2.18 安装包 + 28 个历史安装包 + NSIS 齐备；阻塞=未授权 `KE_T27_AUTHORIZED` + 未声明 `KE_T27_ISOLATED_ENV`），见 `P5-T26-W08-gate-prep.md`/`T27-gate-readiness.json`，**非 I 通过** |
| W01 ZIP 离线包/ZIP bomb/多资源完整性 | 部分（U+W 8/8） | zip staging/安装/zip-slip/条目数/总量防护已实现并 W 验证；**I 门禁未执行**、更深炸弹/嵌套 zip 未覆盖 |
| W02 表单交接（IME/title/tags/公式草稿跨 UI） | 部分（Core U 6/6 + 产品 title/tags W 8/8） | guest→Broker→宿主后端原子写 title+tags 已 W 验证；未知命令拒绝；**公式/重命名草稿、迟到命令、候选启动失败、提交后 UI 同步、IME 交接未做** |
| W03 包与私有状态回滚 | NOT_RUN | Core 有 store/recover，U 级；I 门禁未做 |
| W04 SDK 外部独立开发模板/CLI | 部分（外部路径 W 7/7 + SDK 发布形态 W 7/7 + 自检） | 已可外部生成/签名/安装/启用包（无需改宿主源码）；SDK 以仓库内 dist（iife+ESM）分发并提供 autoConnect 握手/snapshot；**npm/tgz 正式发布流程、文档站/示例集/调试工具、发布密钥分发、第二套 UI 全任务覆盖未做** |
| W05 协议 snapshot/subscribe/断连重放 | 部分（握手+snapshot W 7/7） | 产品 host 真实 Broker/Dispatcher + SDK GuestClient 握手/snapshot 已验证；subscribe/断连/慢包/超时 queryResult 未做 |
| W06 执行/网络边界（IPC/loopback/fetch/worker） | 部分（网络/worker/WS 功能级 W 8/8） | fetch 相对/loopback/外部、worker、WebSocket 均被阻断；越权方法 E_CAPABILITY；guest internals 自检上报；剩余：导航/下载/伪造消息系统化、loopback 资源白名单、Tauri 升级回归 |
| W07 原生故障恢复（无限循环/CPU/内存/boot crash） | 部分（无限循环 W 8/8 + 内存压力 W 11/11 + CPU 压力 W 10/10） | 独立 renderer 故障均未阻塞宿主。内存：guest 分配 2048MB（0 失败），宿主 IPC max 3.6ms、renderer 工作集 +2057MB、心跳持续；renderer 崩溃（CDP Page.crash 注入，非自然 OOM）后 ≈1.0s 检出 suspended → failed + safeMode → 停用 stopped 持久化。CPU：40ms 分片满载 ≈0.80 core 未误判（心跳 +14、active）；2500ms 长任务饥饿 ≈1.6s 检出 suspended → failed + safeMode → stopped。证据 `P5-T26-W07-fault-mem.md`/`T26-W07-mem-results.json`；**boot crash/桥接超时/连续启动失败/原生 Rust 恢复/I 门禁未验证；自然 OOM 未触发（崩溃路径为注入），2GB 压力上限受同机安全约束** |
| W09 性能/资源预算 | 工坊口径 **PASS（W 6/6）**；产品大文档首开限制另记 | 无双编辑器/无逐字符广播（34 字符→1 次写）/8 次切换堆增 4.7MB；大文档首开慢为产品既有 @tiptap/markdown 解析限制（非工坊回归，见 `P5-T26-W09-workshop.md`/`-plain`） |
| F01–F16 全功能基线逐项 guest 覆盖 | 部分 | 官方 UI 基线回归绿；**guest 入口全任务覆盖**未逐项验证 |
| 正式发布密钥流程 | NOT_RUN | ADR-003 实施清单未执行（无正式密钥） |

## 4. 结论与建议

- 当前如实状态：**`EXPERIMENTAL_TRUSTED_PACKS`**（受信实验包，范围受限；上述 NOT_RUN 明确列出）。
- 进阶到 `LOCAL_WORKSHOP_RELEASE_CANDIDATE` 必须：完成 T27 I 门禁、W01/W02/W03/W04/W05/W06/W07/W09、
  guest 原生入口全任务覆盖、正式密钥流程；且人工 IME/DPI 通过。
- 本评估不改变分支本地/不发布约束；后续每项补完须附证据并更新本文件。

## 3c. G1/G2 结构性缺口闭环（2026-10-19）

- G1 内容读通道：`context.snapshot` additive `content?/contentBytes?`（context.read 才返回；真实
  `GET /api/articles/{rel}` 原文，BOM/frontmatter/CRLF 逐字节）；G2 写通道：`context.write` 进
  manifest/trusted/builtin + Rust `ALLOWED_CAPS`，产品桥接真实 `/api/context/write`
  （completed/conflict/stale/failed 如实，删除假桩）。
- 验证：前端 1834 passed（+15 单测）、cargo 51 passed、产品 W **14/14**（snapshot 正文=磁盘、
  write 落盘 revision 递增、旧 revision conflict 且不覆盖）。
- **F01–F16 整体仍未逐项登记**（0/121），G1/G2 只消除 F07/F12 的结构性阻塞；不改变 0 项已实现口径。

## 3d. G3/G4 缺口闭环（2026-10-19）

- G3 print.snapshot：真实打印管线（PDF 文件存在/大小/%PDF 头；不同 token 不覆盖；非法/不存在文档如实
  错误；pages=null 不伪造）；G4 宿主事件：document-saved（revision 与后端 context.snapshot 一致）、
  context-changed、theme-changed 均到达 guest；宿主三类 window 事件全链路真实触发。
- 验证：单测 + 产品 W **18/18 PASS**（首轮 14/18 → 修复后 18/18，失败与修复如实记录）。
- 已知限制：**打印期间 Rust PrintToPdf 阻塞主线程 message pump → guest 心跳超时临时放宽到 8s**
  （更彻底需移出主线程）；PDF 输出目录测试用诊断覆盖（生产仍 appDataDir）；公式 React NodeView 在
  打印 HTML 为线性 LaTeX（与 A2 既有来源一致）。
- F01–F16 逐项台账仍未登记（G3/G4 关闭不等于覆盖达成）。

## 3e. G7 pack A/B 参考 UI（2026-10-19）

- 新增 `docs/ui-workshop/packs/pack-a`（侧栏读场景）与 `pack-b`（Dock 写场景），入口 vendored SDK
  `dist/guest-sdk.js`，能力最小化（A: ui.shell/panel.sidebar/context.read/print.request；
  B: ui.shell/panel.dock/context.read + 命令 set-title/set-tags）；构建/签名/zip 工具
  `tools/build_reference_packs.mjs`（测试私钥不入仓，dist gitignore）。
- 产品 W **24/24 PASS**：构建/签名幂等 3 + pack A 8（真实快照/打印/事件/错误/停用）+ pack B 6
  （能力/握手/命令落盘/错误）+ 安全进程等；guest 真实 DOM 输入点击（Target.attachToTarget OOPIF）。
- **仍剩**：F01–F16 逐项台账 `packAEntry`/`packBEntry` 0/130、`officialBaselineResult` 仍 NOT_RUN
  （参考包只是载体，不等于逐项通过）；发布 SDK 无事件订阅 API、协议无当前文档 relPath 发现通道。

## 3f. F01–F16 逐项台账登记 v2（2026-10-19）

- `feature-baseline.csv`：**72/130 行**已登记（v4）；**F03 42/42 全量登记（37 PASS / 5 FAIL：链接/模块插入
  2 行 v4 新 FAIL + Ctrl+Shift+8 无序列表/Ctrl+Shift+B 引用/工具栏保存 3 行既有 FAIL，如实保留）**；
  F16 11/11 行：原生菜单为 **结构性审计证据（U/静态）**、W/DOM 未覆盖 → NOT_RUN；官方 UI 累计
  49 PASS / 5 FAIL / 76 NOT_RUN（其余未执行行保持 NOT_RUN）。
- F16 原生菜单审计：`menu.rs` 11 个 MenuItem（含 `ke-menu:*` ID/标签/加速键/handle_event 分发）→
  `evidence/P5-T26-F16-native-menu-audit.md`；CDP 无法点击原生菜单，不伪造 W。
- F14 官方导出：对话框入口 PASS；**最终 export_pdf 落 Documents 未执行（NOT_RUN，USERPROFILE 覆盖会禁用
  CDP 无法安全隔离）**；补充官方 Rust print 管线 preview_pdf 在隔离 TEMP 真实生成 36541B `%PDF`
  （不冒充最终导出）。
- 探针 `run_feature_entry_probe.py`（官方 CDP + guest OOPIF 真实 DOM）；**v4 checks 71/76 PASS**（5 FAIL 如实）
  （v1 37/40 的 3 个失败根因 = 探针 `dismiss_overlays()` 误关工坊面板，修复后全绿；document-saved
  使用产品真实 window 事件入口并如实标注 eventMethod）。
- 未覆盖（如实）：F14 官方导出落盘（仅验证到对话框入口）、F16 原生菜单（非 DOM）、F03 其余 35 行、
  F01/F03/F04/F05/F09/F11/F13/F16 的 pack 路径（协议无对应方法，能力面 NOT_RUN）。
- 参考包≠逐项通过：登记口径为「真实执行过的行」，未执行不伪造；F01–F16 整体仍未达成。
