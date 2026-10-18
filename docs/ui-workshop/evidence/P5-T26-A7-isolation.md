# P5-T26 A7 安全核对：guest 独立 origin 与 Tauri IPC 可达性 — W 5/5 PASS（附残余风险）

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离测试构建 + workshop 自定义协议）
- 工具：`tools/run_t26_guest_isolation_probe.py`（guest 自报 origin/internals/invoke 行为；
  不依赖父窗口跨域读取）；原始结果：`evidence/T26-A7-isolation-results.json`
- 证据类型：**W（真实产品 WebView2 内 guest 上下文）**

## 实测结果：5/5 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-A7-ISO-1 guest 已启用且 iframe 加载 | PASS |
| **W-T26-A7-ISO-2 guest 自报 origin 为 `http://workshop.localhost`（独立 origin）** | PASS |
| **W-T26-A7-ISO-3 guest 的 Tauri `invoke` 不可用（remote IPC 未生效，1.5s 超时）** | PASS |
| W-T26-A7-ISO-4 主进程存活 | PASS |
| W-T26-A7-ISO-5 用户实例未受影响 | PASS |

guest 自报（关键原文）：
```json
{"origin":"http://workshop.localhost","href":"http://workshop.localhost/com.probe.t26iso/1.0.0/index.html",
 "hasInternals":true,"invokeType":"function","invokeResult":"timeout"}
```

## 结论与残余风险（必须记录）

- ✅ 包入口运行在**独立 origin**（`http://workshop.localhost`），与主窗口 `tauri.localhost` 分离；
- ⚠️ **guest 仍能看到 `window.__TAURI_INTERNALS__` 对象（ADR-001 的 iframe 继承问题在跨域 iframe 中同样存在）**，
  且 `invoke` 是 function；实测从该上下文调用命令 **无响应（timeout）**（Tauri 的 remote IPC 未对
  `workshop.localhost` 生效），即当前不可利用，但这是**实现细节而非保证**——Tauri 升级/配置变化可能
  改变行为。
- 影响：A7/A5 的「隔离成立」应按**受限优先**表述（独立 origin + remote IPC 当前不可用），
  不能宣称「guest 绝对无法访问宿主 API」。
- 后续硬化（T26/T27 必做项）：
  1. guest SDK 启动自检 `__TAURI_INTERNALS__` 存在性，存在则拒绝运行/上报（纵深防御）；
  2. Tauri 配置显式 `dangerousRemoteDomainIpcAccess` 白名单审计 + 自动化回归（升级 Tauri 后复跑本探针）；
  3. 评估独立 `WebviewWindow`（独立 WebView2 profile）作为更高隔离形态（ADR-001 回退方案）。
