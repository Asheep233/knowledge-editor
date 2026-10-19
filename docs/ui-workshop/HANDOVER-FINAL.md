# UI 工坊最终交接（最终交付状态 · 2026-10-19）

> 本文是 **UI 创意工坊任务的最终交付状态文档**。完整阶段记录见 `HANDOVER.md`（阶段快照，数字已过时）、
> `reports/SESSION-FINAL-SUMMARY.md`；逐任务台账见 `progress.md`；里程碑判定见
> `reports/milestone-assessment.md`；一页式状态表见 `reports/FINAL-DELIVERY-STATUS.md`。
> **分支：`feat/ui-workshop`（本地分支，未推送、未发布 Release）。**
> **项目里程碑：`EXPERIMENTAL_TRUSTED_PACKS`（ACCEPTANCE A 节口径）；不声明更高状态。**
> **T26 任务级最终认证：未达成**（A1–A8 W 证据已齐，但仍缺人工真实 IME/多 DPI、T27 安装升级
> I 门禁与 W 部分类别——详见 §3、§5）。

## 1. 代码与回归基线

- 分支：`feat/ui-workshop`，基线 v1.2.18 `4c71233` + overlay `e54d37b`；交付整理提交见
  `git log --oneline -1`（本文件所在提交）；
- 最近一次全量回归（2026-10-19 交付整理时复跑/核对）：

| 套件 | 结果 | 说明 |
| --- | --- | --- |
| frontend `tsc -b --noEmit` | **0 错** | WSL |
| frontend `vitest run --maxWorkers=2` | **134 files / 1819 passed + 1 skipped** | WSL/happy-dom（U 级） |
| backend `pytest backend/tests -q` | **847 collected / exit 0** | WSL；Windows Py3.10 曾全绿 |
| 产品壳 `cargo test --release` | **50 passed** | Windows（Rust 单测） |
| 原型 W 探针一键门禁 | **13/13 PASS** | `run_all_w_probes.py --check`（Windows/WebView2） |
| 平台验证矩阵 | **51 行**，`--check` **PASS**（含 T27 就绪检查 READINESS 行，显式 NOT_READY、非验收通过） | `build_validation_matrix.py --check` |

> 核对口径：frontend（tsc 0、134 files/1819 passed + 1 skipped）与 backend（847 collected/exit 0）在
> 交付整理时本地复跑确认；产品 cargo 50、原型 W 13/13 引自 `P6-final-verification.md` 与
> `P5-T26-windows-witnesses.md`（Windows 侧本次交付整理未复跑，数字为最近一次记录）。

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
| W04 外部开发者路径：脚手架→外部签名→产品安装→启用（无需改宿主源码） | **W 7/7 + 脚手架自检 5/5** | `P5-T26-W04-sdk.md`、`W04-scaffold-selftest.json` |
| W04 SDK 发布形态：独立 `docs/ui-workshop/sdk/` dist（iife+ESM）→ autoConnect 握手/真实 snapshot | **W 7/7 + SDK 自检 4/4** | `P5-T26-W04-sdk-dist.md` |
| W05 产品 guest 协议线：Broker/Dispatcher↔SDK 握手 + context.snapshot | **W 7/7** | `P5-T26-W05-protocol.md` |
| W06 guest 执行/网络边界：fetch 相对/loopback/外部阻断、worker 不执行、WS 不连接、越权 E_CAPABILITY | **W 8/8（功能级）** | `P5-T26-W06-boundary.md` |
| W07 guest 无限循环故障：宿主不阻塞/心跳 suspended→failed+safeMode/停用持久化 | **W 8/8（无限循环类别）** | `P5-T26-W07-fault.md` |
| W07 扩展故障类别：guest 内存压力（2048MB/宿主 IPC max 3.6ms/注入崩溃检出 1.0s）+ CPU 压力（≈0.80 core/长任务饥饿 1.6s 检出） | **W 21/21（内存 11/11 + CPU 10/10，部分）** | `P5-T26-W07-fault-mem.md` |
| W09 性能（工坊口径）：无双编辑器/无逐字符广播/无持续泄漏 | **W 6/6 PASS** | `P5-T26-W09-workshop.md` |
| W09 大文档首开性能（产品既有 `@tiptap/markdown` 解析限制） | **记录 FAIL（已知限制，非工坊回归）** | `P5-T26-W09-perf.md`、`-diag`、`-plain` |
| 原型壳 W 探针一键门禁（S1/S1b/S2/S4/T11/T13/T15/T18/T19×3/T20/T21） | **13/13 PASS** | `P5-T26-windows-witnesses.md` |

