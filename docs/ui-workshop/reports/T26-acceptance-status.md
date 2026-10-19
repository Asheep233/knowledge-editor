# T26 Windows 验收状态（阶段验收记录，非最终认证）

- 日期：2026-10-19（末段收敛） · 平台：Windows 11 + WebView2 155 · 环境：隔离测试构建
  （独立 identifier `com.astranota.uiws.e2e`，测试数据在 `C:\ke-tmp`，不触碰用户实例/真实笔记）
- 结论口径（2026-10-19 末段收敛后）：**A1–A8 及 W01/W02/W04/W05/W06/W07（无限循环 + 内存/CPU 压力 +
  boot crash 43/45 + 桥接/原生恢复 45/46）/W09（工坊口径）/IME-DPI/G1–G7/F 台账均已有真实产品壳
  W 证据（含 PASS_WITH_FINDINGS）；但 T26 任务级最终认证仍未达成**——仍缺人工真实系统 IME/多 DPI、
  安装包覆盖升级/回滚 I 门禁（T27，就绪检查 NOT_READY 6/8，云端执行材料已备、未执行）、
  W01/W03/W07 等 I 门禁，以及 W02/W05/W06 部分类别与 F01–F16 guest 原生入口覆盖。
- 项目里程碑口径：按 `reports/milestone-assessment.md`（ACCEPTANCE A 节）=
  **`EXPERIMENTAL_TRUSTED_PACKS`**，不声明更高状态。
- **修正说明**：本文 2026-10-19 08:36 版第 4 节曾写「项目级仍 `P0_READY`，不得使用
  `EXPERIMENTAL_TRUSTED_PACKS`」——该表述早于里程碑评估，与 ACCEPTANCE A 节口径及
  `reports/milestone-assessment.md` 冲突；现以里程碑评估为准修正。历史表述保留在 `progress.md` 台账中。

