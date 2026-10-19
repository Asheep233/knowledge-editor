# P5-T26 W07 扩展证据（v4，B-4/B-5/B-8 修复后复测）：桥接超时 / sidecar 故障 / 原生 Rust 恢复 — 隔离产品 W 36/40（4 个未闭环缺口，全部在 C 场景）

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建）
- 任务：task-10（W07 扩展）+ task-12（B-6/A-10 修复后复测）+ task-14（B-4/B-5/B-8 修复后复测）
- 工具：`docs/ui-workshop/tools/run_t26_w07_bridge_probe.py`（可复跑；`--scenarios A,B,C1,C2,C3` / `--scenarios B --merge` / `--scenarios A --merge` / `--dry-run`）
- 原始结果：`evidence/T26-W07-bridge-results.json`（40 条 checks + 全量 metrics/resp；含 `build_history`/`merged_runs`/`retest` 记录）
- 证据类型：**W（真实产品隔离构建进程/协议/数据行为）**

## 0. 构建与修复历史（本文件为「多轮修复后复测」版本）

| 阶段 | 测试构建 | 修复提交 | 说明 |
| --- | --- | --- | --- |
| v1/v2（修复前基线） | `764f191b…`，size 15892480，mtime 10:33:12 | — | B+C（v1 21/29）+ A 增量（v2） |
| v3（task-12 复测） | `ef1e4bfc…`，size 15891968，mtime 13:59:24 | task-11 `443e0a6` | B-6（上下文重建重试）、A-10（超时 → E_TIMEOUT）修复后复测 |
| **v4（task-14 复测；本文件统计）** | `8867595b618ecedcf62ab843bb5e3b489b364e3d544ee94ce173674b2d5dffd4`，size **15907328**，mtime **14:28:21** | task-13 `deed2a7` | B-4（RuntimeHealthBanner）、B-5（guest 会话挂起/恢复）、B-8（stale runtime 清理）修复后复测 |

- 运行期 repo HEAD：v4 复测时含 `deed2a7`（branch `feat/ui-workshop`）；Python 3.14.7；用户 App 未运行 → **N/A**。
- 复现（WSL，严格串行独占）：
  ```bash
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
    \$env:PYTHONIOENCODING='utf-8'; & 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' \
    -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_t26_w07_bridge_probe.py' --scenarios B,C1,C2,C3"
  # A 增量 / 修复后复测（合并进既有证据）
  ... --scenarios A --merge
  ... --scenarios B --merge
  ```

## 1. 结论（如实口径，v4 修复后）

- **B-4 已闭环（FAIL → PASS）**：杀 sidecar 瞬间 App 级 `runtime-health-banner` 可见：
  `data-phase="restarting"`、文案「后端重连中 后端连接中断，正在自动恢复（第 1/3 次）」；自动重启后
  `data-phase="recovered"`（「后端已恢复」）；崩溃耗尽后 `data-phase="degraded"`，文案含真实原因
  「后端已降级：侧车崩溃且自动重启次数已耗尽（可尝试重启应用；日志见设置 → 打开日志目录）」。
- **B-5 已闭环（FAIL → PASS）**：sidecar 故障期间 `workshop_pack_session_status` → `state=suspended`、
  `lastError="E_HOST_UNAVAILABLE: 后端连接中断，正在自动恢复（第 1/3 次）"`（不计 guest 崩溃/不进 safeMode，连接保留）；
  `ke:runtime-ready` 后 → `state=active`、`lastError` 清空（B-5b）。
- **B-8 已闭环（FAIL → PASS）**：sidecar 退出瞬间 `runtime.json` 立即不存在、`get_runtime_info` 返回 Err
  `{"ok":false,"error":"后端尚未就绪"}`；崩溃重启耗尽终态同样无 stale pid、runtime.json 不存在；正常重启成功后重新写入
  新 pid/端口（B-3 PASS）。