### 2.3 T27 / W08 I 门禁（只读就绪检查，**不是 I 通过**）

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| T27 安装/覆盖升级 I 门禁就绪 dry-run（只读，不安装） | **NOT_READY 6/8**：候选 1.2.18 安装包 + 28 个历史安装包 + NSIS 配置齐备；阻塞=未授权 `KE_T27_AUTHORIZED` + 未声明 `KE_T27_ISOLATED_ENV` | `P5-T26-W08-gate-prep.md`、`T27-gate-readiness.json` |
| W08 覆盖升级/降级/兼容 I 证据 | **NOT_RUN** | 计划：`reports/T27-installer-upgrade-plan.md` |

## 3. 里程碑判定（ACCEPTANCE A 节）

- **当前里程碑：`EXPERIMENTAL_TRUSTED_PACKS`**（受信实验包可用；隔离、离线限制或恢复仍有未通过项）。
  判定依据：只允许受信包（信任等级强制/验签/撤销/TrustStore/信任 UI 已有产品 W 证据）；隔离
  （独立 origin 成立但 `__TAURI_INTERNALS__` 可见、invoke 实测 timeout → 残余风险）；离线
  （ZIP 离线包功能级 W，但更深攻击面与 I 门禁未做）；恢复（启动 recover/safeMode 产品 W，但
  W03/W07 I 恢复门禁未做）。
- **不声明**：`IMPLEMENTED_WINDOWS_PENDING` 完成态、`LOCAL_WORKSHOP_RELEASE_CANDIDATE`。
- **T26 任务级最终认证：未达成**。A1–A8 已有真实产品壳 W 证据（见 §2.1），但 T26 完成定义还要求
  人工真实 IME/多 DPI、T27 安装升级/回滚演练、W 门禁全部通过；当前这些未完成（见 §5）。
- 完整逐项核对：`reports/milestone-assessment.md`（W07 行含扩展探针进展）。

## 4. 残余风险（必须随交付说明）

1. **guest 隔离残余风险**：guest 仍可见 `window.__TAURI_INTERNALS__`（跨域 iframe 继承 Tauri 注入，
   不可配置不可移除）；当前实测 `invoke` 无响应（remote IPC 未生效/timeout）→ 当前不可利用但属
   实现细节，Tauri/WebView2 升级可能改变行为。已实现 guest 自检上报 + 宿主残余风险提示；
   Tauri 升级后必须复跑 `run_t26_guest_isolation_probe.py`。见 ADR-004、`P5-T26-A7-isolation.md`；
2. **人工真实系统 IME/多 DPI 未验证**：CDP/WebView2 渲染层路径已过 W 7/7，但不能替代人工输入法
   与多显示器实测；
3. **安装/覆盖升级/回滚 I 证据未执行**：T27 就绪检查 NOT_READY（待主理人授权 + 专用隔离环境）；
   W08/W01 I 门禁仍 NOT_RUN；
4. **W 部分类别**：W02 剩余（公式/重命名草稿、迟到命令、候选启动失败、提交后 UI 同步、IME 交接）、
   W05 剩余（subscribe/断连重放/慢包/超时）、W06 剩余（导航/下载/伪造消息系统化、loopback 白名单、
   Tauri 升级回归）、W07 剩余（boot crash、桥接超时、连续启动失败、原生 Rust 恢复、I 门禁；
   内存场景崩溃为 CDP `Page.crash` 注入、非自然 OOM，2GB 压力上限受同机安全约束）；
5. **W09 大文档首开慢**：产品既有 `@tiptap/markdown` 解析超线性限制（非工坊回归），需产品性能优化；
6. **SDK 正式发布流程缺失**：SDK 以仓库内 dist 形态提供（iife/ESM，`private:true`），npm/tgz
   发布流程、文档站、示例集、发布密钥分发规范未做；
7. **无正式发布密钥流程**：ADR-003 实施清单未执行（当前使用测试密钥/信任根）。