## 1. 已完成场景（真实产品壳 W / 原型 W 汇总）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| A1 隔离构建/启动/独立 appData/启动 recover/单实例/用户 App 不受影响 | **7/7** | `P5-T26-isolated-smoke.md` |
| A2 隐藏 renderer + 快照打印 + ready 握手 + 路径安全/不覆盖 | **9/9** | `P5-T26-A2-print.md` |
| A3 启动 recover（回退/无回退 safeMode）不阻断启动 | **9/9** | `P5-T26-A3-recover.md` |
| A4 签名信任链（valid/missing/invalid/revoked → 安装拒绝） | **通过** | `P5-T26-A4-A6-install.md` |
| A6 安装→启用→回滚→卸载（磁盘 state 校验） | **通过** | 同上（A4+A6 合计 16/16） |
| A5 工坊信任 UI（入口/真实列表/签名徽章/授予撤销/TrustStore 持久化） | **11/11** | `P5-T26-A5-ui.md` |
| A8 Core 保存 flag 产品 UI（autosave→上下文写/frontmatter 保留） | **9/9** | `P5-T26-A8-save.md` |
| A7 产品侧包隔离宿主 + A5 能力上限运行时（自定义协议/心跳崩溃/safeMode/停用持久化） | **11/11** | `P5-T26-A7-A5-guest.md` |
| A7 安全核对：guest 独立 origin + Tauri IPC 可达性（附残余风险） | **6/6** | `P5-T26-A7-isolation.md` |
| 原型壳 W 探针一键门禁 | **13/13** | `P5-T26-windows-witnesses.md` |
| 产品 IME 组词 + DPI/缩放后编辑面可用（CDP/WebView2 渲染层，不能替代人工实测） | **7/7** | `P5-T26-ime-dpi.md` |
| W01 ZIP 离线包 staging/安装 + 解压安全（U+W） | **8/8** | `P5-T26-W01-zip.md` |
| W02 表单交接（Core U 6/6 + 产品 title/tags 交接 W 8/8） | **W 8/8 PASS（title/tags 切片）** | `P5-T26-W02-formhandoff.md`、`P5-T26-W02-form.md` |
| W04 外部开发者路径（脚手架→签名→安装→启用，不修改宿主源码） | **W 7/7 + 脚手架自检 5/5** | `P5-T26-W04-sdk.md`、`W04-scaffold-selftest.json` |
| W04 SDK 发布形态（`docs/ui-workshop/sdk/` dist guest-sdk + autoConnect 握手/snapshot） | **W 7/7 + SDK 自检 4/4** | `P5-T26-W04-sdk-dist.md` |
| W05 产品 guest 协议线（Broker/Dispatcher↔SDK 握手 + snapshot） | **7/7** | `P5-T26-W05-protocol.md` |
| W06 guest 执行/网络边界（fetch/worker/WS/能力越权，功能级） | **8/8** | `P5-T26-W06-boundary.md` |
| W07 guest 无限循环故障（宿主独立/心跳检测/failed+safeMode/停用） | **8/8（无限循环类别，部分）** | `P5-T26-W07-fault.md` |
| W07 guest 内存/CPU 压力故障（独立 renderer；内存 11/11 + CPU 10/10） | **W 21/21（扩展类别，部分）** | `P5-T26-W07-fault-mem.md` |
| W07 boot crash/连续启动失败（v2 修复后复测；A2-10 孤儿自愈/B1-4 失败日志/B3-4 备份重置闭环） | **W 43/45 PASS_WITH_FINDINGS**（剩 B1-6/B2-5 已知设计限制） | `P5-T26-W07-fault-boot.md` |
| W07 桥接超时/sidecar 故障/原生 Rust 恢复（v6 修复后复测；9 缺口闭环） | **W 45/46 PASS_WITH_FINDINGS**（剩 C2-7 已知设计限制） | `P5-T26-W07-fault-bridge.md` |
| W09 性能（工坊口径：无复制/无逐字符广播/无泄漏） | **6/6 PASS（W）** | `P5-T26-W09-workshop.md` |
| 产品大文档首次打开性能（pre-existing 限制，非工坊回归） | 记录（FAIL，已知限制） | `P5-T26-W09-perf.md`、`-diag`、`-plain` |
| T27/W08 I 门禁就绪检查（dry-run，只读；**非 I 通过**） | **NOT_READY 6/8**（产物齐备；阻塞=未授权 `KE_T27_AUTHORIZED` + 未声明 `KE_T27_ISOLATED_ENV`） | `P5-T26-W08-gate-prep.md`、`T27-gate-readiness.json` |
| G1/G2 guest 内容读 + 真实写通道（删除假桩） | **W 14/14** | `P5-T26-G1G2-content-io.md` |
| G3/G4 print.snapshot 真实打印 + 宿主事件 | **U+W 18/18**（已知限制见 §3c） | `P5-T26-G3G4-print-events.md` |
| G7 pack A/B 参考 UI（SDK 读/写/打印/事件） | **W 24/24** | `P5-T26-G7-reference-packs.md` |
| F03 官方 UI 快捷键/工具栏域（blockquote 产品缺陷修复闭环） | **42/42 全 PASS** | `P5-T26-F-ledger.md`、`P5-T26-F03-fail-audit.md` |
| F01–F16 逐项台账（官方 UI + pack A/B） | checks 71/76；官方 UI **60 PASS/0 FAIL/70 NOT_RUN**；F16 结构性审计 W NOT_RUN | `P5-T26-F-ledger.md`、`feature-baseline.csv` |

> 说明：A1–A8 全部已有真实产品壳 W 证据（≠ T26 最终认证完成）；T26 认证仍需补人工真实 IME/
> 多 DPI、安装包升级/回滚演练（T27 I 门禁）、F01–F16 guest 覆盖补强，并完成 W02/W05/W06 剩余类别。

## 2. 本轮发现并修复的真实缺陷（W 价值）

1. `PrintRenderState` 未 `.manage()` → 打印命令 State 注入失败（T16 单元/构建不可见）；
2. `workshop_pack_activate` 非幂等 → 重复激活破坏 previous/rollback 目标（已修复 + 单测）；
3. 隔离构建 `frontendDist` 绝对路径导致 file:// origin → IPC 失败（需相对路径嵌入资源）；
4. 测试构建与主构建共享 target 互相覆盖 exe（单实例静默接管）→ 固定测试 exe 目录；
5. SDK 发布形态初版握手消息误用 `handshake.request`（宿主 HostDispatcher 契约是
   `type:'handshake'`）→ `E_TIMEOUT`；修正后产品 W 7/7（`P5-T26-W04-sdk-dist.md`）；
