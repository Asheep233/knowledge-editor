# P5-T26 W07 扩展证据（v6，C2-3 修复后复测）：桥接超时 / sidecar 故障 / 原生 Rust 恢复 — 隔离产品 W 45/46（1 个未闭环缺口）

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建）
- 任务：task-10（W07 扩展）+ task-12（B-6/A-10 复测）+ task-14（B-4/B-5/B-8 复测）+ task-16（C1-4/C2-2/C3-5 复测）+ task-19（C2-3 复测）
- 工具：`docs/ui-workshop/tools/run_t26_w07_bridge_probe.py`（可复跑；`--scenarios A,B,C1,C2,C3` / `--scenarios B --merge` / `--scenarios C1,C2,C3 --merge` / `--dry-run`）
- 原始结果：`evidence/T26-W07-bridge-results.json`（46 条 checks + 全量 metrics/resp；含 `build_history`/`merged_runs`/`retest` 记录）
- 证据类型：**W（真实产品隔离构建进程/协议/数据行为）**

## 0. 构建与修复历史（本文件为「多轮修复后复测」最终版本）

| 阶段 | 测试构建 | 修复提交 | 说明 |
| --- | --- | --- | --- |
| v1/v2（修复前基线） | `764f191b…`，15892480，10:33:12 | — | B+C（v1 21/29）+ A 增量（v2） |
| v3（task-12 复测） | `ef1e4bfc…`，15891968，13:59:24 | task-11 `443e0a6` | B-6（上下文重建重试）、A-10（超时 → E_TIMEOUT）复测 |
| v4（task-14 复测） | `8867595b…`，15907328，14:28:21 | task-13 `deed2a7` | B-4（RuntimeHealthBanner）、B-5（会话挂起/恢复）、B-8（stale runtime 清理）复测 |
| v5（task-16 复测） | `983688dbc703d6e9195d88f5ef1fd4e81546510bdbdcdcd77685dbd6c185a69e`，size 15900672，mtime 14:49:57 | task-15 `a41d449` | C1-4/C2-2/C3-5：面板启动恢复 notice + safeMode 即时可见复测 |
| **v6（task-19 复测；本文件统计）** | `faa71dfbf5222d63aa3c1b365961055d344ce09fa27cfcadc73e607c0ef75789`，size **15919616**，mtime **15:29:02** | task-18 `a80ec8b`/`b030b25` | C2-3：工坊入口 `workshop-startup-badge` 冷启动角标（只读 startupStatus）；仅复跑 C2，C1/C3 保留 v5 构建证据 |

- 运行期 repo HEAD：v6 复测时含 `a80ec8b`/`b030b25`（branch `feat/ui-workshop`）；Python 3.14.7；用户 App 未运行 → **N/A**。
- 复现（WSL，严格串行独占）：
  ```bash
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
    \$env:PYTHONIOENCODING='utf-8'; & 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' \
    -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_t26_w07_bridge_probe.py' --scenarios C1,C2,C3"
  # B/A/C 增量与修复后复测（合并进既有证据）
  ... --scenarios B --merge
  ... --scenarios A --merge
  ```

## 1. 结论（如实口径，v6 修复后）

- **C2-3 已闭环（FAIL → PASS）**：corrupt-no-fallback + safeMode=true 冷启动时，**未打开工坊面板**入口按钮即显示
  `[data-testid="workshop-startup-badge"]`：文本「启动恢复告警」，`title`/`aria-label`=「启动恢复：存在无法自动恢复的包
  （safe mode）」，入口既有 safe mode 徽标同步；恢复为 clean 状态后重新启动应用 → badge **不显示**（C2-10，不误报）。
