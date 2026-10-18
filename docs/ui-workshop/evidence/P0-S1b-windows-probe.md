# P0-S1b 证据：child WebviewWindow 运行域对照（Windows/WebView2）+ 命令守卫原型

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155.0.0.0（Tauri v2 原型 app）**
- 代码：`docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/`（在 S1 原型上扩展）
  - 两个 guest 窗口由 **Rust setup（主线程）** 创建（命令线程同步创建窗口会死锁 → 已记录为原型踩坑）：
    - `guest-same-origin`：`WebviewUrl::App("guest-same.html")` → 来源 `http://tauri.localhost`（与宿主同源）
    - `guest-custom-origin`：`WebviewUrl::External("http://127.0.0.1:8123/guest-iso.html")` → 独立来源（runner 内置静态页服务）
  - 命令面新增：`whoami`、`unguarded_guest_write`（故意无守卫）、`sensitive_probe`（**按 webview label 守卫**）、
    `report_guest_result`、`debug_log`
- 驱动：`prototypes/p0/s1_runtime/run_s1_windows_probe.py`（隔离后端 8101 + guest 页服务 8123 + 回调服务 8122）
- 原始结果：`evidence/P0-S1-windows-probe-results.json`（**10/10 断言通过**）

## 实测结果

| 检查 | 结果 |
| --- | --- |
| W1 Rust setup 成功创建两个 guest WebviewWindow | **PASS**（events.log 记录 opened by rust setup） |
| W2 同源 guest 可执行 app 命令 | **PASS**：`whoami` 返回 `guest-same-origin`（按调用方 webview 绑定 label） |
| W3 同源 guest 可调用**未守卫**写命令 | **PASS（发现）**：`unguarded_guest_write` 成功写文件 → **app 命令默认对所有 webview 可见** |
| W4 同源 guest 调用**受守卫**命令被拒 | **PASS（守卫原型生效）**：`error:E_FORBIDDEN_WEBVIEW:guest-same-origin` |
| W5 同源 guest 直连后端 loopback | **PASS（风险发现）**：`fetch http://127.0.0.1:8101/api/health` → `ok:200`（同源=CORS 允许来源） |
| W6 独立来源 guest 经本机回调上报 | **PASS**：收到 `origin=http://127.0.0.1:8123` 的完整上报 |
| W7 独立来源 guest 调 app 命令被拒 | **PASS**：`error:Command whoami not allowed by ACL` |
| W8 独立来源 guest 调未守卫写命令也被拒 | **PASS**：同样 ACL 拒绝 → 无法触达命令面 |
| W9 独立来源 guest 对后端 loopback 请求被拒 | **PASS**：`blocked:TypeError`（CORS：来源不在允许集合） |
| W10 无后端/宿主文件副作用 | **PASS** |

## 结论（供 T07 ADR / T18 设计）

1. **child WebviewWindow 可以作为运行域**：独立来源窗口默认被 Tauri ACL 拒绝 app 命令（`Command ... not allowed by ACL`），
   且后端 CORS 拒绝其 loopback 访问 —— 这是与 iframe（继承 IPC globals、需靠 Origin 校验）不同层级的边界。
2. **同源 guest 窗口不可用于不受信包**：app 命令全局可达（W3 实证）、且可直连后端 loopback（W5 实证）。
   → 包运行域必须**跨源**（custom protocol 或本地独立来源），并且后端需按来源收紧（不能只靠 CORS 默认值）。
3. **label 守卫可作为 defense-in-depth**：`sensitive_probe` 按 `webview.label()` 拒绝非 main 调用（W4），
   与 ACL/来源策略叠加；但不应作为唯一防线。
4. **工程坑**：在 Tauri command handler 中同步 `WebviewWindowBuilder::build()` 会死锁（窗口能出现但调用永不返回）；
   窗口应在 `setup` 或显式主线程调度中创建（本原型改为 Rust setup 创建）。
5. **仍需验证**：ACL 精确配置（capability 文件按窗口 scoping、guest 窗口不授任何 core/plugin 权限）、
   自定义协议来源（离线包资源）与 `dangerousRemoteDomainIpcAccess` 的边界、多窗口关闭/单实例/菜单/打印路由（T20/T21）。

## 原始输出摘要

```text
same guest: {"origin":"http://tauri.localhost","href":"http://tauri.localhost/guest-same.html",
  "tauriInternals":"object","tauriGlobal":"object",
  "whoami":"guest-same-origin",
  "unguarded":"C:\\ke-tmp\\uiws-s1-windows-probe\\probe-windows\\guest-unguarded-write.json",
  "sensitive":"error:E_FORBIDDEN_WEBVIEW:guest-same-origin",
  "fetchBackend":"ok:200"}
iso callback: [{"origin":"http://127.0.0.1:8123",
  "whoami":"error:Command whoami not allowed by ACL",
  "unguarded":"error:Command unguarded_guest_write not allowed by ACL",
  "fetchBackend":"blocked:TypeError"}]
SUMMARY 10/10 PASS
```
