# P5-T26 W07 扩展证据（v2，修复后复测）：boot crash / 连续启动失败 — 隔离产品构建 W 43/45（2 个未闭环缺口）

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建）
- 任务：task-4（W07 扩展）+ task-19（A2-10/B1-4/B3-4 修复后产品 W 复测）
- 工具：`docs/ui-workshop/tools/run_t26_boot_crash_probe.py`（新增，可复跑）
- 原始结果：`evidence/T26-W07-boot-results.json`（45 条 checks + 全量场景原始 metrics；含 `build_history`/`merged_runs`/`retest`）
- 证据类型：**W（真实产品隔离构建进程/数据行为）**
- 环境：测试 exe `C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`
  （sha256 `be2582adbaedafa98581a2262393f6430c4ded13ea0a5fba191751f9bb49861a`，size 15888384，
  mtime 2026-10-19 09:27，Lead 统一重建；identifier `com.astranota.uiws.e2e` 未变）；
  运行期 repo HEAD `d502d9d`（v1 基线；branch `feat/ui-workshop`）；Python 3.14.7；
  用户 App 未运行 → 用户影响 **N/A**（运行前后只读查询均为空）。
- **修复后复测构建（v2，本文件 §8）**：sha256 `faa71dfbf5222d63aa3c1b365961055d344ce09fa27cfcadc73e607c0ef75789`，
  size **15919616**，mtime **2026-10-19 15:29:02**（含 task-18 commits `a80ec8b`/`b030b25`；运行期 repo HEAD 见 JSON environment）；
  `A2/B1/B3` 场景已在此构建复测，`A1/A3/B2` 保留原构建 `be2582ad…` 证据（未混写）。
- 复现（WSL，串行独占窗口）：
  ```bash
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
    \$env:PYTHONIOENCODING='utf-8'; & 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' \
    -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_t26_boot_crash_probe.py'"
  ```
  （`--scenarios B1` 可单场景复跑；`--dry-run` 只做环境自检、不启动 exe。）

## 1. 结论（v1 修复前基线；v2 修复后见 §8 与 §10）

- **场景 A（启动早期强杀 → 重启恢复/数据完整性）：A1 9/9、A2 10/11、A3 4/4 PASS（含 A3 补充崩溃循环）。**
  首次运行与已有数据目录在「主窗口未就绪」窗口（350–800ms）被按 Popen 自身 PID 强杀后，重启均能
  正常启动（runtime.json ≈2.1s 就绪、主窗口首帧 ≈2.1s）、启动 recover 状态可观测、工作区/包/配置
  JSON 与自建夹具无损坏。**A2 缺口（BOOT-A2-10）**：早期崩溃时 runtime.json 尚未写出 → 下次启动
  `cleanup_stale()` 依赖 runtime.json 看不到遗留 sidecar 孤儿，孤儿（PyInstaller 父/子进程）存活占默认
  端口 8000，应用自动换 8001 仍可启动（数据未损坏）；需按路径白名单人工/外部回收（探针在证据后已清理）。
- **场景 B（连续启动失败 → 恢复路径/错误可观测性）：B1 5/7、B2 5/6、B3 4/4 PASS（含 3 个缺口语义 FAIL）。**
  端口耗尽（B1）与数据目录被普通文件占位（B2）均可**稳定连续复现 3 次启动失败**（宿主主进程不崩溃、
  后端始终未就绪、无 runtime.json）；解除故障后**运行中实例不会自动重试**（无运行期自愈，需用户重启），
  **重启可恢复**。B2 的失败原因有 Rust stderr 日志（`创建应用数据目录失败 os error 183` ×3 次尝试），
  而 B1（端口耗尽）**完全静默、无 stderr/日志**，仅 emit `ke:runtime-error`（前端未监听）→ 原因不可见；
  两类失败都约 30–37s 后回退显示通用「后端服务未连接」横幅（无具体原因）。
  损坏 settings/app_config（B3）不阻断启动、静默回退默认值（settings 默认/`recent_workspaces` 空），
  **无自动修复/备份/用户提示**（缺口）。
- 总计：**44 checks，40 PASS / 4 FAIL**；4 个 FAIL 全部是上述**真实缺口**（A2-10 孤儿 sidecar、
  B1-4 失败原因不可观测、B1-6 与 B2-5 无运行期自愈），均如实保留、不冒充通过。
- **W07 判定口径**：boot crash / 连续启动失败两个故障类别的**核心恢复路径可用**（重启可恢复、
  数据不损坏、失败可复现），但存在 4 个恢复/可观测性缺口未闭环 → 记为 **PASS-with-gaps**，
  不宣称 W07 整体全通过（W07 其余子项见既有证据）。
