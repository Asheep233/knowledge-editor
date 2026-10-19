# P5-T26 W07 扩展证据（v1）：桥接超时 / sidecar 故障 / 原生 Rust 恢复 — 隔离产品 W 21/29（8 个真实缺口）

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建）
- 任务：task-10 / W07 扩展（桥接超时 + sidecar 故障 + 原生 Rust 恢复）
- 工具：`docs/ui-workshop/tools/run_t26_w07_bridge_probe.py`（新增，可复跑；`--scenarios A,B,C1,C2,C3` / `--dry-run`）
- 原始结果：`evidence/T26-W07-bridge-results.json`（29 条 checks + 全量场景原始 metrics/resp）
- 证据类型：**W（真实产品隔离构建进程/协议/数据行为）**
- **v1 覆盖范围**：B（sidecar 故障/自动重启/崩溃耗尽/重启恢复）+ C1/C2/C3（原生 Rust 恢复）。
  **a) 桥接超时本轮未运行**（代码已实现，待第二 commit 增量补测）→ 本文件不宣称桥接超时通过。
- 环境：测试 exe `C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`
  （sha256 `764f191b71d82e3598039c246f340933ab6fd6d1557e4824ac3ad3d7895328fe`，size 15892480，
  mtime 2026-10-19 10:33:12，含 G1–G4/G7，Lead 统一重建；identifier `com.astranota.uiws.e2e` 未变）；
  运行期 repo HEAD `4528897`（branch `feat/ui-workshop`）；Python 3.14.7；用户 App 未运行 → **N/A**。
- 复现（WSL，串行独占窗口）：
  ```bash
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
    \$env:PYTHONIOENCODING='utf-8'; & 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' \
    -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_t26_w07_bridge_probe.py' --scenarios B,C1,C2,C3"
  ```
  （`--dry-run` 只做环境自检；完整运行需串行独占，检测到其它 product 实例会等待且不强杀。）

## 1. 结论（如实口径）

- **场景 B（sidecar 故障）：10 checks，6 PASS / 4 FAIL（4 个真实缺口）。**
  运行中按 PID/路径白名单杀测试 sidecar 后：主进程存活、Rust **2.22s 自动重启**（新 pid 32176 / port 8000、
  `runtime.json` 重写）、UI 状态栏恢复「后端 v」；连续再杀 3 次（共 4 次）后第 4 次触发**「崩溃重启次数耗尽
  （上限 3 次）」**，不再自动拉起且主进程存活；耗尽后 UI 于 10s 健康轮询后显示「后端未连接」；
  **用户重启应用可恢复**（新 backend healthy、工坊包在列、guest 重新启用握手成功、`context.snapshot` 27ms 成功）。
  缺口：**自动重启后 guest 桥接不自动恢复**（`E_INTERNAL: E_SNAPSHOT HTTP 404`，新后端上下文丢失）；
  崩溃瞬间 UI 无错误提示；会话状态不反映后端故障（仍 active）；崩溃耗尽后 `get_runtime_info` 返回陈旧死 pid。
- **场景 C（原生 Rust 恢复）：16 checks，12 PASS / 4 FAIL（4 个真实缺口）。**
  C1（active 损坏 + 可用 previous）：启动 `rollback-corrupt-active`、recovered=true，磁盘 active 回退 v1、
  v1 verify=true、v2 目录保留（回滚非删除）；IPC `workshop_pack_recover` 幂等 `clean/recovered=false`；
  UI「检查/修复全部包」显示「已检查 3 个包」且本包 clean、safeMode 与其它包审计一致。
  C2（active 损坏 + 无回退）：`corrupt-no-fallback` + 全局 safeMode=true；主动检查后 UI 横幅
  「有包无法自动恢复（safe mode）」；单包「修复/恢复」如实返回 `无需恢复（corrupt-no-fallback）`、磁盘仍损坏
  （不假修复）；**恢复路径：UI 卸载 + 重装有效包 + 检查 → safeMode 清除、verify=true、横幅消失**。
  C3（半成品事务）：启动 `cleanup-journal`、recovered=true，`txn.json`/staging/未完成版本 1.1.0 全部清理、
  active v1 verify=true；IPC recover 幂等 `clean`；UI 检查「已检查 3 个包」、本包 clean。
  缺口：启动自动回滚/清理**无用户可见提示**（仅写 recover-status 文件；启动事件 emit 早于前端挂载 → 入口无
  safeMode/回滚标记）；无回退损坏包**不可自动修复**（唯一路径=用户卸载/重装）。
