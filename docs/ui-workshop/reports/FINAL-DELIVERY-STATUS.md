# UI 工坊交付状态（一页式最终状态 · 2026-10-19 末段）

> 分支 `feat/ui-workshop`（**本地，未推送、未发布 Release**）。HEAD 以 `git log --oneline -1` 为准
> （本文件所在提交；整理前 HEAD = `0737e7f`）。完整说明见 `HANDOVER-FINAL.md`；里程碑判定见
> `reports/milestone-assessment.md`；逐任务台账见 `progress.md`。
> **口径**：所有「通过」必须可追溯到 `docs/ui-workshop/evidence/` 下证据文件；部分通过标「部分」，
> 未执行标 `NOT_RUN`；不把计划/结构性审计/就绪检查写成通过。

## 0. 一句话结论

**项目里程碑 = `EXPERIMENTAL_TRUSTED_PACKS`（ACCEPTANCE A 节）。**
**明确不声明** `IMPLEMENTED_WINDOWS_PENDING` 完成态、`LOCAL_WORKSHOP_RELEASE_CANDIDATE`，理由：
① T27 安装/覆盖升级/回滚 **I 门禁未执行**（就绪检查 NOT_READY 6/8）；② 人工真实系统 IME / 多 DPI
**未做**（仅 CDP/WebView2 渲染层 W）；③ F01–F16 guest 原生入口覆盖 **部分**（官方 UI 逐项台账仅
60/130 行 PASS，其余 NOT_RUN）；④ W07 尚有 **3 项已定稿已知限制**（C2-7、B1-6、B2-5，重启/卸载
可恢复，不计划修复）。**T26 任务级最终认证：未达成**（A1–A8 W 证据已齐，但上述门禁未完成）。

## 1. 代码基线与回归（最近一次，交付收敛时复核）

> **最终构建回归**（2026-10-19 末段，exe sha256 前缀 `c849241b`）：在最终构建上复跑 A4+A6 **16/16**、
> G1/G2 **14/14**、A8 **9/9** 全 PASS（`evidence/P5-T26-final-build-regression.md`）；不新增功能，仅确认交付快照。


| 项 | 结果 | 说明 |
| --- | --- | --- |
| 分支/基线 | `feat/ui-workshop`（本地） | 基线 v1.2.18 `4c71233` + overlay `e54d37b`；未推送/未 Release |
| frontend `tsc -b --noEmit` | **0 错** | WSL |
| frontend `vitest run --maxWorkers=2` | **143 files / 1981 passed + 1 skipped** | WSL/happy-dom（U 级）；本次收敛本地复跑确认 |
| backend `pytest backend/tests -q` | **847 collected / exit 0** | WSL；本次收敛本地复跑确认（Windows Py3.10 曾全绿） |
| 产品壳 `cargo test --release` | **67 passed** | Windows（Rust 单测，引自 `P6-final-verification.md`；WSL 未复跑） |
| 原型 W 探针一键门禁 | **13/13 PASS** | `run_all_w_probes.py --check`（引自 `P5-T26-windows-witnesses.md`） |
| 平台验证矩阵 | **59 行 / `--check` PASS** | `validation-matrix.csv`：44 个 `*-results.json` 全部纳入；另含 F16 结构性审计行（NOT_RUN）、T27 就绪检查 READINESS 行（NOT_READY 6/8，非验收）、W07 boot/bridge 与 F 台账 PASS_WITH_FINDINGS 行；基线本轮复核：protocol 19、print 36（去除重复/stale 的 14 行） |

## 2. 真实产品 W 证据全景（Windows 11 + WebView2 155，隔离构建 `com.astranota.uiws.e2e`）