- **场景 C2：9/10 PASS**（C2-1…C2-6、C2-8…C2-10 PASS；仅 **C2-7** 无回退损坏包不可自动修复仍为缺口）。
- **场景 A（桥接超时）10/10 PASS、场景 B（sidecar 故障）11/11 PASS**（v3/v4 构建证据）。
- **场景 C1（6/6）、C3（6/6）PASS**（v5 构建证据，本轮未复跑）。
- **安全/隔离 3/3 PASS。**
- **最终统计：46 checks，45 PASS / 1 FAIL**；已闭环历史缺口 9 个（task-11：B-6/A-10；task-13：B-4/B-5/B-8；
  task-15：C1-4/C2-2/C3-5；task-18：C2-3），**剩余 1 个未闭环缺口**：C2-7（corrupt-no-fallback 无自动修复能力，
  唯一恢复路径=用户卸载/重装）。
- **W07 判定**：桥接超时/sidecar 故障全通过；原生恢复类 C1/C3 全通过、C2 9/10（仅 C2-7 恢复能力限制）；
  叠加 boot 类剩余 2 缺口（B1-6/B2-5，见 `P5-T26-W07-fault-boot.md`）→ **W07 记为 PASS-with-gaps（部分通过）**，
  不宣称全通过。

## 2. 修复前 → 修复后（跨四轮修复复测）

### 2.1 task-11（构建 `ef1e…`）：B-6 / A-10

| 检查 | 修复前（`764f…`） | 修复后 | 结论 |
| --- | --- | --- | --- |
| **B-6** 自动重启后 guest 桥接恢复 | `E_INTERNAL / E_SNAPSHOT HTTP 404`，14ms，不恢复 | context.snapshot **42ms 成功**、正文=磁盘 | 缺口闭环 |
| **A-10** 桥接超时错误码 | `E_INTERNAL` / retryable=false / signal aborted | `E_TIMEOUT` / retryable=true / 宿主请求超时 15000ms | 缺口闭环 |

### 2.2 task-13（构建 `8867595b…`）：B-4 / B-5 / B-8

| 检查 | 修复前（`764f…`） | 修复后（v4 实测） | 结论 |
| --- | --- | --- | --- |
| **B-4** 崩溃瞬间 UI 提示 | 无任何提示（仅后端日志） | banner `data-phase=restarting`「后端重连中…正在自动恢复（第 1/3 次）」→ `recovered`；耗尽后 `degraded` 含真实原因 | 缺口闭环 |
| **B-5** 会话状态 | `state=active`、lastError=null | `state=suspended`、`lastError=E_HOST_UNAVAILABLE: 后端连接中断，正在自动恢复（第 1/3 次）`；恢复后 active + lastError 清空（B-5b） | 缺口闭环 |
| **B-8** stale runtime | get_runtime_info/runtime.json 返回死 pid | 退出即清 runtime.json、`get_runtime_info={ok:false,后端尚未就绪}`；耗尽终态无 stale pid；重启成功后重写 | 缺口闭环 |

### 2.3 task-15（构建 `983688db…`）：C1-4 / C2-2 / C3-5

| 检查 | 修复前（`764f…`） | 修复后（v5 实测原始值） | 结论 |
| --- | --- | --- | --- |
| **C1-4** 启动自动回滚 UI 提示 | FAIL：启动后 body 无提示（仅状态文件；事件早于前端挂载丢失） | **PASS**：打开面板即显示 notice「启动恢复：已自动恢复 1 个包 com.probe.t26bridge.c1：**已回滚到上一版本** 共检查 1 个包」；只读（文件 mtime/sha256 前后不变）、可关闭 | 缺口闭环 |
| **C2-2** 启动 safeMode UI 提示 | FAIL：入口无标记、面板需先点「检查/修复全部包」才显示 | **PASS（面板级）**：打开面板即显示「有包无法自动恢复（safe mode）」横幅 + notice「启动恢复：存在无法自动恢复的包（safe mode） com.probe.t26bridge.c2：损坏且无可用回退（需手动处理）」；只读、可关闭。**入口角标仍不可见 → 残余缺口 C2-3** | 缺口闭环（面板级） |
| **C3-5** 启动 cleanup-journal UI 提示 | FAIL：启动后 body 无提示 | **PASS**：打开面板即显示 notice「启动恢复：已自动恢复 1 个包 com.probe.t26bridge.c3：**已清理中断安装残留** 共检查 1 个包」；只读、可关闭 | 缺口闭环 |
| （新增）无状态不显示 | — | **PASS**：恢复为 clean 状态后重开面板 → notice 不显示（不误报） | 新增验证 |