- **v2 修复后复测摘要（task-19，构建 `faa71dfb…`）**：A2-10（孤儿 sidecar 启动自愈）、B1-4（失败原因结构化日志）、
  B3-4（损坏 settings/app_config 备份 + 默认重置 + 日志提示）均 **FAIL→PASS**；最终 **45 checks / 43 PASS / 2 FAIL**，
  剩余 2 缺口：B1-6、B2-5（均为「运行期无自愈，需重启」的已知设计限制，task-18 未改动）。详见 §8。

## 2. 场景 A1：首次运行 + 启动早期强杀（~420ms）→ 重启（9/9 PASS）

隔离 APPDATA 为空（无 `%APPDATA%\KnowledgeEditor`，真实首次运行），启动 ~420ms（主窗口未就绪）
按 Popen 自身 PID 强杀，再重启。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| A1-1 首次运行基线（隔离 APPDATA 无 KnowledgeEditor） | PASS | appdata/ke_cfg/runtime 均不存在 |
| A1-2 强杀时主窗口未就绪 | PASS | kill_at **0.554s**、runtime.json 未生成、bootTimings 仅 `{"t0":0}`、body 空 |
| A1-3 按 Popen 自身 PID 强杀成功 | PASS | 主进程已终止；**未使用 taskkill /IM** |
| A1-4 强杀后重启启动成功 | PASS | 存活；runtime 就绪 **2.072s**、首帧 **2.076s** |
| A1-5 首次运行重启后生成隔离数据目录 | PASS | `…\a1\appdata\KnowledgeEditor`；runtime backend pid 7912 / port 8000 |
| A1-6 启动 recover 状态可观测 | PASS | `workshop-recover-status.json` 本次新写：checked=1、safeMode=false |
| A1-7 数据目录无损坏 | PASS | runtime.json 可解析；日志无 panic/崩溃 |
| A1-8 工作区自建夹具未被改动 | PASS | 两个夹具 sha256 前后一致 |
| A1-9 配置目录可读写、不迁移真实用户 legacy 配置 | PASS | app_config 缺失（合法）；`KE_APP_CONFIG_LEGACY` 隔离后 legacy 用户文档迁移数 **0** |

## 3. 场景 A2：已有数据目录 + 签名包 + 启动早期强杀（~800ms）→ 重启（v1 基线 10/11 PASS，1 缺口；v2 复测见 §8）

基线：正常启动（工作区自动打开）→ CDP 安装自建签名包 `com.probe.t26w07boot`（active=1.0.0、
资产 sha256 一致）→ 优雅退出（`app_request_exit`，退出码 0、runtime.json 移除）→ 启动 ~800ms
（主窗口未就绪、runtime.json 未写）按自身 PID 强杀 → 重启。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| A2-1 已有数据目录基线正常启动 + 工作区自动打开 | PASS | runtime 就绪 2.103s、首帧 2.105s |
| A2-2 签名包安装并持久化 | PASS | install ok；state.json active=1.0.0；资产 sha256 一致；pack_list 含本包 |
| A2-3 正常退出清理 | PASS | 退出码 0、runtime.json 已移除、无孤儿 |
| A2-4 强杀时主窗口未就绪 | PASS | kill_at **0.801s**、runtime.json 未生成、boot 仅 `{"t0":0}` |
| A2-5 强杀时 sidecar 已 spawn（孤儿可观测） | PASS | 杀时 sidecar pid 38636；2.5s 后孤儿 38636 + 子进程 26920 |
| A2-6 强杀后重启启动成功 + 工作区自动打开 | PASS | runtime 就绪 2.239s、首帧 2.240s |
| A2-7 启动 recover 状态可观测且本包 action=clean | PASS | 本次新写：checked=2、safeMode=false、本包 action=clean |
| A2-8 包数据无损坏 | PASS | 重启后 state.json active=1.0.0；index.html sha256 与安装前一致 |
| A2-9 配置/工作区夹具无损坏 | PASS | app_config 合法且 recent_workspaces 含隔离工作区；settings 合法；夹具 sha256 一致 |
| **A2-10 [缺口] 早期崩溃孤儿 sidecar 被下次启动清理** | **FAIL（真实缺口）** | 孤儿 pids **26920、38636** 在重启后仍存活；新后端 pid 33088 / **port 8001** |
| A2-11 孤儿占默认端口时自动换端口启动 | PASS | 8000 被孤儿占用 → 新后端自动用 8001（前端 CSP 白名单内），应用可用 |

