# P5-T26 W07 扩展证据（v3，修复后复测）：桥接超时 / sidecar 故障 / 原生 Rust 恢复 — 隔离产品 W 32/39（7 个未闭环缺口）

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建）
- 任务：task-10（W07 扩展）+ task-12（B-6/A-10 修复后产品 W 复测）
- 工具：`docs/ui-workshop/tools/run_t26_w07_bridge_probe.py`（可复跑；`--scenarios A,B,C1,C2,C3` / `--scenarios B --merge` / `--scenarios A --merge` / `--dry-run`）
- 原始结果：`evidence/T26-W07-bridge-results.json`（39 条 checks + 全量 metrics/resp；含 `build_history`/`merged_runs`/`retest` 记录）
- 证据类型：**W（真实产品隔离构建进程/协议/数据行为）**

## 0. 构建与修复历史（重要：本文件为「修复后复测」版本）

| 阶段 | 测试构建 | 说明 |
| --- | --- | --- |
| v1/v2 证据（修复前） | sha256 `764f191b71d82e3598039c246f340933ab6fd6d1557e4824ac3ad3d7895328fe`，size 15892480，mtime 2026-10-19 10:33:12 | B+C（v1 21/29）+ A 增量（v2；A-10 缺口） |
| **v3 复测（本文件统计）** | sha256 `ef1e4bfc06f0ddfaa2a2f767392a708595312d154b7b31e7864e51b0e2cac89f`，size **15891968**，mtime **2026-10-19 13:59:24** | task-11 修复（commit `443e0a6`）后 Lead 重建；B、A 复测（C1–C3 未复跑，保留修复前构建证据） |

- 修复内容（task-11，commit `443e0a6`）：
  - **B-6**：`ProductBrokerBackend` 的 snapshot/write/print 快照读取统一走 `withGuestContext`；遇上下文失效
    （E_SNAPSHOT HTTP 404/409、E_STALE_CONTEXT、上下文不存在）→ 丢弃缓存绑定、`ensureContext` 重建后**重试一次**；
    仍失败如实抛错/返回 failed（write 重试复用 requestId）。
  - **A-10**：`requestJson` 的 AbortController 超时 → 协议错误 **`E_TIMEOUT`（retryable=true）**，不再是 `E_INTERNAL`。
- 运行期 repo HEAD：task-12 复测时含 `443e0a6`（branch `feat/ui-workshop`）；Python 3.14.7；用户 App 未运行 → **N/A**。
- 复现（WSL，严格串行独占）：
  ```bash
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
    \$env:PYTHONIOENCODING='utf-8'; & 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' \
    -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_t26_w07_bridge_probe.py' --scenarios B,C1,C2,C3"
  # A 增量 / 修复后复测（合并进既有证据）
  ... --scenarios A --merge
  ... --scenarios B --merge
  ```

## 1. 结论（如实口径，修复后）

- **B-6 已闭环（修复前 FAIL → 修复后 PASS）**：杀测试 sidecar → Rust 自动重启后，guest `context.snapshot`
  **42ms 成功**且正文=磁盘（修复前为 `E_INTERNAL: E_SNAPSHOT HTTP 404`，14ms、不恢复）→ 上下文重建重试生效。
- **A-10 已闭环（修复前 FAIL → 修复后 PASS）**：挂起 sidecar 时 guest `context.snapshot`/`print.snapshot` 均
  **15002ms 返回协议 `E_TIMEOUT`、`retryable=true`**、message=`宿主请求超时（POST /api/context/snapshot，15000ms）`
  （修复前为 `E_INTERNAL` / `signal is aborted without reason` / `retryable=false`）→ guest 可按 code 区分超时并重试。