## 5. NOT_RUN / 未完成清单（阻止更高状态）

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| 人工真实系统 IME / 多 DPI | **NOT_RUN** | 需人工中文输入法与多显示器实测 |
| W08 覆盖升级/降级/兼容（I 证据） | **NOT_RUN**（就绪检查 NOT_READY 6/8） | `reports/T27-installer-upgrade-plan.md`；需授权 + 专用环境 |
| W03 包与私有状态回滚（I 门禁） | **NOT_RUN** | Core 有 store/recover（U 级）；I 门禁未做 |
| W01 I 门禁 / 更深 zip 攻击面 | **部分** | U+W 8/8；I 未执行；zip bomb 深层/嵌套未覆盖 |
| W02 表单交接完整语义 | **部分** | title/tags W 8/8；公式/重命名草稿、迟到命令、候选启动失败、UI 同步、IME 交接未做 |
| W04 外部开发者完整路径 | **部分** | 脚手架/签名/安装/启用 W 7/7 + SDK 发布形态 W 7/7 + 自检；npm/tgz 发布流程、文档站/示例集、第二套 UI 全任务未做 |
| W05 协议完整语义 | **部分** | 握手+snapshot W 7/7；subscribe/断连重放/慢包/超时 queryResult 未做 |
| W06 边界完整覆盖 | **部分** | 网络/worker/WS/越权功能级 W 8/8；导航/下载/伪造消息系统化、loopback 白名单、Tauri 升级回归未做 |
| W07 全部故障类别 | **部分** | 无限循环 W 8/8 + 内存压力 W 11/11 + CPU 压力 W 10/10；boot crash、桥接超时、连续启动失败、原生 Rust 恢复、I 门禁未做；自然 OOM 未触发（崩溃为 CDP 注入） |
| W09 全量性能预算 | **部分（工坊口径 PASS）** | 工坊硬指标 W 6/6 PASS；大文档首开为产品既有性能限制，优化后需复跑 |
| F01–F16 全功能基线逐项 guest 覆盖 | **部分** | 官方 UI 基线回归绿；guest 入口全任务覆盖未逐项验证 |
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
| `reports/FINAL-DELIVERY-STATUS.md` | 一页式交付状态（已通过/部分/未通过 + 下一步） |
| `reports/milestone-assessment.md` | 里程碑逐项判定（ACCEPTANCE A 节） |
| `reports/T26-acceptance-status.md` | Windows 阶段验收状态（逐场景 + 未完成项 + 事故） |
| `reports/T27-installer-upgrade-plan.md` | 安装/覆盖升级 I 门禁执行计划（待授权） |
| `validation-matrix.csv` + `tools/build_validation_matrix.py` | 平台验证矩阵（自动生成 + `--check` 门禁） |
| `progress.md` | 逐任务台账（含历史表述与修正记录） |
| `evidence/` | 全部证据（results JSON + 证据 md） |
| `adr/ADR-000..004` | 基线/运行域/保存接线/签名密钥/包宿主决策 |
| `HANDOVER.md`、`reports/SESSION-FINAL-SUMMARY.md` | **阶段快照（数字过时，仅作历史）**，以本文为准 |

**一致性修正记录**（交付整理时发现并修正）：
1. `reports/T26-acceptance-status.md` 旧第 4 节「项目级 P0_READY、不得使用 EXPERIMENTAL_TRUSTED_PACKS」
   与里程碑评估/ACCEPTANCE A 节冲突 → 已按证据修正为 `EXPERIMENTAL_TRUSTED_PACKS`；
2. 旧 A7 隔离核对数字 5/5 → 证据为 **6/6**（`P5-T26-A7-isolation-results.json`），已更正；
3. 矩阵基线 cargo 38 → **50**、工坊 UI 单测 18 → **19**（最新回归证据 + 本地复跑核对）；
4. W09 三份大文档性能结果保持 **KNOWN_FAIL（已知限制）**，未改写为通过。

## 8. 下一步建议（按优先级）

1. **T27 I 门禁**（获得主理人授权 + 专用隔离环境后）：覆盖升级/降级/回滚/中断演练 → 更新 W08/W03/W01 I 状态；
2. **人工真实 IME / 多 DPI** 实测；
3. **W02/W05/W06/W07 剩余类别**：表单完整交接、协议 subscribe/断连、边界系统验证、CPU/内存/boot crash 故障类别；
4. **SDK 正式发布**：npm/tgz 发布流程、文档站/示例集、发布密钥分发规范；
5. **W09 产品性能优化**（大文档首开 `@tiptap/markdown` 解析）后复跑全量 W09；
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