- **安全/隔离：3/3 PASS**（0 进程残留、无 taskkill /IM、用户 App N/A、共享 workshop-packs 未删、
  仅自有 pack id `com.probe.t26bridge*` 且已清理、其它探针包未触碰）。
- **总计：29 checks，21 PASS / 8 FAIL**；8 个 FAIL 全部是**真实缺口**（其中 6 个为「可观测性」缺口、
  1 个桥接恢复缺口、1 个恢复能力缺口），均如实保留、不冒充通过。
- **W07 判定口径**：sidecar 故障的「自动重启 + 用户重启恢复」与原生 recover 三条路径（回滚/安全模式/事务清理）
  **功能性通过**；但 8 个缺口未闭环，且 a) 桥接超时未测 → 本 v1 **只算部分覆盖，不宣称 W07 全通过**。

## 2. 场景 B：运行中杀 sidecar → 自动重启 / 崩溃耗尽 / 重启恢复（10 checks，6 PASS / 4 缺口）

注入：先用签名 guest 包（`com.probe.t26bridge`，capabilities ui.shell/context.read/context.write/print.request，
trusted）启用真实协议线 guest，基线 `context.snapshot` 成功；随后按 **PID + CIM 可执行路径白名单**
（`C:\ke-tmp\uiws-t26\bin\knowledgeeditor-backend.exe`，whitelisted=true）终止测试 sidecar 进程树（父+子 2 进程）。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| B-1 基线：安装/trusted/启用/握手/session active/health ok/snapshot 可用 | PASS | acceptedFeatures=4 能力；session=active；health ok；snapshot 内容=磁盘 |
| B-2 运行中杀测试 sidecar（白名单校验；主进程存活；Rust 记录异常+自动拉起） | PASS | pids [43304,17992] 路径白名单 true；kill ok；主进程存活；日志 `进程异常退出（code=Some(1) signal=None），1s 后自动拉起（第 1/3 次）` |
| B-3 自动重启可观测（新 pid/端口 + runtime 重写 + UI 恢复） | PASS | **2.223s** 后新 backend pid **32176** port **8000**；runtime.json 重写；UI 状态栏「后端 v」恢复 |
| **B-4 [缺口] 崩溃瞬间 UI 有可见错误提示** | **FAIL（缺口）** | kill 后 0.5s body 无「后端未连接/后端服务未连接」等提示（与 kill 前一致，仅后端日志可见）；前端只监听 `ke:runtime-ready`，`ke:sidecar-exited`/`ke:runtime-error` 无监听，健康轮询间隔 10s → 崩溃→重启窗口 UI 无感 |
| **B-5 [缺口] sidecar 故障期间会话状态反映后端异常** | **FAIL（缺口）** | kill 时 `workshop_pack_session_status`：state=**active**、lastError=null（guest 心跳走宿主，后端故障不进入 failed/suspended） |
| **B-6 [缺口] 自动重启后 guest 桥接自动恢复** | **FAIL（真实缺口）** | 重启后 guest `context.snapshot` → `E_INTERNAL: E_SNAPSHOT: HTTP 404`（**14ms**，非超时；原始 resp 见证据 JSON）；新后端内存上下文（ke-default）丢失，guest 桥不会自动重建上下文/重开文档；同类风险适用于宿主 Core 保存桥（未单独验证） |
| B-7 连续杀触发「崩溃重启次数耗尽」（上限 3 次） | PASS | 第 2/3 次分别 2.629s/2.624s 自动重启；第 4 次后日志 `崩溃重启次数耗尽（3 次），不再自动拉起`；backend_pids_after=[]；主进程存活 |
| **B-8 [缺口] 崩溃耗尽后 get_runtime_info 不返回陈旧死 pid** | **FAIL（缺口）** | invoke `get_runtime_info` → ok=true、pid=**48172（已死）**；`runtime.json` 保留同一死 pid（`SidecarState.info` 未清空） |
| B-9 崩溃耗尽后 UI 最终降级可见（≤25s） | PASS | 10s 健康轮询后 body 出现「后端未连接」；期间 guest snapshot 立即 `E_INTERNAL: Failed to fetch`（2ms，连接拒绝非挂死） |
| B-10 恢复路径：用户重启应用 | PASS | 新 pid 42812、health ok；工坊包在列；重新启用 guest ready（4 能力）、`context.snapshot` **27ms** 成功且正文=磁盘 |

