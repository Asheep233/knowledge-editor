# UI 工坊最终交接（最终交付状态 · 2026-10-19 末段收敛）

> **最终状态一句话**：代码与真实产品 W 证据已收敛（frontend **143 files/1931 passed + 1 skipped**、
> tsc 0；backend **847**；产品 cargo **67**；矩阵 **59 行 --check PASS**）；里程碑
> **`EXPERIMENTAL_TRUSTED_PACKS`**（ACCEPTANCE A 节），**明确不声明** `IMPLEMENTED_WINDOWS_PENDING`
> 完成态 / `LOCAL_WORKSHOP_RELEASE_CANDIDATE`（T27 I 门禁未执行、人工 IME/多 DPI 未做、F 覆盖部分、
> W07 3 项已知限制）；**T26 任务级最终认证未达成**。分支 `feat/ui-workshop` **本地，未推送、未 Release**。
>
> 本文是 **UI 创意工坊任务的最终交付状态文档**。完整阶段记录见 `HANDOVER.md`（阶段快照，数字已过时）、
> `reports/SESSION-FINAL-SUMMARY.md`；逐任务台账见 `progress.md`；里程碑判定见
> `reports/milestone-assessment.md`；一页式状态表见 `reports/FINAL-DELIVERY-STATUS.md`。
> 整理前 HEAD = `0737e7f`；本文末尾「最终收敛」小节为本轮交付收口记录。

## 1. 代码与回归基线

- 分支：`feat/ui-workshop`，基线 v1.2.18 `4c71233` + overlay `e54d37b`；本轮最终收敛前 HEAD =
  `0737e7f`（交付收敛提交见 `git log --oneline -1`）；
- 最近一次全量回归（2026-10-19 末段；本轮交付收敛时复核）：

| 套件 | 结果 | 说明 |
| --- | --- | --- |
| frontend `tsc -b --noEmit` | **0 错** | WSL |
| frontend `vitest run --maxWorkers=2` | **143 files / 1931 passed + 1 skipped** | WSL/happy-dom（U 级）；收敛时本地复跑确认 |
| backend `pytest backend/tests -q` | **847 collected / exit 0** | WSL；收敛时本地复跑确认（Windows Py3.10 曾全绿） |
| 产品壳 `cargo test --release` | **67 passed** | Windows（Rust 单测，引自 `P6-final-verification.md`；WSL 未复跑） |
| 原型 W 探针一键门禁 | **13/13 PASS** | `run_all_w_probes.py --check`（Windows/WebView2） |
| 平台验证矩阵 | **59 行**，`--check` **PASS**（44 个 results JSON 全覆盖；另含 F16 结构性审计 NOT_RUN 行、T27 就绪检查 READINESS 行，显式 NOT_READY、非验收通过；W07 boot/bridge 与 F 台账为 PASS_WITH_FINDINGS） | `build_validation_matrix.py --check` |

> 核对口径：frontend（tsc 0、143 files/1931 passed + 1 skipped）与 backend（847 collected/exit 0）在
> 本轮收敛时本地复跑确认；产品 cargo 67、原型 W 13/13 引自 `P6-final-verification.md` 与
> `P5-T26-windows-witnesses.md`（Windows 侧本轮未复跑，数字为最近一次记录）。

复现命令：

```bash
# 前端（WSL）
cd frontend && npx tsc -b --noEmit && npx vitest run --maxWorkers=2
# 后端（WSL）
python3 -m pytest backend/tests -q
# 产品 Rust（Windows）
cd desktop/src-tauri && cargo test --release && cargo build --release
# 平台验证矩阵门禁（跨平台，纯静态汇总）
python3 docs/ui-workshop/tools/build_validation_matrix.py --check
# 原型 W 门禁（Windows；需先构建原型壳）
python docs/ui-workshop/tools/run_all_w_probes.py --check
```

## 2. 真实产品壳 W 证据索引（产品 W = Windows 11 + WebView2 155 隔离测试构建 `com.astranota.uiws.e2e`）

> 所有 W 证据均在隔离构建 + 隔离 `APPDATA`/工作区执行，不触碰用户实例 `D:\AstraNota` 与真实笔记。
> 原始结果 JSON 均在 `docs/ui-workshop/evidence/`，逐项矩阵见 `validation-matrix.csv`。

### 2.1 A 场景（T26 验收计划 A1–A8）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| A1 隔离构建/启动/独立 appData/启动 recover/单实例/用户 App 不受影响 | **W 7/7** | `P5-T26-isolated-smoke.md` |
| A2 隐藏 renderer 快照打印/ready 握手/路径安全/不覆盖 | **W 9/9** | `P5-T26-A2-print.md` |
| A3 启动 recover/safeMode 不阻断启动 | **W 9/9** | `P5-T26-A3-recover.md` |
| A4 签名信任链（valid/missing/invalid/revoked → 安装拒绝） | **W 通过** | `P5-T26-A4-A6-install.md` |
| A5 工坊信任 UI（真实列表/签名徽章/授予撤销/TrustStore 持久化） | **W 11/11** | `P5-T26-A5-ui.md` |
| A6 安装→启用→回滚→卸载（磁盘 state 校验） | **W 通过**（A4+A6 合计 16/16） | `P5-T26-A4-A6-install.md` |
| A7+A5 产品 guest 宿主（自定义协议/能力上限/心跳崩溃/safeMode/停用持久化） | **W 11/11** | `P5-T26-A7-A5-guest.md` |
| A7 隔离核对（独立 origin / internals 自检上报 / remote IPC 不可用） | **W 6/6**（残余风险记录） | `P5-T26-A7-isolation.md` |
| A8 Core 保存 flag（autosave→`/api/context/write`/frontmatter 保留） | **W 9/9** | `P5-T26-A8-save.md` |
| 产品 IME 组词 + DPI/缩放后编辑面（CDP/WebView2 渲染层；**非人工系统 IME**） | **W 7/7** | `P5-T26-ime-dpi.md` |