- **场景 B：11/11 PASS。**（B-1/B-2/B-3 不变；B-4/B-5/B-5b/B-6/B-8/B-9 复测 PASS；B-7 崩溃耗尽行为不变；B-10 用户重启恢复不变）
- **场景 A：10/10 PASS**（v3 构建 `ef1e4bfc…`，task-12 复测）：挂起 sidecar 时 context.snapshot/print.snapshot 如实
  `E_TIMEOUT`/retryable=true（15002ms）、UI 0.4ms 响应、session=active、resume 恢复、停用 guest→stopped。
- **场景 C（原生 Rust 恢复，修复前构建 `764f191b…`，未复跑）：16 checks，12 PASS / 4 缺口。** C1 rollback-corrupt-active、
  C2 corrupt-no-fallback+safeMode（UI 卸载/重装恢复 safeMode 清除）、C3 cleanup-journal 功能与数据一致性通过；
  IPC `workshop_pack_recover` 幂等；缺口：C1-4/C2-2/C3-5 启动 recover 结果无 UI 提示、C2-5 无回退损坏包不可自动修复。
- **安全/隔离：3/3 PASS。**
- **最终统计：40 checks，36 PASS / 4 FAIL**；已闭环历史缺口 4 个（task-11：B-6、A-10；task-13：B-4、B-5、B-8），
  **剩余 4 个真实缺口全部在 C 场景**（修复后构建未复跑；task-11/13 改动不涉及 pack recover 路径）。
- **W07 判定**：A（桥接超时）、B（sidecar 故障）全部 PASS；C（原生恢复）12/16；叠加 boot crash 既有 4 缺口
  （见 `P5-T26-W07-fault-boot.md`）→ **W07 记为 PASS-with-gaps（部分通过）**，不宣称全通过。

## 2. 修复前 → 修复后（跨两轮修复复测）

### 2.1 task-11 修复（构建 `ef1e4bfc…`）：B-6 / A-10

| 检查 | 修复前（`764f…`） | 修复后（`ef1e…`） | 结论 |
| --- | --- | --- | --- |
| **W07B-B-6** 自动重启后 guest 桥接恢复 | FAIL：`E_INTERNAL / E_SNAPSHOT: HTTP 404`，14ms，不恢复 | **PASS**：context.snapshot **42ms 成功**、正文=磁盘（73B, revision=0） | 缺口闭环 |
| **W07B-A-10** 桥接超时错误码 | FAIL：`E_INTERNAL` / `signal is aborted without reason` / retryable=false，15002ms | **PASS**：`E_TIMEOUT` / retryable=true / `宿主请求超时（POST /api/context/snapshot，15000ms）`，15002ms | 缺口闭环 |

### 2.2 task-13 修复（构建 `8867595b…`）：B-4 / B-5 / B-8

| 检查 | 修复前（`764f…`） | 修复后（`8867595b…`，v4 实测原始值） | 结论 |
| --- | --- | --- | --- |
| **W07B-B-4** 崩溃瞬间 UI 提示 | FAIL：崩溃瞬间 body 无任何错误提示（仅后端日志；前端未监听 sidecar 事件） | **PASS**：banner `data-phase=restarting`，文案「后端重连中后端连接中断，正在自动恢复（第 1/3 次）」（`window.__keRuntimeHealth={attempt:1,maxRestarts:3}`）→ 重启后 `data-phase=recovered`「后端已恢复」 | 缺口闭环 |
| **W07B-B-5** 故障期间会话状态 | FAIL：state=active、lastError=null（不反映后端故障） | **PASS**：state=**suspended**、`lastError="E_HOST_UNAVAILABLE: 后端连接中断，正在自动恢复（第 1/3 次）"`，且落盘 session 状态文件 | 缺口闭环 |
| **W07B-B-5b** 恢复后会话状态 | 修复前无此语义 | **PASS**：`ke:runtime-ready` 后 state=**active**、lastError=**null** | 缺口闭环 |
| **W07B-B-8** 崩溃后 stale runtime | FAIL：get_runtime_info 返回已死 pid、runtime.json 保留死 pid | **PASS**：退出瞬间 runtime.json 即不存在、`get_runtime_info={"ok":false,"error":"后端尚未就绪"}`；崩溃耗尽终态同样无 stale pid；重启成功后重写新 pid | 缺口闭环 |
| W07B-B-9 崩溃耗尽降级可见 | FAIL（修复前仅健康轮询后状态栏「后端未连接」，无真实原因） | **PASS**：banner `data-phase=degraded`，文案「后端已降级：侧车崩溃且自动重启次数已耗尽（可尝试重启应用；日志见设置 → 打开日志目录）」 | 升级为带真实原因 |

