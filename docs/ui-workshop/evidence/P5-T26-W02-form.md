# P5-T26 W02 证据：产品表单交接（title/tags 经 Broker → 宿主原子写 meta）+ 停用后迟到请求 / 旧连接失效 — 产品 W 12/12 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2
- 构建：隔离产品测试构建 `C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256 前缀 `be2582adbaedafa9`，identifier `com.astranota.uiws.e2e`），隔离 APPDATA/工作区 + workshop 签名包 + CDP
- 工具：`tools/run_t26_form_probe.py`（真实产品 + 真实 SDK `GuestClient` 的 W02 探针包）；guest 源码 `core/packs/probe/w02_guest.ts`（`bash core/packs/probe/build_w02_probe.sh` 重建 bundle）
- 复现命令：
  `python docs/ui-workshop/tools/run_t26_form_probe.py`（Windows Python，隔离环境见脚本头部）
- 原始结果：`evidence/T26-W02-form-results.json`（attempt 1/2 即通过）· 证据类型：**W（产品壳 12/12）**，关联 U（`formHandoff` 状态机 6/6，见 commit 9350eb1）

## 实测结果：12/12 PASS（一次运行，无重试）

| 检查 | 结果 |
| --- | --- |
| W-T26-W02-1 安装签名包 | PASS |
| W-T26-W02-2 guest 握手（`ui.shell`/`context.read`） | PASS |
| **W-T26-W02-3 guest 经 Broker `command.invoke` 提交 title 成功** | PASS（返回 `{relPath,title:W02 交接标题,tags:[]}`） |
| **W-T26-W02-4 宿主后端原子写生效（frontmatter title 更新）** | PASS（`title: W02 交接标题`） |
| **W-T26-W02-4b guest 提交 tags 成功且后端落盘** | PASS（`tags: [w02, 交接]`） |
| **W-T26-W02-5 未知命令被拒绝（E_COMMAND_NOT_ALLOWED）** | PASS（宿主 manifest 白名单，`article.delete` 拒绝） |
| W-T26-W02-6 收到 guest 中间回报 `w02-guest-pre`（停用前 title/tags/未知命令已完成） | PASS（pre 内附冻结的迟到命令请求） |
| W-T26-W02-7 停用前会话 active（旧连接仍在服务） | PASS（`state=active`） |
| W-T26-W02-8 停用 guest 生效：会话状态 stopped + guest iframe 已卸载 | PASS（`active→stopped`，guest iframe 1→0，body 显示 `guest：stopped`） |
| **W-T26-W02-9 停用后重放的迟到请求被丢弃（旧连接失效；重放验证）** | PASS（迟到 wire 请求按原定 T+3s（实测 preAt+3001ms）重放；`requestId` 一致；无响应/超时（dispatcher 已关闭），无 `w02-guest-done`；会话保持 stopped） |
| **W-T26-W02-10 磁盘 frontmatter 不含迟到标题（迟到请求未落盘，原 title/tags 保留）** | PASS（`late_title_present=false`，`title: W02 交接标题` / `tags: [w02, 交接]` 不变） |
| W-T26-W02-11 主进程存活 / 用户实例未运行（N/A）/ 无残留 guest 会话 | PASS（主进程存活=1、用户 `D:\AstraNota` 实例未运行、safeMode 横幅无、会话 stopped；运行结束 cleanup 后 knowledgeeditor 进程 0 残留） |

## 本扩展新增语义：停用后迟到请求 / 旧连接失效（如实说明）

1. **实现事实**：guest 在完成 title/tags/未知命令后，先 post 中间回报 `{phase:'w02-guest-pre'}`，其中附带它冻结的迟到命令原始 wire 请求（`requestId/method/params`，标题「W02 迟到标题」）。
2. **产品真实行为**：点击「停用 guest」→ `WorkshopGuestFrame.stop()` 执行 `setEntries(null)`，**guest iframe 被卸载、guest realm 被销毁**。因此 **guest 本体在停用后无法继续存活/自己发命令**（运行中 `phases_after=[w02-guest-pre]`，未出现 `w02-guest-done`，可佐证 realm 已销毁）。
3. **因此本项采用重放验证旧连接失效**：探针在停用确认生效（会话 `stopped` + iframe 已卸载）后，按 guest 原定 T+3s，把 guest 在 pre 中冻结的迟到 wire 请求通过 `window.postMessage` 在宿主窗口**重放**。该注入属于**测试工具（CDP 脚本）注入，不是 guest 通道**，也不是 guest 停用后仍存活自己发请求。
4. **宿主观测**：停用时该 guest 连接的 `HostDispatcher` 已 `close()`（React effect 清理随 iframe 卸载执行），迟到 wire 请求无订阅者 → 被丢弃（无响应/超时 closed 语义），后端 meta 未被写入。
5. **结论（限定表述）**：**停用后到达的迟到请求不会被执行、不会落盘（旧连接失效）**；本证据**不**表示「guest 停用后仍存活」或「guest 自己发出的迟到命令被拒绝」。guest 侧 `lateError/lateResult` 回报路径在停用场景不成立（realm 销毁），若停用未生效（iframe 存活）才会真实发出并记录——本次未发生。

## 实现

- 产品 host `ProductBrokerBackend.invokeCommand` → `createArticleMetaCommandHandler` 白名单：
  - 合法命令名（`article.set-title` / `article.set-tags`）、路径校验（`Articles/**.md`、禁 `..`）、标题/标签参数校验；
  - 宿主经后端 `PUT /api/articles/{rel}/meta` **原子写**，返回 `{relPath,title,tags}`；
  - 未知命令 → `E_COMMAND_NOT_ALLOWED`（Broker 包装为 E_INTERNAL 但原因保留）。
- 停用/旧连接失效：`GuestSessionHost.stop()` → `PackageHost.stop()`（会话 stopped、连接清理）→ UI `setEntries(null)` 卸载 iframe → `HostDispatcher.close()` 注销 wire 监听；`workshop-session-status.json` 落盘 stopped。
- 探针：主页面注入 `window.addEventListener('message', ...)` **数组**收集全部 `t19-guest-results`（组件只写会被覆盖的 `window.__keGuestResults`），故能拿到 `w02-guest-pre` 中间回报；失败时输出 `diag-*.json`（body 尾/按钮/消息数组/timer 状态）。

## 环境说明（记录，不计为产品缺陷）

- 09:08 的基线运行（旧探针）在 check 6 处 CDP WebSocket 断开；`app.log` 显示窗口异常关闭，疑似同时段其它探针/清理窗口按 `C:\ke-tmp\uiws-t26\bin\*` Stop-Process 误杀本 app，属**并发窗口冲突**，非产品缺陷。
- 正式证据取自 Lead 串行调度的隔离窗口：attempt 1 即 12/12，无重试（`attempts=1`）。

## W02 剩余未覆盖

- 公式/重命名草稿的跨 UI 交接、对话框/候选启动失败等其它 W02 子场景；
- 提交后官方编辑器 UI/标签页的状态同步（当前后端 meta 已更新，UI 刷新语义未验证）；
- IME 组字交接与官方表单集成（需真实 UI 交互 W / 人工验收）。