### 2.2 W 场景（工坊验收 W01–W09，按已实现切片如实标注）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| W01 ZIP 离线包 staging/安装/解压安全（zip-slip/条目数/总量防护） | **W 8/8**（I 门禁未做） | `P5-T26-W01-zip.md` |
| W02 表单交接 title/tags：guest→Broker→宿主后端原子写 frontmatter；未知命令拒绝 | **W 8/8（title/tags 切片）** | `P5-T26-W02-form.md` |
| W02 表单交接 Core 状态机（幂等/迟到/原子/失败可重试） | **U 6/6** | `P5-T26-W02-formhandoff.md` |
| W02 停用后迟到请求/旧连接失效（重放验证，不落盘；注入方式如实标注） | **W 12/12** | `P5-T26-W02-form.md`（追加） |
| W04 外部开发者路径：脚手架→外部签名→产品安装→启用（无需改宿主源码） | **W 7/7 + 脚手架自检 5/5** | `P5-T26-W04-sdk.md`、`W04-scaffold-selftest.json` |
| W04 SDK 发布形态：独立 `docs/ui-workshop/sdk/` dist（iife+ESM）→ autoConnect 握手/真实 snapshot | **W 7/7 + SDK 自检 4/4** | `P5-T26-W04-sdk-dist.md` |
| W05 产品 guest 协议线：Broker/Dispatcher↔SDK 握手 + context.snapshot | **W 7/7** | `P5-T26-W05-protocol.md` |
| W06 guest 执行/网络边界：fetch 相对/loopback/外部阻断、worker 不执行、WS 不连接、越权 E_CAPABILITY | **W 8/8（功能级）** | `P5-T26-W06-boundary.md` |
| W07 guest 无限循环故障：宿主不阻塞/心跳 suspended→failed+safeMode/停用持久化 | **W 8/8（无限循环类别）** | `P5-T26-W07-fault.md` |
| W07 扩展故障类别：guest 内存压力（2048MB/宿主 IPC max 3.6ms/注入崩溃检出 1.0s）+ CPU 压力（≈0.80 core/长任务饥饿 1.6s 检出） | **W 21/21（内存 11/11 + CPU 10/10，部分）** | `P5-T26-W07-fault-mem.md` |
| W07 boot crash/连续启动失败（v2 修复后复测：A2-10 孤儿自愈/B1-4 失败日志/B3-4 备份重置闭环） | **W 43/45 PASS_WITH_FINDINGS**（剩 B1-6/B2-5 运行期无自愈，已知设计限制） | `P5-T26-W07-fault-boot.md` |
| W07 桥接超时/sidecar 故障/原生 Rust 恢复（v6 修复后复测：B-6/A-10/B-4/B-5/B-8/C1-4/C2-2/C3-5/C2-3 共 9 缺口闭环） | **W 45/46 PASS_WITH_FINDINGS**（剩 C2-7 no-fallback 不可自动修复，已知设计限制） | `P5-T26-W07-fault-bridge.md` |
| W09 性能（工坊口径）：无双编辑器/无逐字符广播/无持续泄漏 | **W 6/6 PASS** | `P5-T26-W09-workshop.md` |
| W09 大文档首开性能（产品既有 `@tiptap/markdown` 解析限制） | **记录 FAIL（已知限制，非工坊回归）** | `P5-T26-W09-perf.md`、`-diag`、`-plain` |
| 原型壳 W 探针一键门禁（S1/S1b/S2/S4/T11/T13/T15/T18/T19×3/T20/T21） | **13/13 PASS** | `P5-T26-windows-witnesses.md` |

### 2.3 T27 / W08 I 门禁（只读就绪检查，**不是 I 通过**）

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| T27 安装/覆盖升级 I 门禁就绪 dry-run（只读，不安装） | **NOT_READY 6/8**：候选 1.2.18 安装包 + 28 个历史安装包 + NSIS 配置齐备；阻塞=未授权 `KE_T27_AUTHORIZED` + 未声明 `KE_T27_ISOLATED_ENV` | `P5-T26-W08-gate-prep.md`、`T27-gate-readiness.json` |
| W08 覆盖升级/降级/兼容 I 证据 | **NOT_RUN** | 计划/交接：`reports/T27-installer-upgrade-plan.md`、`T27-CLOUD-EXECUTION-HANDOFF.md`、`T27-I-GATE-RUNBOOK.md` |

### 2.4 G / F 结构性缺口闭环与逐项台账（2026-10-19 后段）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| G1/G2 guest 内容读通道 + 真实写通道（context.write trusted/builtin，删除假桩；CAS 冲突） | **W 14/14 PASS** | `P5-T26-G1G2-content-io.md`、`T26-G1G2-results.json` |
| G3/G4 print.snapshot 真实打印管线 + 宿主事件（document-saved/context-changed/theme-changed 到达 guest） | **U+W 18/18 PASS**（首轮 14/18 的 4 失败与修复如实记录） | `P5-T26-G3G4-print-events.md` |
| G7 pack A/B 参考 UI（vendored 发布 SDK；A 侧栏读/打印/事件，B Dock 写/命令） | **W 24/24 PASS**（参考包≠F 逐项覆盖） | `P5-T26-G7-reference-packs.md`、`packs/pack-a`、`packs/pack-b` |
| F03 官方 UI 快捷键/工具栏域（含产品 FINDING：Ctrl+Shift+B 引用快捷键被覆盖） | **42/42 全 PASS**（修复 `f4759a2` 后 W 复测 6/6） | `P5-T26-F-ledger.md`（v6）、`P5-T26-F03-fail-audit.md` |
| F16 原生菜单结构审计（只读 `menu.rs` 11 项 MenuItem/加速键/事件分发） | **11/11 结构性审计（U/静态）；W/DOM NOT_RUN** | `P5-T26-F16-native-menu-audit.md` |
| F01–F16 逐项台账（官方 UI + pack A/B 三路径） | checks **71/76**；CSV **130 行**：官方 UI **60 PASS / 0 FAIL / 70 NOT_RUN**；F 台账自述登记 72/130（直核：含 PASS 行 61） | `P5-T26-F-ledger.md`、`feature-baseline.csv` |
| F01–F16 guest 原生入口覆盖量化审计（静态 + U 复跑） | **未达成**：已实现 0 / 部分 3 / 未实现 13；`packAEntry`/`packBEntry` 大量 NOT_RUN（能力面不可达，如实登记） | `reports/F01-F16-COVERAGE.md` |

