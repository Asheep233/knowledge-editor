# 独立验证报告：发布前审查修复（前端 B4/B5/M4/U4 + Tauri B2/M5/M6 + R-1…R-4b）

> 验证人：**verifier-trash**（task-47，独立于实现者）· 报告时刻：**2026-09-20 14:07 CST**
> 依据：`docs/review-v1.2.0-pre.2-full.md`（§1 B2/B4/B5、§2 M4、§4 U4/U7）
> 纪律：**只报我亲自跑出来的结果**；无法验证的项在 §7 显式声明；**未修改任何源码**（新增 2 个 verify 测试文件）。

## 0. 冻结锚点（sha256 / 时刻 / HEAD）

| 项 | 值 |
|---|---|
| HEAD | `1cde79beae978403e29a6dff472e08fe1d45b1d1`（`1cde79b`） |
| 版本态 | 全部版本源一致 = `1.2.0-pre.3`（`frontend/src/version.ts`、`frontend/package.json`、`backend/app/__init__.py`、`desktop/package.json`、`tauri.conf.json`） |
| 报告时刻 | 2026-09-20 14:07 CST |
| 我的运行环境 | WSL/Linux，node v24.19.0，16 核，**`cargo` 不在 PATH**；跑分期间宿主负载 load avg **11–14**（其它 agent 构建） |
| 我的产出文件 | `frontend/src/state/review-fixes.verify.test.ts`（19 例）、`frontend/src/editor/plain-export.verify.test.ts`（21 例）、本报告 |

**前端冻结 sha（跑前/跑后各复算，8/8 一致）**
```
a7264b9f…  frontend/src/App.tsx                  8d585205…  frontend/src/editor/plain-export.ts
37f631bf…  frontend/src/editor/ke.ts             fffa2cf0…  frontend/src/components/layout/EditorArea.tsx
130cb309…  frontend/src/editor/plain-export.test.ts   efcf6da6…  frontend/src/App.discardPending.test.tsx
f822293d…  frontend/src/components/editor/SourceModeView.test.tsx   21d1f3ae…  frontend/src/state/shortcuts.test.ts
```
**Tauri 侧冻结 sha**：`lib.rs f72e8d1c…`、`menu.rs 3434e183…`、`sidecar.rs 7ccce513…`、`desktop.ts 555c04b2…`。

**方法学声明**：本报告分「静态/接线级」与「运行级」两类证据；所有运行结果都附**运行时刻 + 当时 sha + 当时的树状态**。
验证期间工作树被多路并发修改（详见 §3.3），凡受影响的轮次一律**标注并剔除**，不合并数字。

---

## 1. B4 —— 跨工作区串写（前端「放弃」分支）

### 1.1 独立用例（`src/state/review-fixes.verify.test.ts`，19 例，全绿）
| 用例 | 构造（独立于开发者用例） | 结果 |
|---|---|---|
| B4-A1 switchWorkspace | 在途悬挂 + **确认对话框期间重新入队**（开发者的用例没有这一击）→ 放弃后未决清零 + `flushPendingAll()` 后**仍零 PUT** | ✅ PASS |
| B4-A2 handleCloseWorkspace | 同上 | ✅ PASS |
| B4-A3 handleNewArticle | 同上 | ✅ PASS |
| B4-A4 | 在途 `AbortSignal.aborted === true` | ✅ PASS |
| B4-A5 | 对照：用户**取消** → 未决保留、零 PUT（丢弃是有条件的） | ✅ PASS |
| B4-A6 | 对照（牙齿）：同一 saveFn **未被丢弃**时 `flushPendingAll()` **确实发出 PUT** → 证明 A1-A3 的「零 PUT」可被违反 | ✅ PASS |
| B4-B1 ×5 | 五条入口源码级含 `discardPending(`（防漂移） | ✅ PASS |
| B4-B2 | `discardPending` 必须位于 `if (!flushed)` **之内**（不得退化成无条件丢弃） | ✅ PASS |
| B4-B3 | 三处取消分支必须 `return`（取消后不得继续切换） | ✅ PASS |