6. **F03 审计发现真实产品缺陷**：`KeBlockJoin.ts` 的 `KeBlockquote.addKeyboardShortcuts()` 覆盖丢弃
   上游 `Mod-Shift-b` → Ctrl+Shift+B 引用快捷键失效；`f4759a2` 修复后 W 复测 6/6，F03 台账 42/42
   全 PASS（`P5-T26-F03-fail-audit.md`）；
7. **W07 修复闭环（W 发现的真实缺口）**：A2-10 孤儿 sidecar 启动自愈、B1-4 sidecar 失败原因可观测、
   B3-4 损坏 settings/app_config 备份+重置、C2-3 入口冷启动 safeMode/恢复角标、B-6 上下文重建重试、
   A-10 超时 E_TIMEOUT/retryable、B-4 RuntimeHealthBanner、B-5 宿主不可用会话挂起/恢复、B-8 stale
   runtime 清理、C1-4/C2-2/C3-5 启动恢复提示 —— 均已 FAIL→PASS 复测
   （`P5-T26-W07-fault-boot.md`、`P5-T26-W07-fault-bridge.md`）。

## 3. 未完成项（不得省略）

- **人工真实系统 IME / 多 DPI**：CDP 路径已过 W 7/7（`P5-T26-ime-dpi.md`），但不能替代人工输入法/
  多显示器实测；清单 `reports/MANUAL-IME-DPI-CHECKLIST.md` 待主理人执行；
- **安装包覆盖升级/回滚 I 门禁（T27/W08、W03、W01 I）**：执行材料已备（`T27-CLOUD-EXECUTION-HANDOFF.md`、
  `T27-I-GATE-RUNBOOK.md`、`T27-ARTIFACTS.md`），需主理人授权 + 专用隔离环境/云端 VM；当前 **NOT_RUN**，
  就绪检查 NOT_READY（6/8）；
- **W01 剩余**：I 门禁未执行；更深 zip bomb/嵌套压缩未覆盖；
- **W02 剩余**：公式/重命名草稿、候选启动失败、提交后编辑器 UI 同步、IME 组字交接（迟到请求/旧连接
  已补 W 12/12）；
- **W04 剩余**：SDK npm/tgz 正式发布流程与版本策略、文档站/示例集/调试工具、发布密钥分发规范、
  外部开发者第二套 UI 全任务覆盖；
- **W05 剩余**：subscribe/断连重放/慢包/超时 queryResult/取消冲突语义；
- **W06 剩余**：导航/下载/伪造消息系统化、loopback 资源白名单、Tauri 升级回归；
- **W07 剩余（已定稿）**：C2-7（corrupt-no-fallback 不自动修复）、B1-6/B2-5（运行期无自愈，需重启；
  重启可恢复）——已知设计限制；I 门禁未做；内存场景 renderer 崩溃为 CDP `Page.crash` 注入（非自然
  OOM，2GB 上限受同机安全约束）（`P5-T26-W07-fault-boot.md`、`-bridge.md`、`-mem.md`）；
- **W09 全量**：工坊硬指标已 PASS；大文档首开慢为产品既有 `@tiptap/markdown` 解析限制
  （非工坊回归），需产品性能优化后复跑；
- **F01–F16 覆盖**：官方 UI 逐项台账 60 PASS/0 FAIL/70 NOT_RUN；F14 最终导出 Documents、F16 OS 级
  原生菜单交互 NOT_RUN；guest 原生入口整体覆盖未达成（0 已实现/3 部分/13 未实现，
  `reports/F01-F16-COVERAGE.md`）；
- **正式发布密钥签发/分发流程**（ADR-003 实施清单）未执行。

## 3c. 已定稿已知限制（不计划修复，如实保留）