## 3. 里程碑判定（ACCEPTANCE A 节）

- **当前里程碑：`EXPERIMENTAL_TRUSTED_PACKS`**（受信实验包可用；隔离、离线限制或恢复仍有未通过项）。
  判定依据：只允许受信包（信任等级强制/验签/撤销/TrustStore/信任 UI 已有产品 W 证据）；隔离
  （独立 origin 成立但 `__TAURI_INTERNALS__` 可见、invoke 实测 timeout → 残余风险）；离线
  （ZIP 离线包功能级 W，但更深攻击面与 I 门禁未做）；恢复（启动 recover/safeMode 与 W07 故障恢复
  已有多类 W 证据，但 W03/W07 的 I 恢复门禁未做，且 W07 有 3 项已知限制）。
- **明确不声明**：`IMPLEMENTED_WINDOWS_PENDING` 完成态、`LOCAL_WORKSHOP_RELEASE_CANDIDATE`。理由：
  ① **T27 安装/覆盖升级/回滚 I 门禁未执行**（就绪检查 NOT_READY 6/8，云端执行材料已备、待授权）；
  ② **人工真实系统 IME / 多 DPI 未做**（CDP/WebView2 渲染层 W 7/7 不能替代人工实测）；
  ③ **F01–F16 覆盖部分**（官方 UI 逐项台账 60 PASS/0 FAIL/70 NOT_RUN；guest 原生入口覆盖未达成）；
  ④ **W07 3 项已定稿已知限制**（C2-7、B1-6、B2-5，需卸载/重启恢复，不计划修复）。
- **T26 任务级最终认证：未达成**。A1–A8 已有真实产品壳 W 证据（见 §2.1），但 T26 完成定义还要求
  人工真实 IME/多 DPI、T27 安装升级/回滚演练、W 门禁全部通过；当前这些未完成（见 §5）。
- W07 已达到「覆盖 4 类故障（无限循环/内存/CPU/boot/bridge，其中 boot/bridge 为 PASS_WITH_FINDINGS）」
  的程度，但按如实口径仍为**部分通过**（3 项已知限制 + I 门禁未做）。
- 完整逐项核对：`reports/milestone-assessment.md`（W07 行含全部扩展探针结果）。

## 4. 残余风险（必须随交付说明）

1. **guest 隔离残余风险**：guest 仍可见 `window.__TAURI_INTERNALS__`（跨域 iframe 继承 Tauri 注入，
   不可配置不可移除）；当前实测 `invoke` 无响应（remote IPC 未生效/timeout）→ 当前不可利用但属
   实现细节，Tauri/WebView2 升级可能改变行为。已实现 guest 自检上报 + 宿主残余风险提示；
   Tauri 升级后必须复跑 `run_t26_guest_isolation_probe.py`。见 ADR-004、`P5-T26-A7-isolation.md`；
2. **人工真实系统 IME/多 DPI 未验证**：CDP/WebView2 渲染层路径已过 W 7/7，但不能替代人工输入法
   与多显示器实测（清单 `reports/MANUAL-IME-DPI-CHECKLIST.md` 待主理人执行）；
3. **安装/覆盖升级/回滚 I 证据未执行**：T27 就绪检查 NOT_READY（待主理人授权 + 专用隔离环境/云端
   VM）；W08/W01 I 门禁仍 NOT_RUN；云端执行单与产物清单已备；
4. **W07 已知设计限制 3 项**：C2-7（corrupt-no-fallback 不自动修复，避免危及用户数据）、B1-6/B2-5
   （资源恢复后运行期不自动重试，需重启应用，重启可恢复）；均已定稿、行为诚实可观测；
5. **F01–F16 覆盖部分**：官方 UI 台账 60 PASS/0 FAIL/70 NOT_RUN；F03 42/42 全 PASS、F16 仅结构性审计、
   F14 最终导出 Documents 未执行；guest 原生入口整体覆盖未达成（静态审计 0 已实现/3 部分/13 未实现）；
6. **W 部分类别**：W02 剩余（公式/重命名草稿、候选启动失败、提交后 UI 同步、IME 交接）、
   W05 剩余（subscribe/断连重放/慢包/超时）、W06 剩余（导航/下载/伪造消息系统化、loopback 白名单、
   Tauri 升级回归）、W09 全量预算复跑；
7. **W09 大文档首开慢**：产品既有 `@tiptap/markdown` 解析超线性限制（非工坊回归），需产品性能优化；
8. **SDK 正式发布流程缺失 / 无正式发布密钥流程**：SDK 以仓库内 dist 形态提供（iife/ESM，`private:true`），
   npm/tgz 发布流程、文档站/示例集、发布密钥分发规范未做；ADR-003 实施清单未执行（当前为测试密钥/信任根）。