> 全部在隔离构建 + 隔离 `APPDATA`/工作区执行，不触碰用户实例 `D:\AstraNota` 与真实笔记；
> 原始结果 JSON 在 `evidence/`，逐项见 `validation-matrix.csv`。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| A1 隔离构建/启动/独立 appData/启动 recover/单实例 | **W 7/7** | `P5-T26-isolated-smoke.md` |
| A2 隐藏 renderer 快照打印/ready 握手/路径安全 | **W 9/9** | `P5-T26-A2-print.md` |
| A3 启动 recover/safeMode | **W 9/9** | `P5-T26-A3-recover.md` |
| A4+A6 签名信任链 + 安装/启用/回滚/卸载 | **W 16/16** | `P5-T26-A4-A6-install.md` |
| A5 工坊信任 UI（列表/徽章/授予撤销/TrustStore） | **W 11/11** | `P5-T26-A5-ui.md` |
| A7+A5 产品 guest 宿主（协议/能力上限/心跳崩溃/safeMode/停用） | **W 11/11** | `P5-T26-A7-A5-guest.md` |
| A7 隔离核对（独立 origin/internals 自检/remote IPC 不可用） | **W 6/6**（残余风险记录） | `P5-T26-A7-isolation.md` |
| A8 Core 保存 flag 产品 UI | **W 9/9** | `P5-T26-A8-save.md` |
| IME 组词 + DPI/缩放（CDP/WebView2 渲染层，**非人工实测**） | **W 7/7** | `P5-T26-ime-dpi.md` |
| W01 ZIP 离线包 staging/安装/解压安全 | **W 8/8**（I 门禁未做） | `P5-T26-W01-zip.md` |
| W02 表单交接 title/tags（guest→Broker→后端原子写） | **W 8/8**（切片） | `P5-T26-W02-form.md` |
| W02 停用后迟到请求/旧连接失效（重放验证，不落盘） | **W 12/12** | `P5-T26-W02-form.md`（追加） |
| W04 外部开发者路径（脚手架→签名→安装→启用，无需改宿主源码） | **W 7/7 + 自检 5/5** | `P5-T26-W04-sdk.md`、`W04-scaffold-selftest.json` |
| W04 SDK 发布形态（dist SDK→autoConnect 握手/真实 snapshot） | **W 7/7 + SDK 自检 4/4** | `P5-T26-W04-sdk-dist.md` |
| W05 产品协议线（Broker/Dispatcher↔SDK 握手 + snapshot） | **W 7/7** | `P5-T26-W05-protocol.md` |
| W06 执行/网络边界（fetch/worker/WS/越权，功能级） | **W 8/8** | `P5-T26-W06-boundary.md` |
| W07 guest 无限循环故障 | **W 8/8** | `P5-T26-W07-fault.md` |
| W07 guest 内存压力（11/11）+ CPU 压力（10/10） | **W 21/21**（自然 OOM 未触发，崩溃为 CDP 注入） | `P5-T26-W07-fault-mem.md` |
| W07 boot crash/连续启动失败（修复后复测） | **W 43/45**（PASS_WITH_FINDINGS；2 缺口见 §3.1） | `P5-T26-W07-fault-boot.md` |
| W07 桥接超时/sidecar 故障/原生 Rust 恢复（修复后复测） | **W 45/46**（PASS_WITH_FINDINGS；1 缺口见 §3.1） | `P5-T26-W07-fault-bridge.md` |
| W09 性能（工坊口径：无复制/无逐字符广播/无泄漏） | **W 6/6** | `P5-T26-W09-workshop.md` |
| G1/G2 guest 内容读 + 真实写通道（假桩删除） | **W 14/14** | `P5-T26-G1G2-content-io.md` |
| G3/G4 print.snapshot 真实打印 + 宿主事件 | **U+W 18/18**（含已知限制，见 §3.3） | `P5-T26-G3G4-print-events.md` |
| G7 pack A/B 参考 UI（SDK 读/写/打印/事件真实链路） | **W 24/24** | `P5-T26-G7-reference-packs.md` |
| F03 官方 UI 快捷键/工具栏域（Ctrl+Shift+B 产品缺陷修复闭环） | **42/42 全 PASS**（W 复测 6/6） | `P5-T26-F-ledger.md`、`P5-T26-F03-fail-audit.md` |
| F16 原生菜单结构审计 | **11/11 结构性审计（U/静态）**；W/DOM **NOT_RUN** | `P5-T26-F16-native-menu-audit.md` |
| F 台账（F01–F16 三路径逐项登记） | checks **71/76**；CSV **130 行**：官方 UI **60 PASS / 0 FAIL / 70 NOT_RUN**；F 台账自述登记 **72/130**（直核：含 PASS 行 61、PASS 格 68） | `P5-T26-F-ledger.md`、`feature-baseline.csv` |
| 原型壳 W 探针一键门禁（S1/S1b/S2/S4/T11/T13/T15/T18/T19×3/T20/T21） | **13/13 PASS** | `P5-T26-windows-witnesses.md` |