复测附加说明（如实）：v4 首轮运行 **B-9 因探针侧断言过严误判 FAIL**（期望子串「崩溃重启次数耗尽」，实际文案
「崩溃且自动重启次数已耗尽」），非产品失败；修正断言后重跑全绿。v3 首轮 B-10 也曾因探针 CDP 收集器竞态误判，均已修。

## 3. 场景 A：桥接超时（挂起测试 sidecar 进程树）（10/10 PASS；构建 v3 `ef1e…`）

注入：guest 真实协议线启用（签名包 `com.probe.t26bridge`，capabilities ui.shell/context.read/context.write/print.request，
trusted）；基线 snapshot 成功后，用 `NtSuspendProcess` 挂起本探针主进程的 sidecar 进程树（父+子 2 进程；CIM 路径白名单
true），并发发起两个桥接请求。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| A-1 隔离实例 + 签名包安装/trusted/启用/握手 | PASS | acceptedFeatures=4；hostVersion=product-guest-host |
| A-2 基线 context.snapshot 成功且正文=磁盘 | PASS | 35ms；revision=0；contentLen=73 |
| A-3 故障注入有效（挂起 sidecar、主进程存活、白名单） | PASS | pids [41264,13068] 白名单 true；NtSuspendProcess status=0；探针侧 /api/health 超时≥1.5s；主进程存活 |
| A-4 context.snapshot 如实超时失败 | PASS | ok=false、**15002ms**、**E_TIMEOUT**、retryable=true、`宿主请求超时（POST /api/context/snapshot，15000ms）` |
| A-5 print.snapshot 如实超时失败（无假 pdfToken） | PASS | ok=false、**15001ms**、E_TIMEOUT、retryable=true、无 pdfToken |
| A-6 阻塞期间宿主 UI 仍响应 | PASS | CDP eval 2 次均 **0.4ms**；body 626 字符、工坊/工作区文本完整 |
| A-7 会话状态可观测且未误判 | PASS | state=active（心跳继续，未 failed/suspended） |
| A-8 resume 后桥接恢复 | PASS | /api/health ok（13ms）；guest context.snapshot 再次成功 |
| A-9 可停用恢复 | PASS | 「停用 guest」→ state=stopped 且落盘 |
| A-10 桥接超时错误码 E_TIMEOUT/retryable=true | PASS | E_TIMEOUT / retryable=true（修复前 E_INTERNAL/false） |

## 4. 场景 B：运行中杀 sidecar → 自动重启 / 崩溃耗尽 / 重启恢复（11/11 PASS；构建 v4 `8867595b…`）