| 缺口 | 说明 | 决策/证据 |
| --- | --- | --- |
| W07 C2-7 corrupt-no-fallback 无自动修复 | 自动「修复」等于删除用户数据或猜测内容；唯一安全路径=卸载/重装 + safe mode/notice | 已知设计限制（`P5-T26-W07-fault-bridge.md`） |
| W07 B1-6 端口耗尽后运行期无自愈 | 故障解除后运行中实例不自动重试，需重启（重启可恢复、失败可观测） | 已知设计限制（`P5-T26-W07-fault-boot.md`） |
| W07 B2-5 数据目录恢复后运行期无自愈 | 同上（需重启） | 已知设计限制 |
| G3/G4 打印期间主线程阻塞 | guest 心跳超时临时放宽到 8s；PDF 测试输出用诊断覆盖（生产不变）；公式 NodeView 打印为线性 LaTeX | 已记录限制（`P5-T26-G3G4-print-events.md`），非验收失败 |

## 3b. 隔离残余风险（必须随认证结论一起说明）

- guest 独立 origin 已成立（`http://workshop.localhost`），但 guest 仍能看到 `__TAURI_INTERNALS__`
  对象（跨域 iframe 继承 Tauri 注入，不可配置不可移除）；实测 invoke 无响应（timeout，remote IPC
  未生效）→ 当前不可利用，但属实现细节；已实现 guest 自检上报 + 宿主残余风险提示。需 Tauri
  remote-domain IPC 审计与升级回归（详见 `P5-T26-A7-isolation.md` / ADR-004）；
- 版本基准：以上结论对应当前 Tauri/WebView2 155；Tauri 升级后必须复跑
  `run_t26_guest_isolation_probe.py` 与 W 探针门禁。

## 4. 认证判定

- **项目里程碑 = `EXPERIMENTAL_TRUSTED_PACKS`**（ACCEPTANCE A 节，见 `reports/milestone-assessment.md`）：
  只允许受信实验包；隔离/离线/恢复仍有未通过项与残余风险。
- **T26 任务级最终认证 = 未达成**：完成定义（A1–A8 全绿 + W 门禁 + 人工 IME/多 DPI + T27 安装升级/
  回滚演练）中，A1–A8、W 门禁（含 W07 PASS_WITH_FINDINGS）、G1–G7、F03 已达成，但人工 IME/多 DPI、
  T27 I 门禁、W02/W05/W06 剩余类别、F01–F16 guest 覆盖未完成。
- **明确不声明**：`IMPLEMENTED_WINDOWS_PENDING` 完成态、`LOCAL_WORKSHOP_RELEASE_CANDIDATE`；理由：
  T27 I 门禁未执行、人工 IME/多 DPI 未做、F 覆盖部分、W07 3 项已知设计限制。也不得把「A1–A8 W 通过」
  表述为「T26 已认证」。
- 建议下一阶段顺序：T27 I 门禁（授权 + 云端/隔离 VM，材料已备）→ 人工 IME/多 DPI →
  F01–F16 覆盖补强（G7 参考包逐项登记）→ W02/W05/W06 剩余类别 → W09 产品性能优化 →
  正式密钥流程 → 重新评估 T26 认证与项目里程碑。

## 5. 隔离缺陷与操作事故（2026-10-19，必须披露）

- **产品 `data_dir()` 不随 identifier 变化**（`%APPDATA%\KnowledgeEditor`）：T26 测试构建早期版本
  与用户运行实例共享该目录 → 测试实例读取到用户真实 app_config 的最近工作区，A8 首跑在 UI 上
  **只读显示**了用户真实工作区列表（无编辑/保存；索引/设置未被测试改写，已核对 mtime）。
  修复：全部 T26 runner 注入 `APPDATA=<隔离目录>`（已提交），之后 A8 只显示隔离工作区；
  已删除真实 app_config 中被测试注入的 1 条 `hello.md` recent_document 记录。
- **两次误杀用户 App**：① 早期 runner 清理误用 `taskkill /IM knowledgeeditor.exe`；
  ② 一次清理命令误用 `Stop-Process -Id <用户 PID>`。均已即时重启用户 App（当前运行正常），
  红线已写入工具文档：**测试进程只按自身 PID 终止；sidecar 只按测试路径白名单清理；
  禁止引用/操作 `D:\AstraNota` 用户进程**。
- 遗留：真实 `%APPDATA%\KnowledgeEditor\runtime\runtime.json` 可能仍记录测试 PID（stale）；
  用户 App 下次启动会重写/清理，不影响数据。