## 3. 已知限制与缺口（分表；不得写成通过）

### 3.1 已定稿设计限制（不计划修复，行为诚实且可恢复）

| 缺口 | 说明 | 证据/决策 |
| --- | --- | --- |
| W07 **C2-7** corrupt-no-fallback 无自动修复 | 损坏且无可回退版本时自动「修复」等于删除用户数据或猜测内容；产品保留唯一安全路径=用户卸载/重装 + safe mode/notice 提示 | `P5-T26-W07-fault-bridge.md`；定稿为已知限制 |
| W07 **B1-6** 端口耗尽后运行期无自愈 | 故障解除后运行中实例不自动重试，需重启应用（重启可恢复，W 证据覆盖；失败原因已可观测 B1-4） | `P5-T26-W07-fault-boot.md`；定稿为已知限制 |
| W07 **B2-5** 数据目录恢复后运行期无自愈 | 同上（需重启；重启可恢复） | 同上 |

### 3.2 部分通过（已覆盖切片 + 明确剩余，不写成全通过）

| 项 | 已通过部分 | 剩余 |
| --- | --- | --- |
| W01 ZIP 离线包 | U+W 8/8（staging/安装/zip-slip/条目/总量） | **I 门禁未执行**；深层 zip bomb/嵌套压缩未覆盖 |
| W02 表单交接 | title/tags W 8/8 + 迟到请求/旧连接 W 12/12；Core U 6/6 | 公式/重命名草稿、候选启动失败、提交后 UI 同步、IME 组字交接 |
| W04 外部开发 | 外部路径 W 7/7 + SDK 发布形态 W 7/7 + 自检 | npm/tgz 正式发布流程、文档站/示例集/调试工具、发布密钥分发、第二套 UI 全任务覆盖 |
| W05 协议线 | 握手+snapshot W 7/7 | subscribe/断连重放/慢包/超时 queryResult/取消冲突语义 |
| W06 边界 | 网络/worker/WS/越权功能级 W 8/8 | 导航/下载/伪造消息系统化、loopback 白名单、Tauri 升级回归 |
| W07 故障恢复 | 无限循环 8/8 + 内存/CPU 21/21 + boot 43/45 + bridge 45/46 | 见 §3.1 三项已知限制；自然 OOM 未触发（CDP `Page.crash` 注入） |
| W09 性能 | 工坊口径 W 6/6 | 全量预算复跑；**大文档首开慢为产品既有 `@tiptap/markdown` 解析限制（非工坊回归）** |
| F01–F16 guest 原生入口 | 官方 UI 台账 60 PASS/0 FAIL；F03 42/42；参考包 A/B 真实链路 W 24/24 | **guest 原生入口整体覆盖未达成**：静态审计 0 已实现/3 部分/13 未实现；70 行 NOT_RUN |

### 3.3 未执行 / NOT_RUN（阻止 T26 认证与更高状态）