### 1.2 ★ 5 处 `discardPending` 独立复核（Lead 指定盯点：是否为过测试而放宽）
逐点读 `App.tsx` 源码，**每一处都在 `if (!flushed) { ... }` 块内、且在 `if (!(await askConfirm(...))) return` 之后**：
| # | 入口 | 行 | 分支链 |
|---|---|---|---|
| ① | `requestOpenArticle` | 338 | 334 `if (!flushed)` → 335 `askConfirm(...) return` → 338 |
| ② | `closeTabById` | 370 | 367 → 368 → 370 |
| ③ | `switchWorkspace` | 503 | 496 → 497-499 → 503 |
| ④ | `handleCloseWorkspace` | 570 | 565 → 566-568 → 570 |
| ⑤ | `handleNewArticle` | 585 | 582 → 583 → 585 |

`shortcuts.test.ts` 把计数断言从 **2 → 5**：属 B4 **真实新增 3 处**（该测试同时锚定 5 条互不相同的确认文案），
**不是放宽**；且我的 B4-B1/B2/B3 对「位置在放弃分支内」做了更严的独立断言。
**判定：B4 = FIXED（运行级 PASS，含反向对照）。**

**残留（设计边界）**：对「已到达服务端并被处理」的 PUT，`abort()` 无法撤销（`saveQueue.ts` 自述）；未构造服务端侧证据。

---

## 2. B5 —— plain 导出吞首段

实现：`plain-export.ts:26-30` `scanLeadingFm` 委托 `ke.ts` 的 `scanFrontmatter`；`splitLeadingFm`、`stripKeFrontmatter`
均经它判定；旧宽松正则只存在于注释（:22）。**我重写了上一任留下的骨架**——其「三方同口径」断言用
`stripKeFrontmatter(md) !== md` 当判定，对「有 frontmatter 但无 KE 键」会假红（该函数此时原样返回），已换成行为化断言。

| 组 | 内容 | 结果 |
|---|---|---|
| A1-A5 | 两段都在 + 段序 + **HR 计数 = 2** + `stripKeFrontmatter` 恒等 + `scanFrontmatter` 判 null + 加 meta 零丢段 + 首行 HR 无尾段 | ✅ PASS |
| B1-B4 | 未闭合 `---`、连续 HR、空 fm 块、真 fm + 正文首行 HR | ✅ PASS |
| C1-C4 | BOM / CRLF / BOM+CRLF 真 fm / 真 fm 无 KE 键（字节不做改动） | ✅ PASS |
| D1-D5 | 导出幂等（二次导出稳定）+ 零丢段矩阵 | ✅ PASS |
| E1 | **全仓 `src/**` 非测试源文件**（去注释后）无可执行宽松 fm 正则 | ✅ PASS |
| E2 | 两处判定都委托 `scanFrontmatter`（`scanLeadingFm` 单一入口） | ✅ PASS |
| E3 | 零内容丢失矩阵（9 种输入逐行核对） | ✅ PASS |

**判定：B5 = FIXED。**

---

## 3. M4 / U4 / 回归门禁

### 3.1 M4（源码态导出陈旧）—— seam + 接线级（Lead 已接受）
| 用例 | 内容 | 结果 |
|---|---|---|
| M4-1 | `buildSourceSavePayload(raw, textarea)` 含 textarea 新内容 + 保留 `title` + 含 `ke_version` | ✅ PASS |
| M4-2 | `plainMarkdown(textarea, meta)` 含新内容且**不含** `ke_version` | ✅ PASS |
| M4-3 | 源码载荷还原磁盘原文 **BOM + CRLF** | ✅ PASS |
| M4-4 | 三个 handler 均有 `viewModeRef.current === 'source'` 分支且用对应构造函数；**正文态分支保留** | ✅ PASS |
| M4-5 | `handleSourceChange` 逐键更新 `sourceValueRef.current` | ✅ PASS |
| M4-6 | `viewModeRef` 随 `viewMode` 同步 | ✅ PASS |

**判定：M4 = FIXED（seam + 接线级 PASS）**；端到端渲染点击未做（§7），由 Lead 真机补。