- **场景 A（桥接超时）：10/10 PASS。** 挂起 sidecar 进程树（PID/CIM 路径白名单校验）后并发 context.snapshot/print.snapshot
  如实超时失败（E_TIMEOUT，无假成功/假 token）；阻塞期间宿主 UI 响应（CDP eval 0.4ms）、session=active 未误判；
  `NtResumeProcess` 后 /api/health 与 guest snapshot 恢复；「停用 guest」→ stopped 落盘。
- **场景 B（sidecar 故障）：7/10 PASS / 3 缺口（修复后 B-6、B-10 均 PASS）。** 主进程存活、Rust 2.22s 自动重启
  （新 pid/port、runtime 重写、UI 恢复）、连续 4 次触发「崩溃重启次数耗尽（上限 3 次）」不再拉起、耗尽后 10s 健康轮询
  显示「后端未连接」、用户重启应用恢复（health ok、包在列、guest 重启用、snapshot 成功）。
  **剩余 3 缺口（未闭环）**：B-4 崩溃瞬间 UI 无错误提示、B-5 会话状态不反映后端故障（仍 active）、B-8 崩溃耗尽后
  `get_runtime_info`/`runtime.json` 返回陈旧死 pid。
- **场景 C（原生 Rust 恢复，修复前构建证据，未复跑）：16 checks，12 PASS / 4 缺口。** C1 rollback-corrupt-active、
  C2 corrupt-no-fallback+safeMode（UI 卸载/重装恢复 safeMode 清除）、C3 cleanup-journal 功能与数据一致性通过；
  IPC `workshop_pack_recover` 幂等；缺口：C1-4/C2-2/C3-5 启动 recover 结果无 UI 提示、C2-5 无回退损坏包不可自动修复。
- **安全/隔离：3/3 PASS**（0 进程残留、无 taskkill /IM、用户 App N/A、共享 workshop-packs 未删、仅自有 pack id 且已清理）。
- **最终统计：39 checks，32 PASS / 7 FAIL**；已闭环 2 个历史缺口（B-6、A-10），**剩余 7 个真实缺口**如实保留。
- **W07 判定**：A/B/C 三类故障功能性恢复路径通过，B-6/A-10 修复经验证；剩余 7 缺口 + boot crash 既有 4 缺口
  （见 `P5-T26-W07-fault-boot.md`）→ **PASS-with-gaps（部分通过）**，不宣称全通过。

## 2. 修复前 → 修复后（task-12 复测）

| 检查 | 修复前（构建 764f…） | 修复后（构建 ef1e…） | 结论 |
| --- | --- | --- | --- |
| **W07B-B-6** 自动重启后 guest 桥接恢复 | FAIL：`E_INTERNAL / E_SNAPSHOT: HTTP 404`，14ms，上下文丢失不自动恢复 | **PASS**：context.snapshot **42ms 成功**，正文=磁盘（73 bytes，revision=0） | 缺口闭环 |
| **W07B-A-10** 桥接超时错误码 | FAIL：`E_INTERNAL` / `signal is aborted without reason` / `retryable=false`，15002ms | **PASS**：`E_TIMEOUT` / `retryable=true` / `宿主请求超时（POST /api/context/snapshot，15000ms）`，15002ms | 缺口闭环 |
| W07B-B-4 崩溃瞬间 UI 错误提示 | FAIL（缺口） | FAIL（缺口未修） | 保留 |
| W07B-B-5 session 反映后端故障 | FAIL（缺口） | FAIL（缺口未修） | 保留 |
| W07B-B-8 耗尽后 runtime 信息陈旧 | FAIL（缺口） | FAIL（缺口未修） | 保留 |
| W07B-C1-4/C2-2/C3-5 启动 recover 无 UI 提示 | FAIL（缺口） | 未复跑（C 路径不涉及本次修复） | 保留 |
| W07B-C2-5 no-fallback 不可自动修复 | FAIL（缺口） | 未复跑（同上） | 保留 |