**缺口说明（A2-10）**：Rust `cleanup_stale()` 只在 `runtime.json` 存在时能定位旧 sidecar；而本次强杀
发生在 health 握手写 runtime.json 之前 → 下次启动看不到孤儿，孤儿（PyInstaller bootloader + 子进程）
持续存活并占默认端口 8000。产品表现为「换端口静默启动、应用可用、但进程/端口泄漏」，无自愈清理路径。
探针在记录证据后按路径白名单（`C:\ke-tmp\uiws-t26\bin\*`）清理了 3 个孤儿进程（26920/29772/38636）。

## 4. 场景 A3（补充）：连续 3 次启动早期强杀（crash loop）→ 恢复（4/4 PASS）

350/550/750ms 三轮早期强杀（实际 kill_at 0.558/0.621/0.752s，均 runtime.json 未生成、bootTimings
无 settings 里程碑），每轮后按白名单清理 sidecar 残留（`backend_left_after_cleanup` 均为空），
第 4 次启动恢复：runtime 就绪 3.892s、工作区自动打开、recover 状态可观测（checked=1、safeMode=false）、
app_config/settings 合法、夹具 sha256 一致。

## 5. 场景 B1：sidecar 端口耗尽（连续 3 次启动失败）→ 恢复（v1 基线 5/7 PASS，2 缺口；v2 复测见 §8）

注入：`KE_PORT=18648`（隔离端口族 18648–18650 由探针独占占用，`SO_EXCLUSIVEADDRUSE`，占用语义自检
3/3 通过）。**注意**：前端 CSP `connect-src` 只白名单 8000-8002，故失败注入用隔离端口族
（与默认端口同一 `find_free_port` 失败代码路径），恢复验证必须用默认端口——避免把 CSP 拦截误记为
端口耗尽证据。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| B1-1/2/3 连续 3 次启动失败可观测 | PASS×3 | 首次失败信号 0.752/0.655/0.537s（确认稳定窗口 3.804/3.708/3.590s）；进程存活、runtime.json 未生成、sidecar 未拉起、`get_runtime_info` 报「后端尚未就绪」 |
| **B1-4 [缺口] 失败原因有 stderr/日志可观测** | **FAIL（真实缺口）** | 3 次启动 stderr 均 **0 字节**（Rust `find_free_port` 全失败分支静默 continue、无 eprintln；仅 emit `ke:runtime-error`，前端未监听） |
| B1-5 UI 错误最终可见 | PASS | 约 **36.82s** 后显示通用横幅「后端服务未连接，请启动 backend（uvicorn app.main:app）」（无具体原因） |
| **B1-6 [缺口] 端口释放后运行中实例自动重试恢复** | **FAIL（真实缺口）** | 释放 3 个占用端口后（约 36.8s 释放）观察至 kill：runtime 仍缺失、sidecar 仍未拉起、stderr 仍 0 字节；Rust 侧 3 次尝试后仅 emit runtime-error → 需用户重启 |
| B1-7 重启（默认端口）后恢复 | PASS | runtime 就绪 2.687s、首帧 2.689s、port 8000 |

## 6. 场景 B2：应用数据目录被普通文件占位（连续 3 次启动失败）→ 恢复（5/6 PASS，1 缺口）

注入：删除隔离 `%APPDATA%\KnowledgeEditor` 目录，以普通文件占位（模拟数据目录损坏/被占位）。

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| B2-1/2/3 连续 3 次启动失败且错误可观测 | PASS×3 | 失败检测 0.519/0.514/0.511s；日志 `[sidecar] 第 1/2/3 次尝试失败: 创建应用数据目录失败: 当文件已存在时，无法创建该文件。 (os error 183)`；runtime.json 未生成、sidecar 未拉起 |
| B2-4 UI 错误可观测 | PASS | 约 **36.62s** 后显示「后端服务未连接」横幅（挂载 30s 等待窗口后回退） |
| **B2-5 [缺口] 数据目录解除阻塞后运行中实例自动重试恢复** | **FAIL（真实缺口）** | 移除占位文件后观察 10s：runtime 仍缺失、sidecar 未拉起、尝试失败日志数不变（3→3）→ 需用户重启 |
| B2-6 解除阻塞后重启恢复 | PASS | runtime 就绪 2.178s、首帧 2.204s |