### 3.2 回归门禁：tsc 与我的 40 例（最终冻结态）
```text
$ cd frontend && npx tsc -b --noEmit
（无输出）TSC_EXIT=0

$ npx vitest run src/state/review-fixes.verify.test.ts src/editor/plain-export.verify.test.ts
 Test Files  2 passed (2)
      Tests  40 passed (40)
   Duration  5.62s
```
✅ PASS。

### 3.3 ★ U4 全量 `npx vitest run` 连跑：全部尝试如实记录
今天共做了 **5 组**三连跑；**逐轮数字如下（不合并、不掩饰）**：

| 组 | 时刻 | 树状态 | RUN1 | RUN2 | RUN3 | 红因 |
|---|---|---|---|---|---|---|
| ① 预跑 | 13:43–13:46 | 移动中（App.tsx 13:35 版） | exit 0 | **exit 1** | exit 0 | RUN2：`Unhandled Rejection: transformCallback`（App.tsx:759 菜单 effect 动态 import 缺 `.catch`）——**即 U4 根因** |
| ② 冻结首跑 | 13:51–13:54 | 冻结 sha ✓，但**他人并发文件**中途落地 | exit 0（59 files） | **exit 1**（61 files） | **exit 1**（61 files） | RUN2/3：`src/editor/export-acceptance-u2.test.ts`（13:51:46 落地，**非冻结范围**）6 红 + `src/__u2debug.test.ts` 收集失败；**与冻结范围无关**，`transformCallback` 命中 0 |
| ③ 剔除外来文件 | 13:54–13:58 | 冻结 sha ✓，排除 2 个外来文件 | exit 0 | exit 0 | exit 0 | **3/3 干净**（59 files / 1147 passed + 1 skipped / Errors 0） |
| ④ 干净重跑（无排除） | 13:58–14:03 | 冻结 sha ✓，外来文件已删 | exit 0 | exit 0 | **exit 1** | RUN3：`perf-bench.test.ts` 绝对时间门（15193ms vs 14123ms）+ **6 个 fork worker 启动超时**（53/59 files 未跑全）；宿主 load avg 11–14；`transformCallback` 命中 0 |
| ⑤ 复跑 | 14:03–14:06 | 同上，load avg 仍 13.7 | **exit 0** | **exit 0** | **exit 0** | **3/3 干净**（59 files / 1147 passed + 1 skipped / Unhandled 0） |

**U4 判定：根因 FIXED —— 自 13:46:40 的 `.catch(() => undefined)` 落地后，全部 9 次全量运行中
`transformCallback` 命中数均为 0，`Unhandled` 在干净轮次均为 0。**
**但门禁仍未达「任意时刻 3/3」**：④ RUN3 是**环境性**红（宿主负载导致 perf-bench 绝对时间门越界 + fork worker 启动超时），
不是产品缺陷、也不是原 U4 根因。⑤ 在同等负载下 3/3 干净。
→ **归因**：`perf-bench.test.ts` 的 `gateFirst = max(常量, calib×5.5)` 是**绝对墙钟门**，负载敏感（PRE-EXISTING 门禁设计）；
`vitest-pool forks worker 启动超时` 属资源/环境（PRE-EXISTING）。
**按门禁原始定义（3 次必须 exit 0）**：③ 与 ⑤ 达标；④ 未达标，红因已定位且可复现解释。

---

## 4. Tauri：B2 / M5 / M6（静态核验）

### 4.1 B2 = FIXED
| 断言 | 证据 | 结果 |
|---|---|---|
| 菜单退出不再直接 `request_exit` | `menu.rs:137-141`：`if !begin_close_handshake(app) { request_exit(app) }` | ✅ |
| 关窗与菜单退出**共用**握手 | `lib.rs:100-112`（CloseRequested）与 `menu.rs:137-141` | ✅ |
| 二次退出仍能真正退出 | `CLOSE_REQUESTED.swap(true)` → 第二次返回 false → `request_exit` | ✅ |
| 1.5s 兜底仍在 | `lib.rs:55-61`（兜底线程 + 代数校验） | ✅ |
| `app.exit(0)` 唯一调用点 | `grep -rn "app.exit\|process::exit"` → 仅 `menu.rs:171`（`request_exit` 内） | ✅ |