复测附加说明（如实）：
- 首次 B 复测时 **B-10 出现一次探针侧误判 FAIL**：CDP 在页面导航完成前连接 → guest 消息收集器随导航丢失 →
  `ready` 未收集；但 diag 证明 guest 实际已激活（`guest_start.hasSession=true`、session=active）。已在
  `enable_guest` 内于启用前重装收集器后重跑 B → **B-10 PASS**。属探针缺陷，不是产品失败（已在 JSON raw_notes 记录）。
- 复测只跑 B 与 A（修复相关路径）；C1–C3 保留修复前构建的原始 checks/metrics，未混写为新构建结果。

## 3. 场景 A：桥接超时（挂起测试 sidecar 进程树）（10/10 PASS，修复后）

注入：guest 真实协议线启用（签名包 `com.probe.t26bridge`，capabilities ui.shell/context.read/context.write/print.request，
trusted，握手 acceptedFeatures=4）；基线 snapshot 成功后，用 `NtSuspendProcess` 挂起本探针主进程的 sidecar 进程树
（父+子 2 进程；CIM 路径白名单 true），并发发起两个桥接请求。

| 检查 | 结果 | 实测（修复后构建 ef1e…） |
| --- | --- | --- |
| A-1 隔离实例 + 签名包安装/trusted/启用/握手 | PASS | ready acceptedFeatures=4；hostVersion=product-guest-host |
| A-2 基线 context.snapshot 成功且正文=磁盘 | PASS | 35ms；revision=0；contentLen=73 |
| A-3 故障注入有效（挂起 sidecar、主进程存活、白名单） | PASS | pids [41264,13068] 白名单 true；NtSuspendProcess status=0；探针侧 /api/health 超时≥1.5s；主进程存活 |
| A-4 context.snapshot 如实超时失败 | PASS | ok=false、**15002ms**、errorCode=**E_TIMEOUT**、retryable=true、`宿主请求超时（POST /api/context/snapshot，15000ms）` |
| A-5 print.snapshot 如实超时失败（无假 pdfToken） | PASS | ok=false、**15001ms**、E_TIMEOUT、retryable=true、无 pdfToken |
| A-6 阻塞期间宿主 UI 仍响应 | PASS | CDP eval 2 次均 **0.4ms**；body 626 字符、工坊/工作区文本完整 |
| A-7 会话状态可观测且未误判 | PASS | state=active（心跳继续，未 failed/suspended） |
| A-8 resume 后桥接恢复 | PASS | /api/health ok（13ms）；guest context.snapshot 再次成功 |
| A-9 可停用恢复 | PASS | 「停用 guest」→ state=stopped 且落盘 workshop-session-status.json |
| **A-10 桥接超时错误码为 E_TIMEOUT/retryable=true** | **PASS（修复后）** | errorCode=**E_TIMEOUT**、retryable=**true**（修复前 E_INTERNAL/false → 已闭环） |

## 4. 场景 B：运行中杀 sidecar → 自动重启 / 崩溃耗尽 / 重启恢复（7/10 PASS，修复后）

注入：guest 真实协议线启用后，按 **PID + CIM 可执行路径白名单** 终止测试 sidecar 进程树（父+子 2 进程）。