| 检查 | 结果 | 实测（v4 复测） |
| --- | --- | --- |
| B-1 基线：安装/trusted/启用/session active/health ok/snapshot 可用 | PASS | acceptedFeatures=4；session=active；health ok；snapshot=磁盘 |
| B-2 运行中杀测试 sidecar（白名单/主进程存活/Rust 记录） | PASS | pids [14816,4188] 白名单 true；主进程存活；日志「进程异常退出…1s 后自动拉起（第 1/3 次）」 |
| B-3 自动重启可观测（新 pid/端口 + runtime 重写） | PASS | **2.628s** 后新 pid 42352 / port 8000；runtime.json 重写；`get_runtime_info` ok |
| B-4 崩溃瞬间 UI 可见错误提示（banner restarting→recovered） | **PASS（修复后）** | banner restarting「后端重连中…（第 1/3 次）」→ recovered「后端已恢复」 |
| B-5 故障期间会话如实 suspended + E_HOST_UNAVAILABLE | **PASS（修复后）** | state=suspended；lastError=`E_HOST_UNAVAILABLE: 后端连接中断，正在自动恢复（第 1/3 次）` |
| B-5b 恢复后会话 active + lastError 清空 | **PASS（修复后）** | state=active；lastError=null |
| B-6 自动重启后 guest 桥接恢复 | PASS（task-12 已闭环） | context.snapshot **22ms 成功**、正文=磁盘 |
| B-7 连续杀触发「崩溃重启次数耗尽」（上限 3 次） | PASS | 第 2/3 次 2.629s 自动重启；第 4 次后日志「崩溃重启次数耗尽（3 次）不再自动拉起」；主进程存活 |
| B-8 崩溃耗尽后无 stale runtime（runtime.json 不存在/get_runtime_info Err） | **PASS（修复后）** | 退出瞬间即清理；崩溃耗尽后 runtime.json 不存在、get_runtime_info ok=false（后端尚未就绪） |
| B-9 崩溃耗尽后 UI 降级可见（banner degraded + 真实原因） | **PASS（修复后）** | data-phase=degraded；文案含「侧车崩溃且自动重启次数已耗尽」 |
| B-10 恢复路径：用户重启应用 | PASS | 新 pid 31916、health ok；包在列；guest 重启用；snapshot 成功；正常启动 banner 不误报 |

## 5. 场景 C1：active 损坏 + 可用 previous → 启动 rollback + IPC/UI 修复（5 checks，4 PASS / 1 缺口；构建 `764f…`，未复跑）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C1-1 启动 recover：rollback-corrupt-active / recovered=true | PASS | `action=rollback-corrupt-active, recovered=true`；checked=3、safeMode=false |
| C1-2 一致性：active 回退 v1、verify=true、v2 目录保留 | PASS | state.active=1.0.0 / previous=2.0.0；v1 verify=true；v2 目录仍在 |
| C1-3 IPC `workshop_pack_recover` 幂等一致 | PASS | `action=clean, recovered=false`；state 不变 |
| **C1-4 [缺口] 启动自动回滚有用户可见提示** | **FAIL（缺口）** | 启动后 body 无回滚/恢复/safeMode 提示；仅写 recover-status 文件（启动事件 emit 早于前端挂载丢失） |
| C1-5 UI「检查/修复全部包」可观测且一致 | PASS | 「已检查 3 个包」；本包 clean；safeMode=false 与其它包审计一致 |

## 6. 场景 C2：active 损坏 + 无回退 → safeMode + UI 修复/卸载重装恢复（6 checks，4 PASS / 2 缺口；构建 `764f…`，未复跑）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C2-1 启动 recover：corrupt-no-fallback + safeMode=true | PASS | `action=corrupt-no-fallback, recovered=false`；全局 safeMode=**true**；checked=3 |
| **C2-2 [缺口] 启动后工坊入口显示 safeMode 标记** | **FAIL（缺口）** | 启动后 body 无「safe mode」标记（启动事件早于前端挂载丢失） |
| C2-3 主动「检查/修复全部包」后 UI 横幅可观测 | PASS | 「已检查 3 个包（存在无法自动恢复的包）」+ 横幅「有包无法自动恢复（safe mode）」 |
| C2-4 单包「修复/恢复」如实返回、不假修复 | PASS | 「无需恢复（corrupt-no-fallback）」；磁盘仍损坏 |
| **C2-5 [缺口] 无回退损坏包可自动修复** | **FAIL（缺口）** | recover 无修复能力；唯一恢复路径=用户卸载/重装 |
| C2-6 恢复路径：UI 卸载 + 重装有效包 + 检查 | PASS | 「已卸载 …c2」；安装 ok；「已检查 3 个包」；safeMode=false、verify=true、横幅消失 |