### 4.2 ★ 其它退出路径穷举（Lead 指定攻击面）
| 路径 | 位置 | 是否绕过握手 |
|---|---|---|
| 关窗 X / Alt+F4 / 系统关机 | `lib.rs:100-112` | 否 |
| 菜单「退出」/ Ctrl+Q | `menu.rs:137-141` | 否 |
| 1.5s 兜底 | `lib.rs:55-61` | 后置阶段（握手之后） |
| 系统托盘 | **不存在**（`grep TrayIcon/tray` 零命中） | — |
| 自动更新器 | **不存在**（无 `tauri-plugin-updater`；Cargo.toml 仅 shell/dialog/single-instance） | — |
| `std::process::exit` / `panic=abort` | 零命中；`main.rs` 仅 `run()`；`[profile.release]` 只 `strip = true` | — |
| single-instance 插件 | 回调仅 `cancel_pending_exit + show/unminimize/set_focus`（`lib.rs:74-83`）；退出的是**第二实例自己** | 否 |
| **Ctrl+R / 重新加载** | `menu.rs:143` → `begin_reload_handshake` | **否（R-1 已修）** |
| WebView2 崩溃 / OOM / 外部 taskkill | 无握手机会 | 是（inherent，U7 真机项） |

**结论：除「进程被外部强制终止」外，工作树内没有绕过 flush 握手的退出路径。**

### 4.3 M5 = FIXED / M6 = FIXED
- spawn 成功即刻登记 PID（`sidecar.rs:330`）；`wait_health` 循环顶（:240-242）、spawn 后赛跑（:333-338）、
  崩溃重启 `sleep(1s)` 后（:458-462）均查 `SHUTTING_DOWN`；退出清理优先 `SPAWNED_PID`（:522-527）。
- 强杀前 `is_our_backend_process`（:531-540）；不匹配 → **保守跳过 + 保留 runtime.json**（:536-540）。
- **启动/退出竞态无反例**（推理）：`SHUTTING_DOWN` 在清理**读 PID 之前**置位，而任何 spawn 都是「先登记 PID → 再查 SHUTTING_DOWN」；
  两种交错下要么子进程被 :336 杀掉，要么清理读到它的 PID → 不存在漏杀窗口。

---

## 5. 我发起的 4 条新增缺陷 + 3 条窄竞态（原审查报告均未列）

| ID | 问题 | 状态 |
|---|---|---|
| **R-1** | Ctrl+R 直接 `w.reload()` 绕过 flush 握手；`beforeunload` 只 `void flushPendingAll()` 不等待 | ✅ FIXED（`945179f`） |
| **R-2** | 1.5s 内单实例 `show()` 唤回继续输入 → 兜底仍无条件退出，`CLOSE_REQUESTED` 无 reset | ✅ FIXED（`945179f`）：`CLOSE_GENERATION` + `cancel_pending_exit()` |
| **R-3** | `SPAWNED_PID` 无清零（误杀/漏杀两路）+ 校验失败删 runtime.json → 孤儿永久失明 | ✅ FIXED（`945179f` + `090726f` 补健康失败分支）：三处清零（:336/:373/:442）+ `is_our_backend_process`（命令行 + 父进程）+ 失败保留 runtime.json |
| **R-4** | 重载兜底无守卫 → 每次 Ctrl+R 双重载；第二次重载销毁窄窗内新输入 | ✅ FIXED（`090726f`）：`RELOAD_DONE` |
| **R-4b-1** | `reload_main_window_now` 用 `store` 非严格 once-only | ✅ FIXED（`2795645`）：`if RELOAD_DONE.swap(true) { return }` |
| **R-4b-2** | 新握手清零 `RELOAD_DONE` 会重新武装旧兜底线程 → 双重载 | ✅ FIXED（`2795645`）：`RELOAD_GENERATION` 代数守卫 |