## 3. 场景 C1：active 损坏 + 可用 previous → 启动 rollback + IPC/UI 修复（5 checks，4 PASS / 1 缺口）

准备：隔离 workshop-packs 自有 id `com.probe.t26bridge.c1`，v1 有效、v2 资产 sha256 被篡改，state active=2.0.0/previous=1.0.0。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C1-1 启动 recover：rollback-corrupt-active / recovered=true | PASS | 本次新写 status：`action=rollback-corrupt-active, recovered=true`；checked=3、safeMode=false |
| C1-2 一致性：active 回退 v1、verify=true、v2 目录保留 | PASS | state.active=1.0.0 / previous=2.0.0；v1 verify=true；v2 目录仍在（回滚不是删除） |
| C1-3 IPC `workshop_pack_recover` 幂等一致 | PASS | `action=clean, recovered=false`；state 不变 |
| **C1-4 [缺口] 启动自动回滚有用户可见提示** | **FAIL（缺口）** | 启动后 body 无回滚/恢复/safeMode 提示，入口无标记；仅写 `workshop-recover-status.json`（Rust setup 中 emit `workshop://recover-status` 早于前端挂载 → 事件丢失），用户需主动点「检查/修复全部包」才可见 |
| C1-5 UI「检查/修复全部包」可观测且一致 | PASS | 提示「已检查 3 个包」；本包 clean；safeMode=false 与其它包审计一致（pack-a/b 资产完整、未判损坏） |

## 4. 场景 C2：active 损坏 + 无回退 → safeMode + UI 修复/卸载重装恢复（6 checks，4 PASS / 2 缺口）

准备：`com.probe.t26bridge.c2` v1 资产篡改、state active=1.0.0/previous=null。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C2-1 启动 recover：corrupt-no-fallback + safeMode=true | PASS | `action=corrupt-no-fallback, recovered=false`；全局 safeMode=**true**；checked=3；主进程存活 |
| **C2-2 [缺口] 启动后工坊入口显示 safeMode 标记** | **FAIL（缺口）** | 启动后 body 无「safe mode」标记（启动事件 emit 早于前端挂载丢失；仅 recover-status 文件/safeMode=true） |
| C2-3 主动「检查/修复全部包」后 UI 横幅可观测 | PASS | 面板提示「已检查 3 个包（存在无法自动恢复的包）」+ 横幅「有包无法自动恢复（safe mode）」 |
| C2-4 单包「修复/恢复」如实返回、不假修复 | PASS | UI 提示「无需恢复（corrupt-no-fallback）」；磁盘仍损坏（verify=false） |
| **C2-5 [缺口] 无回退损坏包可自动修复** | **FAIL（缺口）** | recover 对 corrupt-no-fallback 无修复能力；唯一恢复路径=用户卸载/重装（产品设计限制，如实记录） |
| C2-6 恢复路径：UI 卸载 + 重装有效包 + 检查 | PASS | 提示「已卸载 …c2」；安装有效包 ok；「已检查 3 个包」；safeMode=false、verify=true、横幅消失 |