## 7. 场景 C3：半成品事务（txn/journal）→ 启动 cleanup-journal + IPC/UI 一致（5 checks，4 PASS / 1 缺口；构建 `764f…`，未复跑）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C3-1 启动 recover：cleanup-journal / recovered=true | PASS | `action=cleanup-journal, recovered=true`；safeMode=false；checked=3 |
| C3-2 一致性：txn/staging/未完成版本清理、active v1 verify=true | PASS | 全部清理，active=1.0.0、verify=true |
| C3-3 IPC `workshop_pack_recover` 幂等 | PASS | `action=clean, recovered=false` |
| C3-4 UI「检查/修复全部包」可观测且一致 | PASS | 「已检查 3 个包」；本包 clean；safeMode=false |
| **C3-5 [缺口] 启动自动清理半成品有用户可见提示** | **FAIL（缺口）** | 启动后 body 无清理/恢复提示（同 C1-4 事件时序问题） |

## 8. 缺口清单（v4：4 个未闭环 + 5 个已闭环）

**已闭环（修复 + 产品 W 复测 PASS）**

| 缺口 | 修复提交 | 复测结果 |
| --- | --- | --- |
| B-6 sidecar 自动重启后上下文丢失、桥接不恢复 | task-11 `443e0a6` | snapshot 42ms 成功、正文=磁盘 |
| A-10 桥接超时映射 E_INTERNAL（不可区分） | task-11 `443e0a6` | E_TIMEOUT / retryable=true / 15000ms |
| B-4 崩溃瞬间 UI 无错误提示 | task-13 `deed2a7` | banner restarting（第 1/3 次）→ recovered |
| B-5 会话状态不反映后端故障 | task-13 `deed2a7` | suspended + E_HOST_UNAVAILABLE → active + lastError 清空（B-5b） |
| B-8 崩溃后 get_runtime_info/runtime.json 返回死 pid | task-13 `deed2a7` | 退出即清 runtime.json；get_runtime_info Err；耗尽终态无 stale pid |

**未闭环（4 项，全部在 C 场景；修复后构建未复跑）**

| # | 缺口 | 场景 | 影响 | 建议（不在本任务改动范围） |
| --- | --- | --- | --- | --- |
| 1 | 启动 recover 结果（回滚/safeMode/事务清理）无 UI 提示 | C1-4/C2-2/C3-5 | 用户不知道发生过自动回滚/进入过 safeMode/半成品被清理 | 前端挂载后主动读取 `workshop-recover-status.json`（或事件重放/持久化标记） |
| 2 | 无回退损坏包不可自动修复（corrupt-no-fallback） | C2-5 | 只能用户卸载/重装；UI 已提供该路径，行为诚实 | 可考虑 UI 直接引导「卸载/重装」（产品增强，非缺陷修复） |
| 3 | （引用既有证据）boot crash 4 缺口：孤儿 sidecar / 端口耗尽静默 / 无运行期自愈×2 | boot crash | 见 `P5-T26-W07-fault-boot.md` | — |
| 4 | （覆盖提示）宿主 Core 保存桥在 sidecar 重启后的行为未单独 W 实测（与 B-6 同根因；已用 B-6/B-5 修复覆盖 guest 侧） | — | 按代码推断需重建上下文 | 可后续补探针 |

## 9. 覆盖边界 / 未覆盖 / 运行披露（不夸大）

1. **A 场景超时注入方式**：`NtSuspendProcess` 挂起测试 sidecar 进程树（不是杀进程/占端口），覆盖宿主 15s fetch 超时路径；
   不覆盖「TCP 连接被拒/网络不可达」（B 场景 kill 后 `Failed to fetch` 已覆盖）。