### 5.1 R-4b 复核：两条竞态已闭合，**未发现第三处交错**
`swap` 是单一原子 RMW → 「代数相同 + swap 同时成功」不可能出现（两线程不可能同时读到 false）。
枚举：单次握手（前端回调/兜底先后到达）→ 一次重载；IPC 失败仅兜底 → 一次；1.5s 内二次 Ctrl+R → 旧兜底代数不匹配**放弃**；
(A) 代数先增、(B) 标志后清的顺序下，旧代线程任何时刻醒来都放弃 ✅。
**固有残留（非缺陷）**：任何 reload 都会销毁「flush 完成 → 重载生效」之间（亚毫秒～毫秒级）新产生的输入，
与 close/quit 路径同理，非本轮引入。

### 5.2 R-3 的 PyInstaller 问题（Lead 指定）：判断正确，无反例
`child.pid()` 是 tauri-plugin-shell 直接 `CreateProcess` 出的 onefile bootloader（`tauri.conf.json:34-35`，无 cmd.exe/bat 包装），
其父进程即本 app → 父校验通过 → `taskkill /F /T` 整树杀掉（含真后端孙进程）。
保守分支（进程已退出 / PowerShell 失败 → 判定 false → 跳过强杀）方向安全；`rsplitn(2,'|')` 取最后分隔符，命令行含 `|` 也不错位。

---

## 6. 归因汇总

| 项 | 归因 |
|---|---|
| B2 / B4 / B5 / M4 / M5 / M6 | **FIXED**（本批修复，实测/静态核验通过） |
| R-1 / R-2 / R-3 / R-4 / R-4b-1 / R-4b-2 | **FIXED**（我在独立验证中发现，Lead 分三批修复） |
| U4 `transformCallback` | **FIXED**（根因＝App 菜单 effect 动态 import 缺 `.catch`；9 次运行 0 命中） |
| 组④ RUN3 的 `perf-bench` 越界 + worker 启动超时 | **PRE-EXISTING / 环境**：绝对墙钟门 + fork worker 资源，宿主负载 11–14 所致；非产品缺陷 |
| 组② RUN2/RUN3 6 红 | **非产品**：他人 WIP 文件（`export-acceptance-u2.test.ts` + `__u2debug.test.ts`）中途落地；文件已删 |
| 我的骨架假红（B5 三方同口径、B4 悬挂泄漏/对照死锁） | **我的测试缺陷**，已修 |
| `cargo` 不可用 | 环境限制，非缺陷 |

---

## 7. 未验证项声明（未能验证 + 原因）

| 项 | 原因 |
|---|---|
| `cargo test`（20 passed） | WSL `command -v cargo` 为空、缺 glib/webkit → **无法独立复现**；仅引用 Lead 在 Windows 的结果，附 §0 的 Rust 文件 sha256 供对照 |
| Windows 真机 GUI：Ctrl+Q / 关窗 / 重载 / 崩溃拉起 / 多实例 | 本环境无 Windows GUI 会话（U7）；R-1…R-4b 均为**静态核验 + 交错推理**，未经真机交互验证 |
| M4 端到端（渲染 EditorArea 点导出菜单） | 未做；EditorArea 依赖 Tiptap EditorView，jsdom 渲染成本 + teardown flaky 风险 → **仅 seam + 接线级 PASS**，Lead 在真机补 |
| U4「任意时刻 3/3 干净」 | 组④ RUN3 在宿主高负载下红（perf 门 + worker 超时）；组③/⑤ 3/3 干净。**结论：U4 根因已修，门禁对宿主负载仍敏感（PRE-EXISTING）** |
| B4「已在服务端处理的 PUT」 | `abort()` 无法撤销已到达服务端的请求；未构造真实会话证据 |
| R-2 兜底/cancel 指令级竞态 | 静态推理（cancel 恰好晚于代数比对时仍会退出）；未做并发实测 |

---

# 8. 追加：2026-09-22 UI 落位变更（Tab 栏最顶上 / 源码模式同列 / 滚动条）与复跑