## 5. NOT_RUN / 未完成清单（阻止更高状态）

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| T27 安装/覆盖升级/降级/回滚/卸载 I 门禁（W08/W03/W01 I） | **NOT_RUN**（就绪检查 NOT_READY 6/8） | 材料齐备：`reports/T27-CLOUD-EXECUTION-HANDOFF.md`（云端 Codex 执行单）、`T27-I-GATE-RUNBOOK.md`、`T27-ARTIFACTS.md`（28 个安装包 sha256）；阻塞=授权 + 隔离环境 |
| 人工真实系统 IME / 多 DPI | **NOT_RUN** | 需人工中文输入法与多显示器实测；清单 `reports/MANUAL-IME-DPI-CHECKLIST.md` |
| W01 I 门禁 / 更深 zip 攻击面 | **部分** | U+W 8/8；I 未执行；zip bomb 深层/嵌套未覆盖 |
| W02 表单交接完整语义 | **部分** | title/tags W 8/8 + 迟到请求/旧连接 W 12/12；公式/重命名草稿、候选启动失败、UI 同步、IME 交接未做 |
| W04 外部开发者完整路径 | **部分** | 外部路径 W 7/7 + SDK 发布形态 W 7/7 + 自检；npm/tgz 发布流程、文档站/示例集、第二套 UI 全任务未做 |
| W05 协议完整语义 | **部分** | 握手+snapshot W 7/7；subscribe/断连重放/慢包/超时 queryResult 未做 |
| W06 边界完整覆盖 | **部分** | 网络/worker/WS/越权功能级 W 8/8；导航/下载/伪造消息系统化、loopback 白名单、Tauri 升级回归未做 |
| W07 全部故障类别 | **部分（PASS_WITH_FINDINGS）** | 无限循环 W 8/8 + 内存 W 11/11 + CPU W 10/10 + boot **43/45** + bridge **45/46**；剩 C2-7/B1-6/B2-5 三项已知设计限制；自然 OOM 未触发（CDP 注入） |
| W09 全量性能预算 | **部分（工坊口径 PASS）** | 工坊硬指标 W 6/6 PASS；大文档首开为产品既有性能限制，优化后需复跑 |
| F14 最终导出 PDF 落 Documents | **NOT_RUN** | 对话框/A4 预览 PASS；`%USERPROFILE%` 覆盖会破坏 CDP 隔离；隔离 TEMP 的 preview_pdf 真实 PDF 为补充证据（不冒充最终导出） |
| F16 OS 级原生菜单交互 | **NOT_RUN** | 仅 `menu.rs` 11 项结构性审计（U/静态）；原生菜单非 DOM，CDP 无法真实点击 |
| F01–F16 guest 原生入口整体覆盖 | **部分/未达成** | 官方 UI 60 PASS/70 NOT_RUN；静态审计 0 已实现/3 部分/13 未实现（`reports/F01-F16-COVERAGE.md`） |
| 正式发布密钥流程 | **NOT_RUN** | ADR-003 实施清单未执行 |

## 6. 事故与红线记录（必须披露）

- **约束遵守**：分支本地**未推送、未发布 Release**；未用真实用户笔记做测试；未隐藏旧 App
  （工坊入口/Core 保存分支均默认关闭，可回退）；未把 happy-dom/Linux 结果冒充 W。
- **事故 1（已披露并补救）**：早期 runner 清理误用 `taskkill /IM knowledgeeditor.exe` → 误杀用户 App；
- **事故 2（已披露并补救）**：一次清理误用 `Stop-Process -Id <用户 PID>`；
  两起均即时重启用户 App，红线已写入 `tools/t26_isolated_build.md`：**测试进程只按自身 PID 终止；
  sidecar 只按测试路径白名单清理；禁止引用/操作 `D:\AstraNota` 用户进程**。
- **事故 3（数据隔离，已补救）**：产品 `data_dir()` 不随 identifier 变化 → 早期 T26 运行共享真实
  `%APPDATA%\KnowledgeEditor`（只读显示用户最近工作区，无写入）；已强制全部 runner 注入隔离
  `APPDATA` + 清理测试 identifier 目录；真实 app_config 中测试注入条目已清除。
- **遗留**：真实 `%APPDATA%\KnowledgeEditor\runtime\runtime.json` 可能仍记录测试 PID（stale），
  用户 App 下次启动重写/清理，不影响数据。

## 7. 文档索引

| 文档 | 用途 |
| --- | --- |
| `HANDOVER-FINAL.md`（本文） | 最终交付状态（基线/W 证据索引/里程碑/风险/NOT_RUN/事故） |
| `reports/FINAL-DELIVERY-STATUS.md` | 一页式交付状态（已通过/部分/未通过 + 待主理人项） |
| `reports/milestone-assessment.md` | 里程碑逐项判定（ACCEPTANCE A 节） |
| `reports/T26-acceptance-status.md` | Windows 阶段验收状态（逐场景 + 未完成项 + 事故） |
| `reports/F01-F16-COVERAGE.md` | F01–F16 guest 原生入口覆盖量化审计（0/3/13） |
| `reports/T27-installer-upgrade-plan.md` | 安装/覆盖升级 I 门禁执行计划（待授权） |
| `reports/T27-I-GATE-RUNBOOK.md` | T27 I 门禁逐步执行手册（待授权 + 专用 VM） |
| `reports/T27-CLOUD-EXECUTION-HANDOFF.md` | T27 云端 Codex 执行交接单（VM 由主理人安排） |
| `reports/T27-ARTIFACTS.md` | 28 个安装包清单/sha256（候选 1.2.18） |
| `reports/MANUAL-IME-DPI-CHECKLIST.md` | 人工真实 IME/多 DPI 验收清单与记录模板 |
| `validation-matrix.csv` + `tools/build_validation_matrix.py` | 平台验证矩阵（59 行，自动生成 + `--check` 门禁） |
| `feature-baseline.csv` | F01–F16 逐项台账（130 行） |
| `progress.md` | 逐任务台账（含历史表述与修正记录） |
| `evidence/` | 全部证据（44 个 results JSON + 证据 md） |
| `adr/ADR-000..004` | 基线/运行域/保存接线/签名密钥/包宿主决策 |
| `HANDOVER.md`、`reports/SESSION-FINAL-SUMMARY.md` | **阶段快照（数字过时，仅作历史）**，以本文为准 |