| 检查 | 结果 | 实测（修复后构建 ef1e…） |
| --- | --- | --- |
| B-1 基线：安装/trusted/启用/session active/health ok/snapshot 可用 | PASS | acceptedFeatures=4；session=active；health ok；snapshot=磁盘 |
| B-2 运行中杀测试 sidecar（白名单校验/主进程存活/Rust 记录） | PASS | pids [28308,46096] 白名单 true；主进程存活；日志 `进程异常退出（code=Some(1) signal=None），1s 后自动拉起（第 1/3 次）` |
| B-3 自动重启可观测（新 pid/端口 + runtime 重写 + UI 恢复） | PASS | **2.224s** 后新 backend pid 44984 / port 8000；runtime.json 重写；UI「后端 v」恢复 |
| **B-4 [缺口] 崩溃瞬间 UI 有可见错误提示** | **FAIL（缺口未修）** | kill 后 0.5s body 无错误提示；前端只监听 `ke:runtime-ready`、健康轮询 10s → 崩溃→重启窗口 UI 无感 |
| **B-5 [缺口] sidecar 故障期间会话状态反映后端异常** | **FAIL（缺口未修）** | kill 时 session state=**active**、lastError=null |
| **B-6 自动重启后 guest 桥接恢复** | **PASS（修复后）** | 重启后 snapshot **42ms 成功**、正文=磁盘（修复前 E_SNAPSHOT HTTP 404 不恢复） |
| B-7 连续杀触发「崩溃重启次数耗尽」（上限 3 次） | PASS | 第 2/3 次 2.626s/2.624s 自动重启；第 4 次日志「崩溃重启次数耗尽（3 次），不再自动拉起」；主进程存活 |
| **B-8 [缺口] 崩溃耗尽后 get_runtime_info 不返回陈旧死 pid** | **FAIL（缺口未修）** | get_runtime_info ok=true、pid=**50684（已死）**；runtime.json 保留死 pid |
| B-9 崩溃耗尽后 UI 最终降级可见（≤25s） | PASS | 10s 健康轮询后 body「后端未连接」；期间 guest snapshot `E_INTERNAL: Failed to fetch`（连接拒绝非挂死） |
| B-10 恢复路径：用户重启应用 | PASS | 新 pid 20212、health ok；包在列；guest 重启用 ready；snapshot 成功（修复后复测；首次因探针收集器竞态误判，已修正重跑） |

## 5. 场景 C1：active 损坏 + 可用 previous → 启动 rollback + IPC/UI 修复（5 checks，4 PASS / 1 缺口；修复前构建 764f…）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C1-1 启动 recover：rollback-corrupt-active / recovered=true | PASS | 本次新写：`action=rollback-corrupt-active, recovered=true`；checked=3、safeMode=false |
| C1-2 一致性：active 回退 v1、verify=true、v2 目录保留 | PASS | state.active=1.0.0 / previous=2.0.0；v1 verify=true；v2 目录仍在 |
| C1-3 IPC `workshop_pack_recover` 幂等一致 | PASS | `action=clean, recovered=false`；state 不变 |
| **C1-4 [缺口] 启动自动回滚有用户可见提示** | **FAIL（缺口）** | 启动后 body 无回滚/恢复/safeMode 提示；仅写 recover-status 文件（启动事件 emit 早于前端挂载丢失） |
| C1-5 UI「检查/修复全部包」可观测且一致 | PASS | 「已检查 3 个包」；本包 clean；safeMode=false 与其它包审计一致 |

## 6. 场景 C2：active 损坏 + 无回退 → safeMode + UI 修复/卸载重装恢复（6 checks，4 PASS / 2 缺口；修复前构建 764f…）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C2-1 启动 recover：corrupt-no-fallback + safeMode=true | PASS | `action=corrupt-no-fallback, recovered=false`；全局 safeMode=**true**；checked=3 |
| **C2-2 [缺口] 启动后工坊入口显示 safeMode 标记** | **FAIL（缺口）** | 启动后 body 无「safe mode」标记（启动事件早于前端挂载丢失） |
| C2-3 主动「检查/修复全部包」后 UI 横幅可观测 | PASS | 「已检查 3 个包（存在无法自动恢复的包）」+ 横幅「有包无法自动恢复（safe mode）」 |
| C2-4 单包「修复/恢复」如实返回、不假修复 | PASS | 「无需恢复（corrupt-no-fallback）」；磁盘仍损坏 |
| **C2-5 [缺口] 无回退损坏包可自动修复** | **FAIL（缺口）** | recover 无修复能力；唯一恢复路径=用户卸载/重装 |
| C2-6 恢复路径：UI 卸载 + 重装有效包 + 检查 | PASS | 「已卸载 …c2」；安装 ok；「已检查 3 个包」；safeMode=false、verify=true、横幅消失 |