> 触发：用户实测反馈 → `d9c5bac`（Tab 栏落位 + 源码模式列宽 + `.tmp-*`）+ `a1d82b5`（源码 textarea focus 环）。
> 本节由 `verifier-trash` 独立执行；**未修改任何源码**（仅更新我的两个 verify 套件断言）。

## 8.1 冻结锚点（我复算）
| 文件 | sha256 |
|---|---|
| `frontend/src/components/layout/TabBar.tsx` | `1c794825e735fb5bc80cd3ddc03eaaae8dca61575402c0e231e2d9d6e791285f` |
| `frontend/src/components/layout/EditorArea.tsx` | `b713250c8dd536f0f27ed2a7dbcde3a408364a7ae66e3ee2bd8036dba1ee85f0` |
| `frontend/src/components/editor/EditorToolbar.tsx` | `c8e6e7d9cac5efd17a1a217c064cea5355cf5e17081131d8d1a4c47291f2453f` |
| `frontend/src/components/editor/SourceModeView.tsx` | `22aa1a1be9011d17b9617fbd0e4e9113790bd14454f5189a7b2f4e2b350c4536` |
| `frontend/src/components/layout/TabBar.test.tsx`（dev 侧守卫） | `5e411dc9b5cf692e04aaf33601f4990ab83996598f0dad24c8a9db1579ecf20f` |
| `frontend/src/index.css` | `f256e3f37f867aa0a73c660210eecc0bbf8652922f02cbf5ac5546d6d871216a` |
| 我的 `TabBar.verify.test.tsx`（更新后） | `a6c9653aff2647cf64c089d70c12baa6667c164c4654f94dec49c9d7cf11e2e6` |
| 我的 `SourceModeView.verify.test.tsx`（更新后） | `554b21474184b05c35df9bdc0de549756e171984559f88e382de8921bce02ca3` |
| 我的 `plain-export.verify.test.ts`（加超时后） | `c0b9e986cde54eb62a8c886512dda0731b40c87e8e69deca52d240f78340ffa2` |
| HEAD（本轮） | `a1d82b5`；三连跑 B/C 期间 9 个被扫描文件 hash **跑前=跑后**（§8.3） |

## 8.2 我的断言更新（按新架构，**未放宽**）
| 文件 | 变更 |
|---|---|
| `TabBar.verify.test.tsx` | T-5 旧断言「EditorToolbar 应引用 TabBarSlot」→ **拆为两条更严的断言**：① 落位＝`EditorArea` 的 `data-testid="tab-strip"` 内渲染 `<TabBarSlot />`，且 `tab-strip` 源码位置**必须先于 `<EditorToolbar`**（「最顶上」回归守卫）；② `EditorToolbar` **不得**再出现 `TabBarSlot`，且 `\btabBar\b` prop 已移除。**保留 G-2（`onOpenAttachments` 已删）/G-3（「附件」title 已删）** |
| `TabBar.verify.test.tsx` | **新增滚动条守卫**：`overflow-x-auto` 仍须保留（横向可滚动），但必须同时 `overflow-y-hidden` + `[scrollbar-width:none]` + `[&::-webkit-scrollbar]:hidden`（防「仅 overflow-x-auto → 另一轴 auto → 双条叠加」，即用户看到的「移动滑块条」） |
| `SourceModeView.verify.test.tsx` | **新增 C3 布局守卫**：说明条（`source-mode-banner`）与 `source-textarea` 必须带 `max-w-[780px]` + `px-[32px]`；说明条窗口内**不得**再有 `border-b`（用户报的「神秘线条」＝全宽下边框）；并断言 `EditorArea` 页眉 `<article className="mx-auto w-full max-w-[780px] px-[32px]…` 同列宽（三者对齐的来源） |
| `plain-export.verify.test.ts` | E1 全仓扫描加 **20s 显式超时**（非放宽判据，仅防宿主负载下 5s 默认超时假红，见 §8.3 组 A） |

## 8.3 复跑数字（逐次 exit code；被扫描源文件 hash 跑前=跑后）
全量命令：`cd frontend && npx vitest run`