### 2.4 task-18（构建 `faa71dfb…`）：C2-3

| 检查 | 修复前（v5 `983688db…`） | 修复后（v6 实测原始值） | 结论 |
| --- | --- | --- | --- |
| **C2-3** 冷启动入口 safeMode 角标 | FAIL（残余缺口）：未打开面板时入口无角标（依赖 Rust setup 早期 emit 的 `workshop://recover-status`，前端挂载前丢失） | **PASS**：入口按钮即显示 `workshop-startup-badge`（文本「启动恢复告警」、`title`/`aria-label`「启动恢复：存在无法自动恢复的包（safe mode）」），无需打开面板；入口 safe mode 徽标同步 | 缺口闭环 |
| **C2-10**（新增）clean 启动不误报 | — | **PASS**：恢复为 clean 状态后重新启动应用 → 入口 badge 不显示 | 新增验证通过 |

复测附加说明（如实）：v6 首轮 **C2 出现探针侧连锁误判**——入口新增 startup badge 后按钮含子元素，
探针 `open_workshop` 的 leaf 文本点击找不到入口按钮 → 面板未打开，C2-2/C2-5/C2-6/C2-8/C2-10 连锁 FAIL；
修正点击 helper（优先 `aria-label`/按钮文本命中）后重跑：仅 C2-7 为真实缺口。

复测附加说明（如实）：v5 首轮 **C2 行操作（修复/恢复、卸载）出现探针侧误判**——探针的行按钮选择器把
startup-notice 中「含包 id 的 `<li>`（无按钮）」误当包行 → C2-6/C2-8/C2-9 误判；已改为「含目标按钮的包行 `<li>`」
选择器后 C2 重跑：C2-6/C2-8/C2-9 PASS、C2-7 为真实缺口；其余场景首轮即通过。

## 3. 场景 A：桥接超时（挂起测试 sidecar 进程树）（10/10 PASS；构建 v3 `ef1e…`）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| A-1 隔离实例 + 签名包安装/trusted/启用/握手 | PASS | acceptedFeatures=4；hostVersion=product-guest-host |
| A-2 基线 context.snapshot 成功且正文=磁盘 | PASS | 35ms；revision=0 |
| A-3 故障注入有效（挂起 sidecar、主进程存活、白名单） | PASS | pids 白名单 true；NtSuspendProcess status=0；探针侧 /api/health 超时≥1.5s |
| A-4 context.snapshot 如实超时失败 | PASS | 15002ms、**E_TIMEOUT**、retryable=true |
| A-5 print.snapshot 如实超时失败（无假 token） | PASS | 15001ms、E_TIMEOUT、无 pdfToken |
| A-6 阻塞期间宿主 UI 仍响应 | PASS | CDP eval 2 次均 0.4ms；工作区/工坊文本完整 |
| A-7 会话状态可观测且未误判 | PASS | state=active |
| A-8 resume 后桥接恢复 | PASS | /api/health ok；snapshot 再次成功 |
| A-9 可停用恢复 | PASS | 「停用 guest」→ stopped 落盘 |
| A-10 桥接超时错误码 E_TIMEOUT/retryable=true | PASS | E_TIMEOUT / retryable=true |