## 7. 场景 C3：半成品事务（txn/journal）→ 启动 cleanup-journal + IPC/UI 一致（5 checks，4 PASS / 1 缺口；修复前构建 764f…）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C3-1 启动 recover：cleanup-journal / recovered=true | PASS | `action=cleanup-journal, recovered=true`；safeMode=false；checked=3 |
| C3-2 一致性：txn/staging/未完成版本清理、active v1 verify=true | PASS | 全部清理，active=1.0.0、verify=true |
| C3-3 IPC `workshop_pack_recover` 幂等 | PASS | `action=clean, recovered=false` |
| C3-4 UI「检查/修复全部包」可观测且一致 | PASS | 「已检查 3 个包」；本包 clean；safeMode=false |
| **C3-5 [缺口] 启动自动清理半成品有用户可见提示** | **FAIL（缺口）** | 启动后 body 无清理/恢复提示（同 C1-4 事件时序问题） |

## 8. 缺口清单（修复后：7 个未闭环 + 2 个已闭环）

**已闭环（task-11 修复 + task-12 产品 W 复测 PASS）**

| 缺口 | 修复前 | 修复后 |
| --- | --- | --- |
| B-6 sidecar 自动重启后上下文丢失、桥接不恢复 | `E_INTERNAL: E_SNAPSHOT HTTP 404`（14ms） | context.snapshot 42ms 成功、正文=磁盘 |
| A-10 桥接超时映射 E_INTERNAL（不可区分） | `E_INTERNAL` / retryable=false / signal aborted | `E_TIMEOUT` / retryable=true / 宿主请求超时（15000ms） |

**未闭环（7 项，按影响排序）**

| # | 缺口 | 场景 | 影响 | 建议（不在本任务改动范围） |
| --- | --- | --- | --- | --- |
| 1 | 崩溃瞬间 UI 无任何错误提示（仅后端日志） | B-4 | 用户无感知（10s 内自动恢复时更难察觉；恢复失败才在轮询后显示「后端未连接」） | 前端监听 `ke:sidecar-exited`/`ke:runtime-error` 显示短提示；恢复后清除 |
| 2 | 会话状态不反映后端故障（kill 时仍 active） | B-5 | 工坊/自动化无法据 session 状态判断后端不可用 | 后端故障时宿主置会话 suspended/failed，或在 session_status 暴露 backendHealth |
| 3 | 崩溃耗尽后 `get_runtime_info`/`runtime.json` 返回陈旧死 pid | B-8 | 诊断/自动化读到失效信息，可能误判后端可用 | 终止时清空 `SidecarState.info` 并标记/删除 runtime.json |
| 4 | 启动 recover 结果（回滚/safeMode/事务清理）无 UI 提示 | C1-4/C2-2/C3-5 | 用户不知道发生过自动回滚/进入过 safeMode/半成品被清理 | 前端挂载后主动读取 `workshop-recover-status.json`（或事件重放/持久化标记） |
| 5 | 无回退损坏包不可自动修复（corrupt-no-fallback） | C2-5 | 只能用户卸载/重装；UI 已提供该路径，行为诚实 | 可考虑 UI 直接引导「卸载/重装」（产品增强，非缺陷修复） |
| 6 | （引用既有证据）boot crash 4 缺口：孤儿 sidecar / 端口耗尽静默 / 无运行期自愈×2 | boot crash | 见 `P5-T26-W07-fault-boot.md` | — |
| 7 | （覆盖提示）宿主 Core 保存桥在 sidecar 重启后的行为未单独 W 实测（与 B-6 同根因；B-6 修复路径覆盖 guest 侧） | — | 按代码推断需重建上下文 | 可后续补探针 |

## 9. 覆盖边界 / 未覆盖 / 运行披露（不夸大）