| 组 | 时刻 | RUN1 | RUN2 | RUN3 | 红因（逐条定位） |
|---|---|---|---|---|---|
| **A** | 10:34–10:37 | exit 0 | exit 0 | **exit 1** | 2 红**均为 5s 默认超时**（非断言失败）：我的 `plain-export.verify` E1 全仓扫描 + 既有 `components/common/no-native-dialog.test.ts` 全仓扫描（各读 136 个文件；后者录得 `9867ms`）。**→ 我已给 E1 加 20s 超时**；`no-native-dialog.test.ts` **不在我的写入边界内，未改动**（§8.5） |
| **B** | 10:38–10:40 | exit 0 | **exit 1** | exit 0 | 1 红＝`perf-bench.test.ts` **绝对时间门**：`first=8717ms` vs `gateFirst=8676ms`（**超 0.47%**，`[perf]` 日志原文）——宿主 load avg ≈11.8，**PRE-EXISTING 标定余量过薄** |
| **C** | 10:40–10:43 | **exit 0** | **exit 0** | **exit 0** | 3/3 干净：59 files / **1150 passed + 1 skipped** / 无 FAIL / Unhandled 0（`first=7741–10131ms`，`gateFirst` 同步上浮至 8811–10861ms 故通过）；**9 个被扫描文件 hash 跑前=跑后，确认非移动目标** |

**结论**：本次 UI 落位变更本身**无功能回归**（组 C 3/3 干净；组 A/B 的红分别归因于「既有测试超时余量」与「既有 perf 标定余量」，与落位变更无关）。
**门禁稳定性（更新 §7）**：U4 根因已修；当前 `npx vitest run` 在宿主高负载下有两类 PRE-EXISTING 敏感点：① 全仓同步扫描用例的 5s 默认超时（我的已加超时；`no-native-dialog` 待办）；② `perf-bench` 绝对墙钟门 0.47% 余量。

### 8.3.1 其它实测
```text
$ npx tsc -b --noEmit                          → TSC_EXIT=0
$ npx vitest run <6 个受影响/自有套件>          → 6 files / 122 passed
  TabBar.verify 32 · TabBar.test 22 · SourceModeView.verify 16 · SourceModeView.test 12
  review-fixes.verify 19 · plain-export.verify 21
$ cd backend && python3 -m pytest -q           → 735 passed, 6 skipped in 19.74s（HEAD a1d82b5）
$ python3 -m pytest tests/test_trash_verify.py → 120 passed in 3.46s（task-8 套件无回归，含 .tmp-* 改动后）
```

## 8.4 真机几何复核（Lead 提供的数据）
Lead 实测：`title left=486 / banner left=486 / textarea 文本 left=486`（三者对齐）、`tab-strip top=0 h=36`、`toolbar top=36`、`scrollW == clientW`（无横向溢出）。
**本环境无法独立复现像素级几何**（WSL，无 Windows GUI/布局引擎；happy-dom 无真实 layout）。
我给出的**源码级等价证据**：`tab-strip` 位于 `EditorToolbar` 之前 + `h-9`（36px）；`SourceModeView` 说明条/textarea 与 `EditorArea` 页眉同一 `max-w-[780px] px-[32px]` 列宽；滚动条类名组合见 §8.2。
→ **像素数字引述自 Lead 的真机实测，非我独立复算**（诚实标注）。

## 8.5 待办（非我边界，上报）
1. `frontend/src/components/common/no-native-dialog.test.ts`：每个用例对 136 个文件同步读盘，**默认 5s 超时在高负载下会假红**（实测 9867ms）。建议其 owner 加显式超时（如 20s）或把 `walk` + 读盘结果缓存一次。
2. `frontend/src/editor/perf-bench.test.ts`：`gateFirst = max(常量, calib128×5.5)` 的**标定余量过薄**（实测 0.47% 越界）。建议提高倍数或改为相对基线阈值（PRE-EXISTING，不阻塞本次落位变更）。
3. `EditorToolbar.tsx:5` 注释仍写「标签（由 TabBar 提供）」——Tab 栏已移出工具栏，**注释已过期**（LOW，不影响行为）。