2. **C1–C3 未在修复后构建上复跑**：task-11（上下文重试/超时映射）、task-13（UI banner/会话挂起/stale runtime 清理）
   均不涉及 pack recover 路径；保留修复前构建（`764f…`）的原始 checks/metrics，不混写为新构建结果。
3. **真实磁盘故障/断电未覆盖**：C 场景为隔离目录中构造的损坏 pack/txn 半成品（可重复、可清理）。
4. **打印真实管线**在桥接超时下只验证到「快照读取超时失败、不返回假 token」；真实 PrintToPdf 阶段未在超时场景覆盖（G3/G4 已有独立证据）。
5. **运行披露（严格串行）**：四段时间线：
   - v1（第一 GO 窗口，B+C，`764f…`）：GO 前与 F 台账探针交错一轮**作废丢弃**；窗口内首轮 B-10 探针 enable 时序缺陷修正后 PASS；
     第 3 次完整运行为 v1 正式证据（21/29）。
   - v2（第二 GO 窗口，A 增量，`764f…`）：9/10（A-10 缺口），`--merge` 并入本 JSON。
   - v3（task-12 复测窗口，`ef1e…`）：B/A 复测；B-6/A-10 PASS；B 首测 B-10 因探针 CDP 收集器竞态误判，修正后重跑 PASS；C 未复跑。
   - v4（task-14 复测窗口，`88675…`）：B 复测；B-4/B-5/B-5b/B-8/B-9 PASS；首轮 B-9 因探针文案子串断言过严误判，
     修正后重跑全绿。本文件统计为 v4 复测后的最终值（40 checks / 36 PASS / 4 FAIL）。
6. **构建混用说明**：environment=`88675…`（v4，B 复测构建）；A 场景=`ef1e…`（v3）；C1–C3=`764f…`（v1/v2，未复跑）；
   JSON `build_history`/`run_conditions.scenario_builds` 均已记录，未把旧结果混写为新构建结果。
7. **共享资源**：共享 `%APPDATA%\Roaming\com.astranota.uiws.e2e\workshop-packs` 中其它探针包（F 台账 pack-a/b）
   本探针未卸载/修改/删除；safeMode 期望按「本包预期 OR 其它包损坏审计」动态计算；自有 pack id `com.probe.t26bridge*` 已清理。
8. **红线合规**：只启动隔离测试构建；APPDATA/KE_WORKSPACE/KE_APP_CONFIG_LEGACY 隔离；CDP 端口 10410+ 每次 launch 轮换；
   杀/挂起 sidecar 前用 CIM 校验 PID 属于自身进程树且路径在
   `C:\ke-tmp\uiws-t26\bin\*` / `F:\Work\Dev\cargo-target\*` 白名单；**无 taskkill /IM**；
   未触碰 `D:\AstraNota*` 用户实例（用户 App 未运行，N/A）。

## 10. 判定（v4 修复后）

- **task-11（B-6/A-10）与 task-13（B-4/B-5/B-8）：修复验证通过（产品 W 复测）** → 5 个历史缺口闭环。
- **场景 A（桥接超时）**：10/10 PASS。
- **场景 B（sidecar 故障）**：**11/11 PASS**（自动重启/崩溃耗尽/用户重启恢复/UI 可观测/会话挂起恢复/stale runtime 清理全部通过）。
- **场景 C（原生 Rust 恢复）**：12/16 PASS（修复前构建证据，未复跑），剩余 4 个可观测性/恢复能力缺口。
- **W07 整体**：A/B/C + boot crash 类别均已覆盖；**PASS-with-gaps（部分通过）**，剩余 C 场景 4 + boot crash 4 缺口如实保留、
  不宣称全通过；不改变 `EXPERIMENTAL_TRUSTED_PACKS` 里程碑结论。缺口交由 Lead/docs-consolidator 汇总。