| 项 | 状态 | 说明/证据 |
| --- | --- | --- |
| T27 安装/覆盖升级/降级/回滚/卸载 I 门禁（W08/W03/W01 的 I 证据） | **NOT_RUN**（就绪检查 NOT_READY 6/8） | 候选 `AstraNota_1.2.18_x64-setup.exe` + 28 个历史安装包 + NSIS 齐备；阻塞=未授权 `KE_T27_AUTHORIZED` + 未声明 `KE_T27_ISOLATED_ENV`。见 `T27-gate-readiness.json`、`P5-T26-W08-gate-prep.md`、`T27-I-GATE-RUNBOOK.md` |
| 人工真实系统 IME / 多 DPI / 多显示器 | **NOT_RUN** | CDP 路径 W 7/7 不能替代人工实测；清单 `MANUAL-IME-DPI-CHECKLIST.md` |
| F14 最终导出 PDF 落 Documents | **NOT_RUN** | 导出对话框/A4 预览 PASS；最终落盘因 `%USERPROFILE%` 覆盖会破坏 CDP 隔离而未执行；补充 `preview_pdf` 在隔离 TEMP 真实生成 PDF（不冒充最终导出） |
| F16 OS 级原生菜单交互 | **NOT_RUN** | 仅 `menu.rs` 11 项结构性审计（U/静态）；原生菜单非 DOM，CDP 无法真实点击 |
| F01–F16 guest 逐项覆盖 | **部分/未达成** | 见 §3.2；`reports/F01-F16-COVERAGE.md` 量化审计 |
| 正式发布密钥签发/分发流程 | **NOT_RUN** | ADR-003 实施清单未执行（当前为测试密钥/信任根） |
| T26 任务级最终认证 | **未达成** | A1–A8 W 已齐，但完成定义还含人工 IME/DPI、T27 I 门禁、W 部分类别 |
| `IMPLEMENTED_WINDOWS_PENDING` / `LOCAL_WORKSHOP_RELEASE_CANDIDATE` | **不声明** | 未满足，且未授权发布 |

## 4. 待主理人操作项（不阻塞当前代码交付，但影响最终认证）

| 项 | 需要 | 入口/材料 |
| --- | --- | --- |
| T27 I 门禁（安装/覆盖升级/回滚） | 明确授权 + 云端/专用隔离 Windows VM（可快照）+ `KE_T27_AUTHORIZED=1`/`KE_T27_ISOLATED_ENV` | `reports/T27-CLOUD-EXECUTION-HANDOFF.md`（云端 Codex 执行单）、`reports/T27-I-GATE-RUNBOOK.md`、`reports/T27-ARTIFACTS.md`（28 个安装包 sha256）；**禁止在用户日常机执行** |
| 人工真实 IME/多 DPI 验收 | 本机按清单逐步操作 + 截图记录 | `reports/MANUAL-IME-DPI-CHECKLIST.md`（隔离工作区 `C:\ke-tmp\uiws-manual\workspace`） |
| 推送/发布 | 主理人明确授权 | 当前分支本地，未 push/未 Release |

## 5. 关键复现命令

```bash
# 全量回归（WSL）
cd frontend && npx tsc -b --noEmit && npx vitest run --maxWorkers=2
python3 -m pytest backend/tests -q
# 产品 Rust（Windows）
cd desktop/src-tauri && cargo test --release && cargo build --release
# 平台验证矩阵门禁（跨平台静态汇总）
python3 docs/ui-workshop/tools/build_validation_matrix.py --check     # 59 行 PASS
# 原型 W 门禁（Windows；先构建原型壳）
python docs/ui-workshop/tools/run_all_w_probes.py --check              # 13/13
# 产品 W 代表性探针（Windows；需隔离测试构建 C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe）
python docs/ui-workshop/tools/run_t26_w07_boot_crash_probe.py          # boot 43/45
python docs/ui-workshop/tools/run_t26_w07_bridge_probe.py              # bridge 45/46
python docs/ui-workshop/tools/run_feature_entry_probe.py               # F 台账（71/76 checks）
python docs/ui-workshop/tools/run_reference_packs_probe.py             # G7 24/24
python docs/ui-workshop/tools/run_t27_gate_check.py                    # 就绪检查（只读，NOT_READY 6/8）
```