## 5. 场景 C3：半成品事务（txn/journal）→ 启动 cleanup-journal + IPC/UI 一致（5 checks，4 PASS / 1 缺口）

准备：`com.probe.t26bridge.c3` v1 有效，另造 `txn.json`（op=install 1.1.0 + staging 目录）+ 未完成版本目录 1.1.0。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C3-1 启动 recover：cleanup-journal / recovered=true | PASS | `action=cleanup-journal, recovered=true`；safeMode=false（与其它包审计一致）；checked=3 |
| C3-2 一致性：txn/staging/未完成版本清理、active v1 verify=true | PASS | txn_gone/staging_gone/partial_gone 均 true；active=1.0.0；v1 verify=true |
| C3-3 IPC `workshop_pack_recover` 幂等 | PASS | `action=clean, recovered=false` |
| C3-4 UI「检查/修复全部包」可观测且一致 | PASS | 提示「已检查 3 个包」；本包 clean；safeMode=false |
| **C3-5 [缺口] 启动自动清理半成品有用户可见提示** | **FAIL（缺口）** | 启动后 body 无清理/恢复提示（同 C1-4 事件时序问题） |

## 6. 缺口清单（8 项，按影响排序）

| # | 缺口 | 场景 | 影响 | 建议（不在本任务改动范围） |
| --- | --- | --- | --- | --- |
| 1 | **sidecar 自动重启后上下文丢失、guest 桥接不自动恢复**（`E_SNAPSHOT HTTP 404`，14ms） | B-6 | 崩溃→自动重启后 guest 读/写/打印会持续失败，直到前端重建上下文/重开文档；宿主 Core 保存桥同类风险 | Rust 重启成功后通知前端重建上下文（或页面监听 `ke:runtime-ready` 重新 resolve context） |
| 2 | 崩溃瞬间 UI 无任何错误提示（仅后端日志） | B-4 | 用户无感知（10s 内自动恢复时更难察觉；若恢复失败才在轮询后显示「后端未连接」） | 前端监听 `ke:sidecar-exited`/`ke:runtime-error` 显示短提示；恢复后清除 |
| 3 | 会话状态不反映后端故障（kill 时仍 active） | B-5 | 工坊/自动化无法据 session 状态判断后端不可用 | 后端故障时由宿主将会话置 suspended/failed（或在 session_status 暴露 backendHealth） |
| 4 | 崩溃耗尽后 `get_runtime_info`/`runtime.json` 返回陈旧死 pid | B-8 | 诊断/自动化读到失效信息，可能误判后端可用 | 终止时清空 `SidecarState.info` 并删除/标记 runtime.json |
| 5 | 启动 recover 结果（回滚/safeMode/事务清理）无 UI 提示 | C1-4/C2-2/C3-5 | 用户不知道发生过自动回滚/进入过 safeMode，也不知道半成品被清理；只能主动点「检查/修复全部包」 | 前端挂载后主动读取 `workshop-recover-status.json`（或事件重放/持久化标记） |
| 6 | 无回退损坏包不可自动修复（corrupt-no-fallback） | C2-5 | 只能用户卸载/重装；UI 已提供该路径，行为诚实 | 可考虑 UI 直接引导「卸载/重装」流程（产品增强，非缺陷修复） |
| 7 | （覆盖缺口，非产品缺陷）a) 桥接超时本轮未运行 | — | 桥接超时/sidecar 挂起下 guest 请求失败语义、UI 响应、恢复未实测 | 第二 commit 增量 `--scenarios A` 补测（代码已实现） |
| 8 | （引用既有）boot crash 4 缺口 | 已有证据 | 孤儿 sidecar/端口静默/无运行期自愈等 | 见 `P5-T26-W07-fault-boot.md` |