## 4. 场景 B：运行中杀 sidecar → 自动重启 / 崩溃耗尽 / 重启恢复（11/11 PASS；构建 v4 `8867595b…`）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| B-1 基线（guest active/health ok/snapshot 可用） | PASS | acceptedFeatures=4；snapshot=磁盘 |
| B-2 运行中杀测试 sidecar（白名单/主进程存活/Rust 记录） | PASS | pids 白名单 true；日志「异常退出…1s 后自动拉起（第 1/3 次）」 |
| B-3 自动重启可观测（新 pid/端口 + runtime 重写） | PASS | 2.628s 后新 pid 42352/port 8000 |
| B-4 崩溃瞬间 UI 提示（banner restarting→recovered） | PASS | 「后端重连中…（第 1/3 次）」→「后端已恢复」 |
| B-5 故障期间会话 suspended + E_HOST_UNAVAILABLE | PASS | 见 §2.2 |
| B-5b 恢复后 active + lastError 清空 | PASS | 见 §2.2 |
| B-6 自动重启后 guest 桥接恢复 | PASS | snapshot 22ms 成功、正文=磁盘 |
| B-7 连续杀触发「崩溃重启次数耗尽」（上限 3 次） | PASS | 第 4 次后不再拉起；主进程存活 |
| B-8 崩溃耗尽后无 stale runtime | PASS | runtime.json 不存在、get_runtime_info Err |
| B-9 崩溃耗尽后 UI 降级可见（banner degraded + 真实原因） | PASS | 文案含「侧车崩溃且自动重启次数已耗尽」 |
| B-10 恢复路径：用户重启应用 | PASS | health ok；包在列；guest 重启用；snapshot 成功；正常启动 banner 不误报 |

## 5. 场景 C1：rollback-corrupt-active → 启动 notice / IPC/UI 修复（6/6 PASS；构建 v5 `983688db…`）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C1-1 启动 recover：rollback-corrupt-active / recovered=true | PASS | action=rollback-corrupt-active、recovered=true、safeMode=false |
| C1-2 一致性：active 回退 v1、verify=true、v2 目录保留 | PASS | state.active=1.0.0 / previous=2.0.0；v1 verify=true |
| C1-3 IPC `workshop_pack_recover` 幂等一致 | PASS | action=clean、recovered=false；state 不变 |
| **C1-4 启动自动回滚 UI 提示（修复后）** | **PASS** | 面板 notice「已回滚到上一版本」+ 包 id + 共检查 1 个包（无需先点检查） |
| **C1-5 notice 只读 + 可关闭（修复后）** | **PASS** | recover-status 文件 mtime/sha256 前后不变；点「关闭启动恢复提示」后 notice 消失 |
| C1-6 UI「检查/修复全部包」可观测且一致 | PASS | 「已检查 1 个包」；本包 clean；safeMode 与其它包审计一致 |

## 6. 场景 C2：corrupt-no-fallback + safeMode → 入口/面板即时提示 / 恢复路径（9/10 PASS；构建 v6 `faa71dfb…`）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C2-1 启动 recover：corrupt-no-fallback + safeMode=true | PASS | action=corrupt-no-fallback、recovered=false；safeMode=true |
| C2-2 启动 safeMode UI 提示（面板级） | PASS | 打开面板即显示「有包无法自动恢复（safe mode）」横幅 + notice（含 safe mode），无需先点检查 |
| **C2-3 冷启动入口 safeMode 角标（修复后）** | **PASS** | 未打开面板即显示 workshop-startup-badge「启动恢复告警」（title/aria 含「无法自动恢复」）；入口 safe mode 徽标同步 |
| C2-4 启动 notice 只读（未触发 recover_all） | PASS | recover-status 文件 mtime/sha256 前后不变 |
| C2-5 主动「检查/修复全部包」后 UI 横幅仍可观测 | PASS | 「已检查 1 个包（存在无法自动恢复的包）」+ 横幅 |
| C2-6 单包「修复/恢复」如实返回（不假修复） | PASS | 「无需恢复（corrupt-no-fallback）」；磁盘仍损坏 |
| **C2-7 [缺口] 无回退损坏包可自动修复** | **FAIL（缺口）** | recover 无修复能力；唯一恢复路径=用户卸载/重装 |
| C2-8 恢复路径：UI 卸载 + 重装有效包 + 检查 | PASS | 「已卸载 …c2」；安装 ok；「已检查 1 个包」；safeMode=false、verify=true、横幅消失 |
| C2-9 无恢复动作/无 safeMode 时 notice 不显示 | PASS | 恢复后重开面板 → notice 为 null（不误报） |
| **C2-10 clean 启动入口 badge 不显示（新增）** | **PASS** | 恢复后重新启动应用 → 入口 startup badge 为 null（不误报） |