## 7. 场景 B3：损坏 settings.json / app_config.json（非法 JSON）（v1 基线 4/4 PASS，含 1 缺口；v2 复测见 §8）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| B3-1 损坏状态不阻断启动（连续 2 次） | PASS | 两次均启动成功（runtime 就绪 2.075s / 首帧 2.085s），宿主无崩溃 |
| B3-2 settings 损坏回退默认可观测 | PASS | `get_settings` 返回 schemaVersion=1、ui.theme=system 等默认值 |
| B3-3 app_config 损坏回退默认 | PASS | 后端 `/api/workspace/recent` → `workspaces: []`；`/api/workspace/current` 仍 open（KE_WORKSPACE 默认工作区可用） |
| **B3-4 [缺口] 无自动修复/备份/用户提示** | **FAIL（真实缺口）** | 两次启动后两文件字节未变（sha256 与注入非法内容一致）、无 .bak/.tmp、UI 无告警横幅 → 静默回退、用户配置在无提示下丢失（recent 列表） |

## 8. 修复后复测（v2，task-19：A2-10 / B1-4 / B3-4）

构建：sha256 `faa71dfb…`（见头部），含 task-18 修复 commits `a80ec8b`（C2-3/B1-4）、`b030b25`（A2-10/B3-4）。
复测仅跑 A2/B1/B3（`--scenarios A2,B1,B3 --merge`），A1/A3/B2 保留 v1 构建证据。

| 检查 | 修复前（v1 `be2582ad…`） | 修复后（v2 `faa71dfb…`） | 结论 |
| --- | --- | --- | --- |
| **BOOT-A2-10** 早期崩溃孤儿 sidecar 启动自愈 | FAIL：孤儿 pids 26920/38636 重启后仍存活；新后端 port **8001** | **PASS**：spawn registry 保守判定 → 整树停止孤儿 pid **14128**；日志 `[sidecar] W07 A2-10: 发现上次启动遗留的孤儿 sidecar（pid=14128），整树停止以释放端口`；重启 runtime 就绪 3.795s、新 pid 50300 / **port 8000**，孤儿清零 | 缺口闭环 |
| **BOOT-A2-11** 端口不再偏移 | PASS（8001，但属缺口表现） | **PASS**：新后端 port **8000**（孤儿已释放默认端口） | 复核通过 |
| **BOOT-B1-4** 端口耗尽失败原因可观测 | FAIL：3 次启动 stderr 均 **0 字节**（静默） | **PASS**：stderr **517B**，含结构化行：
`[sidecar] 启动失败（第 1/3 次尝试）: E_SIDECAR_PORT: 端口 18656 被占用且后续端口不可用（尝试 1/3）`（第 2/3、3/3 同）+ 最终 `[sidecar] 启动失败（已尝试 3 次，不再重试）: E_SIDECAR_PORT: …` | 缺口闭环（日志侧） |
| **BOOT-B1-5** UI 错误最终可见 | PASS（36.82s 通用横幅） | **PASS**：36.67s 通用横幅「后端服务未连接」（terminal runtime-error 在窗口挂载前发出 → UI 未显示具体原因；**早期事件限制如实记录**） | 复核通过 |
| **BOOT-B3-4** 损坏状态文件备份 + 默认重置 | FAIL：两文件字节未变、无 .bak/.tmp、无提示（静默丢设置） | **PASS**：生成 `settings.json.corrupt-1792395484722.bak`、`app_config.json.corrupt-1792395484722.bak`（size 29，sha256 与注入原始损坏字节一致）；主文件重置为合法默认 JSON（settings schemaVersion=1/ui.theme=system、app_config recent_workspaces=[]）；连续两轮启动**幂等**（不重复备份） | 缺口闭环 |
| **BOOT-B3-5**（新增）修复提示可观测 | — | **PASS**：日志含 `[settings] W07 B3-4: settings.json 损坏（JSON 解析失败），已备份到 …settings.json.corrupt-….bak 并重置为默认配置`（app_config 同） | 新增验证通过 |

复测后统计：**45 checks / 43 PASS / 2 FAIL**；剩余 2 缺口：**BOOT-B1-6**（端口耗尽后运行期无自愈，需重启）、
**BOOT-B2-5**（数据目录占位解除后运行期无自愈）——两者为已知设计限制（task-18 未改动运行期自愈），如实保留。
`A1/A3/B2` 未复跑（保留 v1 构建 `be2582ad…` 证据，未混写）。v2 首轮运行无探针侧缺陷（B3 新增 B3-5 check 属本次断言扩展）。

## 9. 覆盖边界 / 未覆盖 / 探针侧修正（不夸大）

1. **早期强杀窗口**仅覆盖「主窗口未就绪」阶段（实测 0.42–0.80s 目标、实际 kill_at 0.55–0.80s；均
   runtime.json 未写、bootTimings 无 settings/workspace 里程碑）。窗口就绪后的崩溃/关闭握手不在本轮
   （属既有 P1-14、关闭 flush 握手等其它证据）。