## 7. 覆盖边界 / 未覆盖 / 运行披露（不夸大）

1. **v1 未覆盖 a) 桥接超时**：代码已实现（`NtSuspendProcess` 挂起测试 sidecar 进程树 + guest 并发
   `context.snapshot`/`print.snapshot`，验证宿主 fetch 15s AbortController 超时语义/UI 响应/恢复），
   本轮 GO 窗口按 Lead 指示先交 B+C，**未运行、不得视为已测**；第二 commit 增量补测。
2. **真实磁盘故障/断电未覆盖**：C 场景为隔离目录中构造的损坏 pack/txn 半成品（可重复、可清理）。
3. **host Core 保存桥**在 sidecar 重启后的行为未单独验证（与 B-6 同类上下文丢失风险，按代码推断需重建上下文，
   未做 W 实测，不在本文件下结论）。
4. **打印真实管线**未在桥接超时场景下验证（v1 未跑 A；`print.snapshot` 失败路径已在第一轮混合运行观察到
   `E_INTERNAL`，但该轮作废，不作为证据）。
5. **运行披露（严格串行）**：本轮为 GO 窗口内**第 3 次完整运行（正式证据）**。
   - 第 1 轮（GO 前，13:23–13:26）：与 F 台账探针并发交错（CDP `WinError 10053`、实例被外部清理、场景中断）→
     **整体作废丢弃**（当时为「空闲即插入」策略，已按 Lead 指示改为严格等 GO）。
   - 第 2 轮（GO 窗口内，独占）：20/29，B-10 因**探针侧** enable 时序缺陷（包列表异步加载/tier 未刷新即启用）FAIL；
     修正 `enable_guest`（等列表渲染 + 等 `信任：trusted` + 失败诊断）后本轮 B-10 PASS。
   - **B-6（重启后上下文丢失）在修正前后两轮均复现**，非探针缺陷；其余缺口同样在两轮一致。
6. **共享资源**：共享 `%APPDATA%\Roaming\com.astranota.uiws.e2e\workshop-packs` 中存在其它探针合法包
   （`com.astranota.examples.pack-a/b`，F 台账探针安装；本探针 keyring 下签名显示 invalid，但资产完整、审计未判损坏）。
   本探针**未卸载/修改/删除它们**，safeMode 期望值按「本包预期 OR 其它包损坏审计」动态计算；
   自有 pack id `com.probe.t26bridge*` 运行后已清理。
7. **红线合规**：只启动隔离测试构建；APPDATA/KE_WORKSPACE/KE_APP_CONFIG_LEGACY 隔离；CDP 端口 10410+ 轮换；
   杀/挂起 sidecar 前用 CIM 校验 PID 属于自身进程树且路径在
   `C:\ke-tmp\uiws-t26\bin\*` / `F:\Work\Dev\cargo-target\*` 白名单；**无 taskkill /IM**；
   未触碰 `D:\AstraNota*` 用户实例（用户 App 未运行，N/A）。

## 8. 判定

- **sidecar 故障恢复**：自动重启（2.22s、≤3 次上限）+ 耗尽后停止 + 用户重启恢复 **功能通过**；
  4 个缺口（桥接上下文恢复、UI 提示、session 状态、stale runtime info）如实记录。
- **原生 Rust 恢复**：rollback-corrupt-active / corrupt-no-fallback+safeMode / cleanup-journal 三条启动恢复路径
  **功能与数据一致性通过**；IPC/UI「检查/修复、修复/恢复、卸载重装」路径通过；4 个可观测性/恢复能力缺口如实记录。
- **W07 整体**：本 v1 为**部分覆盖（B+C）且 PASS-with-gaps**；a) 桥接超时待第二 commit 补测。
  不改变 `EXPERIMENTAL_TRUSTED_PACKS` 里程碑结论；缺口交由 Lead/docs-consolidator 汇总。