**一致性修正记录**（交付整理/最终收敛时发现并修正）：
1. `reports/T26-acceptance-status.md` 旧第 4 节「项目级 P0_READY、不得使用 EXPERIMENTAL_TRUSTED_PACKS」
   与里程碑评估/ACCEPTANCE A 节冲突 → 已按证据修正为 `EXPERIMENTAL_TRUSTED_PACKS`；
2. 旧 A7 隔离核对数字 5/5 → 证据为 **6/6**（`T26-A7-isolation-results.json`），已更正；
3. 矩阵基线 cargo 38 → **50 → 67**、工坊 UI 单测 18 → **63**（最新回归证据 + 本地复跑核对）；
4. W09 三份大文档性能结果保持 **KNOWN_FAIL（已知限制）**，未改写为通过；
5. 矩阵 51 → **59 行**：W07 boot/bridge 与 F 台账改为 `PASS_WITH_FINDINGS` 显式缺口口径（2/1/5），
   未按 FAIL 阻断、也未写成全通过；补齐 bridge/F-ledger META（此前为 `?/U?` 行）；
6. F03 台账由 v4「37 PASS/5 FAIL」→ 根因审计 v5（4 项自动化限制改判）→ **v6 blockquote 产品缺陷
   修复后 42/42 全 PASS**；旧文中的 5 FAIL 已按证据更新，未删除审计历史；
7. T26/FINAL 旧文「T27 就绪检查」保持 NOT_READY 6/8（非 I 通过），未因文档收敛改写状态。

## 8. 下一步建议（按优先级）

1. **T27 I 门禁（最高优先）**：主理人授权 + 云端/专用隔离 VM，按 `T27-I-GATE-RUNBOOK.md` 执行
   U1–U6 → 产出 I 证据（`T27-I-results.json` + 证据 md）→ 更新 W08/W03/W01 I 状态与里程碑；
2. **人工真实 IME / 多 DPI**：按 `MANUAL-IME-DPI-CHECKLIST.md` 在本机隔离环境执行并截图登记；
3. **F01–F16 覆盖补强**：以 G7 参考包为载体，逐项登记 `packAEntry`/`packBEntry`（当前 70 行 NOT_RUN）；
   补 F14 最终导出（隔离环境）与 F16 OS 级菜单交互（非 DOM 自动化或 Rust 集成测试）；
4. **W02/W04/W05/W06/W09 剩余类别**：表单完整交接、SDK npm/tgz 正式发布、协议 subscribe/断连、
   边界系统化、全量性能预算复跑；
5. **W07 剩余 3 项已知限制**按产品决策评估是否提供「引导卸载/重装」等增强（当前不含自动修复）；
6. **正式发布密钥流程**（ADR-003 实施清单）与 Tauri 升级回归；
7. 全部完成并复评 T26 认证后，才可评估 `LOCAL_WORKSHOP_RELEASE_CANDIDATE`；发布/推送需主理人明确授权。

## 追加交付物（2026-10-19 会话后段）

- **人工验收指引**：`reports/MANUAL-IME-DPI-CHECKLIST.md`（真实系统 IME + 多 DPI/多显示器逐步
  清单与记录模板；需主理人在本机执行，结果登记后更新本文档与矩阵）。
- **T27 I 门禁执行手册**：`reports/T27-I-GATE-RUNBOOK.md`（安装/覆盖升级/回滚/卸载/重启 U1–U6；
  就绪检查 `evidence/T27-gate-readiness.json` = NOT_READY(6/8)，仅缺主理人授权 + 专用隔离环境；
  当前仓库**不含自动安装脚本**，禁止在用户日常机执行）。
- **W04 SDK 发布形态**：`docs/ui-workshop/sdk/`（dist guest-sdk.js/mjs 入仓）+ `P5-T26-W04-sdk-dist.md`
  （自检 4/4 + 产品 W 7/7）。
- **W07 扩展**：`P5-T26-W07-fault-mem.md`（内存 11/11 + CPU 10/10，独立 renderer；自然 OOM 未触发，
  renderer crash 为 CDP 注入，如实记录）。
- 交付文档定稿：`reports/FINAL-DELIVERY-STATUS.md` + 矩阵 51 行 --check PASS（38 个 results JSON 全覆盖）。

## 追加（2026-10-19）：F01–F16 guest 入口覆盖审计

- 报告：`reports/F01-F16-COVERAGE.md`（commit `fdac4ea`）；静态审计 + guest 链路 U 测试复跑（6 files/45 passed）。
- 结论（如实）：**F01–F16 guest 原生入口 = 已实现 0 / 部分 3（F02/F10/F14）/ 未实现 13**；
  `feature-baseline.csv` F 域 121 行 `packAEntry`/`packBEntry` 0/121 登记、`officialBaselineResult`
  130/130 NOT_RUN；guest 协议 5 方法中 2 桩、`context.write` 能力不可声明、5 类宿主事件 0 发射。
- 前 5 缺口（P0）：G1 无内容读通道（snapshot 无正文）、G2 写通道不可达+假桩伪造完成、G3 print.snapshot
  为桩、G4 宿主事件 0 发射、G7 无 pack A/B 参考 UI/逐项台账空白。
- 正在推进：G1/G2 修复（内容读通道 + 真实写通道，见后续提交）。

## 追加（2026-10-19 后段 · Agent Team 并行产出）

- `1ea4c62` **G1/G2**：guest 内容读通道（snapshot additive content）+ 真实写通道（context.write
  能力 trusted/builtin、Rust 门禁、真实 /api/context/write，删除假桩）→ 产品 W **14/14**；
  前端 1834 passed、cargo 51 passed。
- `d502d9d` **W02 迟到请求/旧连接失效**：停用 guest 卸载 iframe；宿主重放预捕获迟到请求验证
  旧连接失效（丢弃/不落盘），W **12/12**（证据明确标注注入方式与限定结论）。