1. **A 场景超时注入方式**：`NtSuspendProcess` 挂起测试 sidecar 进程树（不是杀进程/占端口），覆盖宿主 15s fetch 超时路径；
   不覆盖「TCP 连接被拒/网络不可达」（B 场景 kill 后 `Failed to fetch` 已覆盖）。
2. **C1–C3 未在修复后构建上复跑**：task-11 改动仅涉及 guest 桥接上下文重试与超时映射，不涉及 pack recover 路径；
   保留修复前构建（764f…）的原始 checks/metrics，不混写为新构建结果（JSON `build_history`/`run_conditions.retest_scope` 已记录）。
3. **真实磁盘故障/断电未覆盖**：C 场景为隔离目录中构造的损坏 pack/txn 半成品（可重复、可清理）。
4. **宿主 Core 保存桥**在 sidecar 重启后的行为未单独 W 实测（B-6 修复覆盖 guest 桥接读取路径）。
5. **打印真实管线**在桥接超时下只验证到「快照读取超时失败、不返回假 token」；真实 PrintToPdf 阶段未在超时场景覆盖（G3/G4 已有独立证据）。
6. **运行披露（严格串行）**：三段时间线：
   - v1（第一 GO 窗口，B+C，构建 764f…）：GO 前与 F 台账探针并发交错一轮**作废丢弃**；窗口内首轮 B-10 因探针 enable 时序缺陷
     修正后 PASS；第 3 次完整运行为 v1 正式证据（21/29）。
   - v2（第二 GO 窗口，A 增量，构建 764f…）：9/10，A-10 为缺口，`--merge` 并入本 JSON。
   - v3（task-12 复测窗口，构建 ef1e…）：B 复测 + A 复测（`--merge`）；B-6/A-10 均 PASS；B-10 首测因**探针侧**收集器竞态误判，
     修正后重跑 PASS（非产品失败）；C1–C3 未复跑。本文件统计为 v3 复测后的最终值。
7. **共享资源**：共享 `%APPDATA%\Roaming\com.astranota.uiws.e2e\workshop-packs` 中此前存在其它探针合法包
   （`com.astranota.examples.pack-a/b`，F 台账探针安装）；本探针未卸载/修改/删除它们，safeMode 期望按「本包预期 OR 其它包损坏审计」
   动态计算；自有 pack id `com.probe.t26bridge*` 运行后已清理。
8. **红线合规**：只启动隔离测试构建；APPDATA/KE_WORKSPACE/KE_APP_CONFIG_LEGACY 隔离；CDP 端口 10410+ 每次 launch 轮换；
   杀/挂起 sidecar 前用 CIM 校验 PID 属于自身进程树且路径在
   `C:\ke-tmp\uiws-t26\bin\*` / `F:\Work\Dev\cargo-target\*` 白名单；**无 taskkill /IM**；
   未触碰 `D:\AstraNota*` 用户实例（用户 App 未运行，N/A）。

## 10. 判定（修复后）

- **B-6 / A-10：修复验证通过（产品 W 复测）** → 从缺口清单移入「已闭环」。
- **场景 A（桥接超时）**：10/10 PASS（超时如实 E_TIMEOUT、UI 不阻塞、resume 恢复、可停用）。
- **场景 B（sidecar 故障）**：7/10 PASS（自动重启/耗尽停止/用户重启恢复 + B-6 修复），剩余 B-4/B-5/B-8 可观测性缺口。
- **场景 C（原生 Rust 恢复）**：12/16 PASS（未复跑，修复前构建证据），4 个可观测性/恢复能力缺口保留。
- **W07 整体**：A/B/C + boot crash 类别均已覆盖；**PASS-with-gaps（部分通过）**，剩余 7 + 4 缺口如实保留、不宣称全通过；
  不改变 `EXPERIMENTAL_TRUSTED_PACKS` 里程碑结论。缺口交由 Lead/docs-consolidator 汇总。
