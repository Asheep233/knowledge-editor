# P0-S1 原型证据：sandbox iframe + MessagePort + 命令面/来源边界 + Rust 原生恢复

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155.0.0.0（Edge Chromium）**，真实 Tauri v2 原型 app
- 代码：
  - 宿主：`docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/`（迷你 Tauri app，**非产品代码**）
  - 驱动：`docs/ui-workshop/prototypes/p0/s1_runtime/run_s1_probe.py`（Windows Python：起隔离后端 + 跑 app + 断言）
  - 原始结果：`docs/ui-workshop/evidence/P0-S1-probe-results.json`（25 项检查，23 PASS / 2 FAIL=发现的约束）
- 证据类型：**W（Windows Tauri/WebView2 实机）**；后端为隔离临时工作区（`C:\ke-tmp\uiws-s1-probe`），未触碰用户笔记

## 原型做了什么

1. 迷你 Tauri 宿主窗口（独立 identifier `com.astranota.uiws.s1probe`，独立 WebView2 user data，不与用户 App 冲突），
   暴露唯一命令面：`boot_state / report_results / mark_healthy / crash_now / recover_to_official / guest_write_probe / exit_probe`。
2. 宿主页创建 **sandbox iframe**（`sandbox="allow-scripts"`，srcdoc → opaque origin）作为 guest，通过 **MessageChannel**
   传递 port 完成握手；guest 在真实 WebView2 中执行以下探测：
   - `__TAURI_INTERNALS__` / `__TAURI__` 可见性；尝试真实 invoke `boot_state` / `guest_write_probe`；
   - `parent.document` / `top.document` 访问；`top.location` 导航；`window.open`；
   - Worker 创建；对后端 loopback `GET /api/health`、`POST /api/articles`、宿主源 `fetch`；
   - WebSocket 连接尝试；`<a download>` 下载尝试。
3. **同源对照实验**：再建一个 `sandbox="allow-scripts allow-same-origin"` iframe（同源 guest），尝试调用同一命令面。
4. **Rust 原生恢复**：`bootPending`（坏启动标记）→ 连续 2 次启动失败由 Rust 判定进入 **safe mode**
   （写 `safe-mode.json`/`events.log`，不依赖 guest JS）→ 宿主从 safe mode 显式 `recover_to_official`。
   通过真实进程崩溃（写入 bootPending 后 `process::exit(99)`）驱动，非 JS 定时器。

## 关键结果（实际输出摘要）

| 检查 | 结果 |
| --- | --- |
| 宿主 Tauri IPC 可用 / 后端 health 可访问 | **PASS**（`invokeOkay=True`、`fetchBackend=ok:200`） |
| guest 访问 parent/top DOM | **PASS（被拒）**：均为 `SecurityError` |
| guest 导航宿主顶层 / popup | **PASS（被拒）**：`topNav=SecurityError`、`popup=null` |
| guest 跨源 fetch（后端 health/写、宿主源） | **PASS（被拒）**：均 `blocked:TypeError`（CORS/来源校验生效） |
| guest 写请求副作用 | **PASS**：后端未创建 `guest-should-fail.md` |
| guest 下载尝试 | 记录 `attempted`（sandbox 下载阻止未单独断言 → 部分证据） |
| guest WebSocket | `error`（记录尝试；因后端非 WS 服务，隔离结论不充分 → 限制） |
| **guest 无 Tauri IPC** | **FAIL（发现约束）**：`__TAURI_INTERNALS__` / `__TAURI__` 在 iframe 内**可见**（iframe 继承 webview 的初始化脚本） |
| **guest 无法调用宿主命令** | **PASS**：opaque origin 的 invoke 被 Tauri 拒绝：`Origin header is not a valid URL` |
| **同源 iframe 对照** | **PASS（证明边界是 Origin）**：`allow-same-origin` guest 的 invoke **成功**（`CALLABLE:…guest-call.json`），即使 `location.origin` 显示 `null`/`about:srcdoc`；说明有效 Origin 继承后 IPC 放行 |
| Rust 崩溃循环 → safe mode | **PASS**：两次 `exit 99` 后第三次启动 `fails=2` 且 `safe_mode=true`（safe-mode.json `by=rust`） |
| safe mode 显式恢复 | **PASS**：写 `recovered.json`（`by=rust-safe-mode, to=official`），`bootPending` 清除，`events.log` 记录全过程 |
| 恢复后健康标记 | **PASS**：正常路径 `mark_healthy` 后 `bootPending` 清除 |

原始 JSON：`P0-S1-probe-results.json`（含 `raw` 各阶段结果与 `findings`）。

## 结论（供 T07 ADR 使用）

1. **iframe 可以作为「周边 UI 的渲染沙箱」但绝不能作为「安全边界」**：它确实提供 DOM/跨源网络隔离，
   但继承宿主 webview 的 Tauri 初始化脚本；只要 guest 有效 Origin 与宿主同源（如 `allow-same-origin`
   或由同一 custom protocol 提供资源），就能调用宿主全部命令面（实证 `CALLABLE`）。
2. **可行约束**：guest 必须始终是**跨源**且不带 `allow-same-origin`（opaque origin），Tauri 的 Origin 校验当前会拒绝其 IPC；
   但“依赖 Tauri 对 opaque origin 的拒绝”属于**安全边界依赖库实现**，不应作为唯一防线。
3. **推荐路线（待进一步原型）**：包运行时使用**独立 WebviewWindow（各自 capability/ACL，仅暴露 broker 能力、不给 app 命令）**，
   而不是同 webview 内 iframe；若坚持 iframe，必须叠加宿主侧命令白名单/来源绑定与 guest 资源独立来源。
4. **Rust 原生恢复可行**：bootPending + 失败计数 + safe mode + 显式恢复的状态机在真实 Windows/Tauri 进程崩溃下工作；
   下一步把它接入产品壳（T20）。

## 限制 / 未验证

- WebSocket 隔离结论不充分（后端非 WS 服务，仅记录 `error`）；下载阻止未做浏览器级断言。
- 未测 WebView2 多窗口/child webview 的权限继承与 ACL 精确匹配（下一步 T02b 原型）。
- 未测 iframe 死循环对宿主 renderer 的影响（iframe 与宿主同 renderer；进程级隔离不成立）。
- Rust 恢复目前是原型 app 内实现，未接入产品壳的窗口生命周期/单实例/菜单路由。