- `5921ec4` **W07 boot crash/连续启动失败**：44 checks **40 PASS / 4 真实缺口**（孤儿 sidecar、
  端口耗尽静默/不重试、数据目录占用不重试、损坏 settings 静默回退），PASS_WITH_FINDINGS；
  不宣称 W07 整体通过。
- `fdac4ea` **F01–F16 审计**：0 已实现/3 部分/13 未实现（G1/G2 已闭环其中结构阻塞，仍不改变统计）。
- `582f386` **T27 云端执行交接单**（VM 由主理人让云端 Codex 执行；证据按 U1–U6 回传登记）。
- 矩阵：**53 行** --check PASS（新增 G1/G2、W07 boot 行；W07 boot 标 PASS_WITH_FINDINGS(4 缺口)）。

## 追加（2026-10-19 后段 · T27 云端交接）

- `reports/T27-CLOUD-EXECUTION-HANDOFF.md`：云端 Codex 执行单（环境/构建安装包/U1–U6/证据格式/红线）；
- `reports/T27-ARTIFACTS.md`：本地 28 个安装包文件名/大小/sha256（含候选 `AstraNota_1.2.18_x64-setup.exe`）；
- `reports/T27-I-GATE-RUNBOOK.md`：逐步执行手册。I 门禁仍为 **NOT_RUN**，待云端 VM 执行后由 Lead 登记。

## 追加（2026-10-19 后段 · G3/G4）

- `50621cc` **G3/G4**：print.snapshot 接真实打印管线（真实 PDF/不覆盖/错误如实/pages=null 不伪造）；
  宿主事件 document-saved（revision 与后端一致）/context-changed/theme-changed 到达 guest；
  单测 + 产品 W **18/18 PASS**（首轮 14/18 的 4 个失败与修复如实记录）。
- 已知限制：打印期间主线程阻塞 → guest 心跳超时放宽到 8s（彻底方案需打印移出主线程）；
  PDF 测试输出用诊断覆盖定向隔离目录（生产路径不变）；公式 NodeView 打印为线性 LaTeX（A2 同源）。

## 追加（2026-10-19 后段 · G7 参考包）

- `bf11462` **G7**：新增 pack A（侧栏读）/pack B（Dock 写）参考 UI（vendored 发布 SDK、能力最小化、
  构建+签名+zip 工具、测试私钥不入仓、dist gitignore）；产品 W **24/24 PASS**（真实快照/打印/
  事件/命令落盘/错误/停用，guest 真实 DOM 操作）。
- **仍剩**：F01–F16 逐项台账 0/130 未登记（参考包≠逐项通过）；SDK 无事件订阅 API、协议无当前文档
  relPath 发现通道；打印 renderer env 门控、页数 null 等既有缺口未变。

## 追加（2026-10-19 后段 · W07 桥接 + F 台账 v1）

- `5945aaf` + `f87f243` **W07 桥接/sidecar/原生恢复**：39 checks **30 PASS / 9 真实缺口**（sidecar 2.2s
  自动重启与用户重启恢复 PASS；缺口：自动重启后新后端上下文丢失→`E_SNAPSHOT` 404 桥接不自动恢复、
  桥接超时映射 `E_INTERNAL` 而非 `E_TIMEOUT`、崩溃 UI/session/stale pid 可观测性、启动 recover 无 UI
  提示、corrupt-no-fallback 不可自动修复）；证据 `P5-T26-W07-fault-bridge.md`。
- `cc322ca` **F01–F16 逐项台账 v2**：第二轮窗口 40/40 checks PASS；CSV 27/130 行（官方 UI 26 PASS、
  pack A 4 PASS/23 能力面 NOT_RUN、pack B 4 PASS/23 NOT_RUN）；v1 3 项失败根因=探针 `dismiss_overlays()`
  误关工坊面板（非产品失败），修复后 document-saved（产品真实 window 事件入口，eventMethod 标注）/
  theme-changed（真实设置面板切换）/停用 guest 均 PASS。未覆盖：F14 导出落盘、F16 原生菜单、
  F03 其余 35 行、多数 pack 能力面。
- `4528897` **F01–F16 逐项台账 v1**：`run_feature_entry_probe.py`（官方 CDP + guest OOPIF 真实 DOM）；
  `feature-baseline.csv` 登记 **27/130 行**（官方 UI 26 PASS、pack A 3 PASS/1 FAIL/23 能力面 NOT_RUN、
  pack B 4 PASS/23 NOT_RUN）；未完成：全量批次被打断、pack A 事件/主题/停用 3 项待第二轮、
  F16 原生菜单/导出落盘未测；**不宣称 F01–F16 覆盖达成**。
- 矩阵：新增 W07 bridge 与 F ledger 行（`PASS_WITH_FINDINGS` 显式标注缺口数），`--check` 待本轮刷新。

## 追加（2026-10-19 后段 · W07 B-6/A-10 修复 + 复测）

- `443e0a6` **B-6/A-10 修复**：snapshot/write/print 读取统一 `withGuestContext`（上下文失效 404/409 →
  重建绑定重试一次；write 幂等复用 requestId）；`requestJson` AbortController 超时 → 协议
  `E_TIMEOUT(retryable=true)`（不再是 E_INTERNAL/signal aborted）。单测 +32、tsc 0。
- `4780319` **修复后产品 W 复测**：B-6 FAIL→**PASS**（sidecar 自动重启后 snapshot 42ms 成功、
  正文=磁盘）；A-10 FAIL→**PASS**（超时返回 E_TIMEOUT/retryable=true，print 无假 token；阻塞期间
  UI 0.4ms 响应）；W07 bridge 最终 **39 checks 32 PASS / 7 缺口**（PASS-with-gaps，未宣称全通过）。