## 7. 场景 C3：cleanup-journal → 启动 notice / IPC/UI 一致（6/6 PASS；构建 v5 `983688db…`）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| C3-1 启动 recover：cleanup-journal / recovered=true | PASS | action=cleanup-journal、recovered=true；safeMode=false |
| C3-2 一致性：txn/staging/未完成版本清理、active v1 verify=true | PASS | 全部清理，active=1.0.0、verify=true |
| C3-3 IPC `workshop_pack_recover` 幂等 | PASS | action=clean、recovered=false |
| **C3-4 启动 cleanup-journal UI 提示（修复后）** | **PASS** | 面板 notice「已清理中断安装残留」+ 包 id + 共检查 1 个包（无需先点检查） |
| **C3-5 notice 只读 + 可关闭（修复后）** | **PASS** | recover-status 文件 mtime/sha256 前后不变；点「关闭」后 notice 消失 |
| C3-6 UI「检查/修复全部包」可观测且一致 | PASS | 「已检查 1 个包」；本包 clean；safeMode=false |

## 8. 缺口清单（v6：1 个未闭环 + 9 个已闭环）

**已闭环（修复 + 产品 W 复测 PASS）**

| 缺口 | 修复提交 | 复测结果 |
| --- | --- | --- |
| B-6 自动重启后上下文丢失、桥接不恢复 | task-11 `443e0a6` | snapshot 42ms 成功、正文=磁盘 |
| A-10 桥接超时映射 E_INTERNAL | task-11 `443e0a6` | E_TIMEOUT / retryable=true / 15000ms |
| B-4 崩溃瞬间 UI 无提示 | task-13 `deed2a7` | banner restarting（第 1/3 次）→ recovered；耗尽后 degraded 含真实原因 |
| B-5 会话状态不反映后端故障 | task-13 `deed2a7` | suspended + E_HOST_UNAVAILABLE → active + lastError 清空 |
| B-8 崩溃后 stale runtime | task-13 `deed2a7` | 退出即清 runtime.json；get_runtime_info Err；耗尽终态无 stale pid |
| C1-4 启动回滚无提示 | task-15 `a41d449` | 面板 notice「已回滚到上一版本」（只读、可关闭） |
| C2-2 启动 safeMode 提示 | task-15 `a41d449` | 面板横幅 + notice 即时可见（无需点检查） |
| C3-5 启动 cleanup-journal 无提示 | task-15 `a41d449` | 面板 notice「已清理中断安装残留」 |
| C2-3 冷启动入口 safeMode 角标 | task-18 `a80ec8b` | 入口 `workshop-startup-badge` 冷启动可见；clean 启动不误报（C2-10） |

**未闭环（1 项）**

| # | 缺口 | 场景 | 影响 | 建议（不在本任务改动范围） |
| --- | --- | --- | --- | --- |
| 1 | 无回退损坏包不可自动修复（corrupt-no-fallback） | C2-7 | 只能用户卸载/重装；UI 已提供该路径，行为诚实 | 可考虑 UI 直接引导「卸载/重装」（产品增强，非缺陷修复） |
| 2 | （引用 boot 证据）boot 类剩余 2 缺口：B1-6 端口耗尽后无运行期自愈、B2-5 数据目录解除后无运行期自愈 | boot | 见 `P5-T26-W07-fault-boot.md`（v2 复测后 43/45，2 缺口） | 运行期自愈为已知设计限制 |

## 9. 覆盖边界 / 未覆盖 / 运行披露（不夸大）

1. **A 场景超时注入方式**：`NtSuspendProcess` 挂起测试 sidecar 进程树（不是杀进程/占端口），覆盖宿主 15s fetch 超时路径；
   不覆盖「TCP 连接被拒/网络不可达」（B 场景 kill 后 `Failed to fetch` 已覆盖）。