## 6. 事故与红线记录（必须披露）

- **约束遵守**：分支本地**未推送、未发布 Release**；未用真实用户笔记做测试（全部隔离工作区/APPDATA）；
  工坊入口与 Core 保存分支默认关闭可回退；未把 happy-dom/Linux 结果冒充 W。
- **两次误杀用户 App（已披露并补救）**：① 早期 runner 清理误用 `taskkill /IM knowledgeeditor.exe`；
  ② 一次清理误用 `Stop-Process -Id <用户 PID>`。均即时重启用户 App；红线：**测试进程只按自身 PID
  终止；sidecar 只按测试路径白名单清理；禁止引用/操作 `D:\AstraNota` 用户进程**。
- **数据隔离事故（已补救）**：产品 `data_dir()` 不随 identifier 变化 → 早期 T26 运行只读显示过用户
  最近工作区（无编辑/保存）；已强制全部 runner 注入隔离 `APPDATA` 并清理测试注入条目。
- **诚实性披露**：W07 内存场景 renderer 崩溃为 CDP `Page.crash` **注入**（非自然 OOM，2GB 压力上限）；
  B1-6/B2-5 为**已知设计限制**；G3/G4 打印期间主线程阻塞 → guest 心跳超时临时放宽 8s、PDF 测试输出
  用诊断覆盖（生产路径不变）、公式 NodeView 打印为线性 LaTeX；F14 未执行最终导出（不冒充）。
- **真实产品缺陷修复**：F03 审计发现 Ctrl+Shift+B 引用快捷键被 `KeBlockJoin` 覆盖失效（PRODUCT_FINDING），
  已由 `f4759a2` 修复并 W 复测 6/6；F03 台账 42/42 全 PASS。

## 7. 文档索引与一致性

| 文档 | 用途 |
| --- | --- |
| `reports/FINAL-DELIVERY-STATUS.md`（本文） | 一页式最终交付状态 |
| `HANDOVER-FINAL.md` | 完整交付说明（基线/W 证据/里程碑/风险/NOT_RUN/事故/历史追加记录） |
| `reports/milestone-assessment.md` | ACCEPTANCE A 节里程碑逐项判定 |
| `reports/T26-acceptance-status.md` | Windows 阶段验收状态 + 事故披露 |
| `reports/F01-F16-COVERAGE.md` | F01–F16 guest 入口覆盖量化审计 |
| `reports/T27-*.md` | T27 I 门禁计划/执行手册/云端交接/产物清单 |
| `reports/MANUAL-IME-DPI-CHECKLIST.md` | 人工 IME/多 DPI 验收清单 |
| `validation-matrix.csv` + `tools/build_validation_matrix.py` | 平台验证矩阵（59 行，`--check` 门禁） |
| `feature-baseline.csv` | F01–F16 逐项台账（130 行） |
| `progress.md` | 逐任务台账（含历史表述，最终状态以本文/`HANDOVER-FINAL.md` 为准） |
| `evidence/` | 全部证据（44 个 results JSON + 证据 md） |

**一致性说明**：本文与 `HANDOVER-FINAL.md`、`milestone-assessment.md`、`T26-acceptance-status.md`、
`validation-matrix.csv` 的数字口径一致（矩阵 59 行、frontend 1931/143 files、backend 847、cargo 67）；
矩阵中 W07 boot/bridge 与 F 台账为 `PASS_WITH_FINDINGS`（显式缺口数），未按 FAIL 阻断也未写成全通过。

## 9. 交付一致性自动检查（可复跑）

```bash
python3 docs/ui-workshop/tools/verify_delivery_consistency.py        # 只读，8 项检查
python3 docs/ui-workshop/tools/verify_delivery_consistency.py --write  # 写入 evidence/T26-delivery-consistency.json
```