2. **端口耗尽注入方式**：用 `KE_PORT` 隔离端口族独占注入（前端 CSP 只允许 8000-8002，直接占默认
   端口会与用户实例/并发探针冲突）；Rust 失败代码路径与默认端口相同，恢复验证使用默认端口，
   证据中已注明。
3. **孤儿 sidecar 缺口**只验证了「孤儿存活 + 应用换端口 8001 可用」；未等到「新应用 3 次启动全失败
   （孤儿占满 8000-8002）」的最坏路径（本轮重启 2.2–3.9s 内成功）。孤儿的进程回收依赖外部（如
   用户下一次正常退出/重启清理或人工），探针已按白名单清理。
4. **B2 数据目录占位/B3 非法 JSON 为测试构造**（可重复、可清理、隔离路径），非真实磁盘满/断电；
   真实磁盘故障场景未覆盖。
5. **UI 错误可观测性**与前端的 30s 等待窗口耦合（实测横幅在 36.6–36.8s 出现）；Tauri/前端升级后需复跑。
6. **窗口内运行记录（如实披露）**：v1 GO 窗口内共 1 次完整探针（首轮 36/42，暴露**探针侧缺陷 3 处**：
   A2-8 读取顺序、B1 日志假设错误、B2 CDP 连接时序）+ 1 次 B1 定向诊断（修正端口占用注入语义）+
   1 次完整重跑（v1 证据 40/44）。首轮探针侧缺陷已在重跑前修正；真实缺口在两轮中一致复现
   （A2 孤儿 sidecar；B1 静默失败；无运行期自愈）。
   **v2（task-19）复测窗口**：串行独占，`--scenarios A2,B1,B3 --merge` 一次通过；A2-10/B1-4/B3-4 PASS；
   B1-4 的 UI 具体原因仍受「terminal runtime-error 早于前端挂载」限制（日志侧已闭环，UI 回退通用横幅如实记录）；
   B3 新增 B3-5 check（修复提示日志）。
7. **测试数据/进程隔离与红线**：APPDATA 指向 `C:\ke-tmp\uiws-t26-w07boot\*\appdata`（产品 data_dir 由
   env 决定）；`KE_APP_CONFIG_LEGACY` 重定向到隔离路径（不读/不迁移真实用户 legacy 配置）；
   包/恢复状态位于真实 `%APPDATA%\Roaming\com.astranota.uiws.e2e\workshop-packs`（隔离 identifier），
   仅写/清自有 pack id `com.probe.t26w07boot`（跑后已删除，共享目录和其它探针的包未动）；
   进程清理只按自身 Popen PID + `C:\ke-tmp\uiws-t26\bin\*` / `F:\Work\Dev\cargo-target\*` 路径白名单，
   **无 taskkill /IM**；运行前后用户 App 均未运行（D:\AstraNota* 只读查询为空）→ 用户影响 **N/A**。
8. **未覆盖**：真实掉电/磁盘故障、窗口就绪后崩溃、运行期自愈（产品当前无此能力，见 B1-6/B2-5）、
   多实例/单实例互斥在本场景下的额外影响（A1–A3 重启均成功，说明强杀后单实例互斥锁无残留）。

## 10. 判定（v2 修复后）

- **boot crash（启动早期强杀 / 崩溃循环）**：产品重启恢复路径 **通过**（A1 9/9、A2 **11/11**、A3 4/4），
  数据完整性成立；**A2-10 孤儿 sidecar 启动自愈已修复并复测 PASS**（spawn registry 保守判定 → 整树停止、默认端口 8000）。
- **连续启动失败**：失败可稳定复现、重启可恢复 **通过**（B1 6/7、B2 5/6、B3 **5/5**）；
  **B1-4 结构化日志可观测已修复并复测 PASS**（`E_SIDECAR_PORT:` / `E_SIDECAR_START:`；UI 具体原因受早期事件限制，如实记录）、
  **B3-4 备份+重置+日志提示已修复并复测 PASS**（`.corrupt-<ts>.bak` 保留原始损坏字节、两轮幂等）；
  **剩余 2 个缺口**：B1-6、B2-5（运行期无自愈，需重启；已知设计限制，task-18 未改动）。
- 合计 **45 checks / 43 PASS / 2 FAIL（未闭环缺口）**，如实记录（不夸大、不掩盖）。以上不改变
  `EXPERIMENTAL_TRUSTED_PACKS` 里程碑结论；剩余缺口交由 Lead/docs-consolidator 汇总。