2. **真实磁盘故障/断电未覆盖**：C 场景为隔离目录中构造的损坏 pack/txn 半成品（可重复、可清理）。
3. **打印真实管线**在桥接超时下只验证到「快照读取超时失败、不返回假 token」；真实 PrintToPdf 阶段未在超时场景覆盖（G3/G4 已有独立证据）。
4. **C2 notice 的 `generatedAt` 显示**：面板 notice 直接展示 Rust `generatedAt`（SystemTime 序列化串），属展示层细节，未做人性化格式化（非缺陷，未纳入 checks）。
5. **运行披露（严格串行）**：五段时间线：
   - v1（第一 GO 窗口，B+C，`764f…`）：GO 前与 F 台账探针交错一轮**作废丢弃**；窗口内首轮 B-10 探针缺陷修正后 PASS；第 3 次完整运行为 v1 正式证据（21/29）。
   - v2（第二 GO 窗口，A 增量，`764f…`）：9/10（A-10 缺口），`--merge` 并入。
   - v3（task-12 复测，`ef1e…`）：B/A 复测；B-6/A-10 PASS；B 首测 B-10 探针 CDP 收集器竞态修正后重跑。
   - v4（task-14 复测，`88675…`）：B 复测；B-4/B-5/B-5b/B-8/B-9 PASS；首轮 B-9 探针文案子串断言过严修正后重跑。
   - v5（task-16 复测，`983688db…`）：C1/C2/C3 复测；C1-4/C2-2/C3-5 PASS；C2 首轮探针行选择器误选 notice `<li>` 修正后重跑。
   - v6（task-19 复测，`faa71dfb…`）：仅 C2 复测；C2-3 PASS（入口 badge）+ C2-10（clean 不误报）PASS；
     首轮因入口 badge 改变按钮 DOM 导致探针 open_workshop 点击失效 → 修正点击 helper 后重跑。
   本文件统计为 v6 复测后的最终值（46 checks / 45 PASS / 1 FAIL）。
6. **构建混用说明**：environment=`faa71dfb…`（v6，C2 复测构建）；A=`ef1e…`（v3）、B=`8867595b…`（v4）、
   C1/C3=`983688db…`（v5，本轮未复跑）、C2=`faa71dfb…`（v6）；JSON `build_history`/`run_conditions.scenario_builds`
   均已记录，未把旧结果混写为新构建结果。
7. **共享资源**：共享 `%APPDATA%\Roaming\com.astranota.uiws.e2e\workshop-packs` 中其它探针包（F 台账等）
   本探针未卸载/修改/删除；自有 pack id `com.probe.t26bridge*` 运行后已清理。
8. **红线合规**：只启动隔离测试构建；APPDATA/KE_WORKSPACE/KE_APP_CONFIG_LEGACY 隔离；CDP 端口 10410+ 每次 launch 轮换；
   杀/挂起 sidecar 前用 CIM 校验 PID 属于自身进程树且路径在
   `C:\ke-tmp\uiws-t26\bin\*` / `F:\Work\Dev\cargo-target\*` 白名单；**无 taskkill /IM**；
   未触碰 `D:\AstraNota*` 用户实例（用户 App 未运行，N/A）。

## 10. 判定（v6 修复后）

- **task-11（B-6/A-10）、task-13（B-4/B-5/B-8）、task-15（C1-4/C2-2/C3-5）、task-18（C2-3）：修复验证通过（产品 W 复测）**
  → 9 个历史缺口闭环。
- **场景 A（桥接超时）**：10/10 PASS；**场景 B（sidecar 故障）**：11/11 PASS。
- **场景 C（原生 Rust 恢复）**：C1 6/6、C2 9/10、C3 6/6；剩余 1 缺口：C2-7（no-fallback 无自动修复能力）。
- **W07 整体**：桥接超时/sidecar 故障/原生恢复/boot crash 类别均已覆盖；**PASS-with-gaps（部分通过）**，
  剩余 C 类 1 + boot 类 2 缺口如实保留、不宣称全通过；不改变 `EXPERIMENTAL_TRUSTED_PACKS` 里程碑结论。
  缺口交由 Lead/docs-consolidator 汇总。