8 项检查：矩阵 --check PASS、所有 results JSON 已被矩阵收录、交付文档 evidence 引用存在、仓库无测试私钥、
分支本地未推送（无 upstream）、工作树干净、台账 CSV 可解析、最终状态声明 `EXPERIMENTAL_TRUSTED_PACKS`
且不声明更高。**最近一次：8/8 PASS**（evidence/T26-delivery-consistency.json）。

## 10. 云端实机验收任务包

- `reports/CLOUD-VM-VERIFICATION-TASKPACK.md` + `reports/cloud-handoff/`（git bundle `4c71233..feat/ui-workshop`、
  `cloud_build.ps1`、`cloud_verify_installed.py`、`T27-I-results.schema.json`）；一键打包
  `reports/cloud-vm-taskpack.zip`。用途：在云端 Windows VM 执行 T27 I 门禁 + 安装态工坊冒烟，
  回传后由 Lead 登记。

## 11. 证据索引

- `docs/ui-workshop/EVIDENCE-INDEX.md`（自动生成）：矩阵 62 行 → 证据文件/任务/结果/计数/复现命令；
  同时列出 results JSON 缺说明 md、说明 md 未被引用等可维护性提示。

## 12. 参数化无头命令（v12）

- `editor.link.insert`（https/http/mailto 严格校验）/`editor.math.inline|block`（latex 校验、不开对话框）/
  `editor.table.insert`（rows/cols 1–8）接入 guest 命令桥；pack A/B 产品 W **各 36/36 PASS**。
- F 台账：F03 +2 行 pack PASS（link/math.block）→ **packA PASS 26 / packB 27**；F04/F05 域行 PARTIAL
  （仅插入动作面，不伪造全量）。证据 `P5-T26-pack-editor-cmd.md` v12、F 报告附录 O。

## 13. T27 I 门禁云端预检（Linux，非 Windows 验收）

- 用户 Codex 在 **Debian（无 Windows VM）** 完成预检：Linux 预检 PASS（脚本回归 39/39、SHA256 64/64、
  完整 sources.bundle、双前端构建、签名工具/测试 guest 自检）；**Windows U1–U6 + B 段 NOT_RUN/BLOCKED**。
- Codex 审计修正我方交接脚本 6 类真实缺陷（数据丢失掩盖/U3 自动 PASS/缺签名包仍通过/异常不落结果/
  清理范围过宽/构建未固定候选 HEAD），修正版脚本 + 39 项测试纳入 **交接包 v2**。
- **I 门禁仍未通过 → 里程碑保持 `EXPERIMENTAL_TRUSTED_PACKS`**；需专用 Windows VM 执行
  `reports/cloud-handoff/README.md` 流程后回传 `windows-evidence`。证据 `P5-T26-T27-I-gate-preflight.md`。

## 14. 最终结项状态（2026-10-19 夜）

**交付状态 = `EXPERIMENTAL_TRUSTED_PACKS`（TASK PACK 允许状态之一）。**
**T27 I 门禁未执行（NOT_RUN/BLOCKED）**：主理人确认无 Windows VM 环境；Linux 预检 PASS 不能替代 I 证据；
按 `reports/DECISION-T27-I-gate-blocked.md` 决策，**不声明** `IMPLEMENTED_WINDOWS_PENDING` 完成态 /
`LOCAL_WORKSHOP_RELEASE_CANDIDATE`，也不在主理人真实机器上安装/升级/回滚。

- 已完成：UI 工坊实现 + 本机 Windows/WebView2 真实 W 证据（A1–A8、W01–W09、G1–G7、F01–F16 部分）、
  验证矩阵 63 行 PASS、交付一致性 8/8、全部证据/台账/ADR/交接文档；
- 未完成（环境阻塞）：T27 **I 类**安装/升级/回滚证据；F01–F16 guest 原生入口整体覆盖（部分域无受控协议）；
  W07 三项已定稿设计限制（重启/卸载可恢复）；
- 恢复路径：获得 Windows 环境后使用 `reports/cloud-handoff/`（v2）执行并回传 → 复评里程碑。