## 追加（2026-10-19 后段 · W07 B-4/B-5/B-8 修复 + 复测）

- `deed2a7` **B-4/B-5/B-8**：App 级 `RuntimeHealthBanner`（restarting/degraded/recovered 三态，工坊
  modal 之上可见，无事件不误报）；PackageHost `markHostUnavailable/markHostRestored`（宿主故障 →
  guest session suspended + `E_HOST_UNAVAILABLE`，不计崩溃/不进 safeMode，ready 后恢复 active）；
  Rust 侧车退出即清空 `SidecarState.info` + 删除 stale runtime.json（get_runtime_info 不再返回死 pid）。
  cargo 57 passed、vitest 142 files/1915 passed、tsc 0。
- `e794a06` **修复后产品 W 复测**：B-4/B-5/B-8 均 FAIL→**PASS**（banner restarting→recovered→degraded、
  session suspended+E_HOST_UNAVAILABLE→active、runtime.json 即时删除无 stale pid）；W07 bridge 最终
  **40 checks 36 PASS / 4 缺口**（仅剩 C 类：启动 recover 无 UI 提示 ×3、no-fallback 不可自动修复）。

## 追加（2026-10-19 后段 · W07 C1-4/C2-2/C3-5 修复 + 复测）

- `a41d449` **C 类修复**：Rust 只读命令 `workshop_pack_startup_status`（读 workshop-recover-status.json，缺失
  found:false 不报错、只读不触发 recover_all）+ adapter `startupStatus?()` + WorkshopPanel 挂载时读取并在
  有恢复动作/safeMode 时显示 `startup-recover-notice`（动作详情/可关闭、同时预置 safeMode 横幅）。
- `dcb04d7` **修复后产品 W 复测**：C1-4/C2-2/C3-5 均 FAIL→**PASS**（面板打开即显示恢复/安全模式提示、
  只读校验 mtime/sha 不变、无状态不误报、可关闭）；W07 bridge 最终 **45 checks 43 PASS / 2 缺口**
  （仅剩 C2-3 冷启动入口 safeMode 角标、C2-7 no-fallback 不可自动修复）。

## 追加（2026-10-19 后段 · F 台账 v3：F03 批量 + F14 尝试）

- `78e5c25` **F 台账 v3**：checks 60/63；F03 新增 **22 行**真实登记（19 PASS/3 FAIL：Ctrl+Shift+8 无序
  列表、Ctrl+Shift+B 引用、工具栏保存按钮）；全库已登记 **49/130 行**（官方 UI 45 PASS/3 FAIL、F03 30/42、
  pack A/B 各 4 PASS 其余能力面 NOT_RUN）。
- **F14**：官方导出对话框/A4 预览 PASS；最终 `export_pdf` 落 Documents **NOT_RUN**（USERPROFILE 覆盖会
  disable CDP，无法安全隔离，未写真实用户目录）；补充 preview_pdf 隔离 TEMP 真实 PDF 36541B 作为官方管线
  落盘补充证据（不冒充最终导出）。未覆盖：F03 剩余 12 行、F16 原生菜单等，如实 NOT_RUN。

## 追加（2026-10-19 后段 · W07 C2-3 + boot 三缺口修复 + 复测）

- `a80ec8b` **C2-3/B1-4**：WorkshopEntry 冷启动只读 startup status → 入口 `workshop-startup-badge`
  （safeMode/恢复动作可见，无状态不误报）；sidecar 启动失败结构化 eprintln（E_SIDECAR_PORT/START + N/3）
  + terminal `ke:runtime-error`。
- `b030b25` **A2-10/B3-4**：spawn registry `sidecar-spawn.json` 保守判定并整树停止上次孤儿 sidecar；
  损坏 settings/app_config → `.corrupt-<ts>.bak` 备份原始字节 + 默认重置（幂等）+ 可恢复事件。
- `543bb08` **修复后产品 W 复测**：C2-3/A2-10/B1-4/B3-4 均 FAIL→**PASS**（入口 badge 可见、孤儿 pid 14128
  被清理端口回 8000、stderr 517B 结构化原因、损坏文件备份+重置幂等）；bridge **45/46**（剩 C2-7），
  boot **43/45**（剩 B1-6/B2-5 运行期无自愈，需重启，已知设计限制）。

## W07 剩余缺口定稿（2026-10-19）

- W07 bridge **45/46**（唯一缺口 C2-7：corrupt-no-fallback 自动修复——自动修复会危及用户数据，
  保留卸载/重装安全路径 + safe mode/notice 明确提示，**定稿为已知设计限制**）；
- W07 boot **43/45**（B1-6/B2-5：资源恢复后运行中实例不自动重试，需重启；重启可恢复且有 W 证据，
  **定稿为已知设计限制**；失败原因已可观测 B1-4）。
- 这两类不再改动产品语义；交付口径按 PASS-with-known-gaps，不宣称 W07 全通过。

## 追加（2026-10-19 后段 · F 台账 v4：F03 全量 + F16 原生菜单审计）

- `f164ce1` **F 台账 v4**：checks 71/76；**F03 42/42 全量登记（37 PASS / 5 FAIL）**——v4 新增 10 PASS
  （heading2/3、插入图片真实上传、块级公式、脚注、note、表格、撤销/重做）+ 2 新 FAIL（链接插入未产生
  `<a>`、模块插入未出现正文）+ 3 既有 FAIL（Ctrl+Shift+8、Ctrl+Shift+B、工具栏保存）如实保留；
  **F16 原生菜单 11 项结构性审计**（menu.rs：11 MenuItem/ID/加速键/事件分发）→ W/DOM 未覆盖如实 NOT_RUN；
  CSV 累计 **72/130 行**登记。
- 剩余：F03 5 FAIL 待产品/探针复核；F16 原生菜单真实交互需 OS 级 UI 自动化；F14 最终导出 Documents 隔离限制
  NOT_RUN；guest 能力面未覆盖行 NOT_RUN。

## 追加（2026-10-19 后段 · F03 FAIL 根因审计 v5）

- `4784980` **F03 五 FAIL 根因审计**：4 项为探针/自动化限制（断言只数 `<ul>`、连续自动化保存状态耦合、
  链接需正确前置、模块 portal 懒加载时序）→ 定向复核后 CSV 改判 **PASS**；**1 项真实产品 FINDING**：
  `KeBlockJoin.ts:104/131` 的 `KeBlockquote.addKeyboardShortcuts()` 丢弃上游 `Mod-Shift-b`（+editor/index.ts:158
  blockquote:false）→ Ctrl+Shift+B 引用快捷键失效（工具栏可用）。F03 变为 **41 PASS / 1 FAIL**；
  证据 `P5-T26-F03-fail-audit.md`（含修复建议，未改产品代码）。后续：修复该快捷键并复测。

## 追加（2026-10-19 后段 · blockquote FINDING 修复 + F03 全 PASS）

- `f4759a2` **真实产品缺陷修复**：`KeBlockJoin.ts` 的 `KeBlockquote.addKeyboardShortcuts()` 改为继承上游
  `{...this.parent?.()}` 并只覆盖自定义 `Backspace`，恢复被丢弃的 `Mod-Shift-b`（Ctrl+Shift+B 引用）；
  新增 4 例单测（快捷键表/keydown toggle/Backspace 不回归/自定义 Backspace 优先），tsc 0、全量 1931 passed。
- `5289d6e` **修复后产品 W 复测 6/6 PASS**：折叠光标与选中文本 Ctrl+Shift+B 均真实 toggle（DOM bq 0→1→0）、
  工具栏「引用」不变、引用块内 atom 后空行 Backspace 不回归、Ctrl+B/I 与撤销重做正常。
- **F03 台账 42/42 全 PASS（0 FAIL）**；官方 UI 累计 60 PASS / 0 FAIL / 70 NOT_RUN；原 v5 唯一
  PRODUCT_FINDING 闭环。证据 `P5-T26-F03-fail-audit.md`（修后复测段）、F 报告附录 I。

## 最终收敛（2026-10-19 末段 · 交付文档收口）

> 本节为最终交付状态收口记录；历史追加段保留原样（按时间顺序，各段数字为当时状态）。

- **代码/回归基线（复核值）**：frontend **143 files / 1931 passed + 1 skipped**、tsc 0（本轮收敛本地复跑）；
  backend **847 collected / exit 0**（本轮收敛本地复跑）；产品 cargo **67 passed**（引自
  `P6-final-verification.md`，Windows 侧未复跑）；原型 W **13/13**；验证矩阵 **59 行 --check PASS**
  （44 个 results JSON 全部纳入；bridge/F-ledger META 已补齐；W07 boot/bridge/F 台账为 PASS_WITH_FINDINGS）。
- **W 证据最终统计**：A1 7/7、A2 9/9、A3 9/9、A4+A6 16/16、A5 11/11、A7+A5 11/11、A7 隔离 6/6、A8 9/9、
  IME/DPI 7/7；W01 8/8、W02 8/8+12/12、W04 7/7+SDK 7/7、W05 7/7、W06 8/8、W07 无限循环 8/8 +
  内存/CPU 21/21 + boot **43/45** + bridge **45/46**、W09 工坊口径 6/6；G1/G2 14/14、G3/G4 18/18、
  G7 24/24；F03 **42/42 全 PASS**；原型 W 13/13。
- **F 台账最终口径**：checks 71/76；CSV 130 行（官方 UI **60 PASS / 0 FAIL / 70 NOT_RUN**；F 台账自述
  登记 72/130，直核含 PASS 行 61）；F16 原生菜单 11/11 **结构性审计**（W NOT_RUN）；F14 最终导出
  Documents **NOT_RUN**（隔离限制）；guest 原生入口整体覆盖仍未达成（静态审计 0 已实现/3 部分/13 未实现）。
- **已知限制定稿**：W07 C2-7（corrupt-no-fallback 不自动修复）、B1-6/B2-5（运行期无自愈，需重启；
  重启可恢复）——均记录为已知设计限制，不宣称 W07 全通过。
- **里程碑/认证口径**：`EXPERIMENTAL_TRUSTED_PACKS`；不声明 `IMPLEMENTED_WINDOWS_PENDING` 完成态 /
  `LOCAL_WORKSHOP_RELEASE_CANDIDATE`；T26 任务级最终认证**未达成**（T27 I 门禁未执行、人工 IME/多 DPI
  未做、F 覆盖部分、W07 3 项已知限制）。
- **待主理人**：T27 云端 Codex 执行（`reports/T27-CLOUD-EXECUTION-HANDOFF.md` + `T27-I-GATE-RUNBOOK.md`
  + `T27-ARTIFACTS.md`；需授权 + 隔离 VM）与人工 IME/多 DPI（`reports/MANUAL-IME-DPI-CHECKLIST.md`）。
- **约束**：分支本地未推送/未 Release；未改产品语义（blockquote 修复为审计确认的真实缺陷）；未触碰
  用户 App；全部测试在隔离构建/隔离数据目录执行；事故（两次误杀用户 App、早期只读显示用户工作区）
  已披露并写入红线。
- **本文与** `reports/FINAL-DELIVERY-STATUS.md`、`reports/milestone-assessment.md`、
  `reports/T26-acceptance-status.md`、`validation-matrix.csv` **数字口径一致**；矛盾处以证据/
  `P6-final-verification.md` 与矩阵为准。

## 交付一致性检查（2026-10-19）

- `docs/ui-workshop/tools/verify_delivery_consistency.py`：只读 8 项检查（矩阵门禁/证据引用/私钥/未推送/
  工作树/台账可解析/里程碑口径），`--write` 落 evidence；最近一次 **8/8 PASS**。
