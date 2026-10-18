# ADR-001 首发运行域与架构路线（P0 结论）

- 决策 ID / 日期：ADR-001 / 2026-10-19
- 待解决问题：UI 包（guest）在哪个运行域执行？官方编辑面/打印面/包事务如何与 guest 隔离？
- 证据：`evidence/P0-S1-prototype.md`、`evidence/P0-S1b-windows-probe.md`、`evidence/P0-S2-prototype.md`、
  `evidence/P0-S4-prototype.md`、`P0-S1*-results.json`、`P0-S2-probe-results.json`、`P0-S4-probe-results.json`
  （全部为 **Windows 11 + WebView2 155** 实机运行结果；脚本与原型可复跑）
- 平台/版本：Windows 11、Tauri v2、WebView2 155、Node 24、Python 3.14

## 实际证据摘要

| 原型 | 关键实测 |
| --- | --- |
| S1 iframe（opaque origin） | parent/top DOM 访问=SecurityError；顶层导航/popup 被拒；跨源 fetch（后端/宿主）全 blocked；写请求零副作用；**opaque origin 的 Tauri invoke 被拒**（`Origin header is not a valid URL`）；**但 iframe 内 `__TAURI_INTERNALS__`/`__TAURI__` 可见**（继承初始化脚本） |
| S1 同源 iframe 对照 | `allow-same-origin` 的 iframe **invoke 成功**（`CALLABLE`）→ 隔离边界是 **Origin 校验**，不是 iframe 元素 |
| S1b 同源 WebviewWindow | app 命令全局可达（可按 webview label 绑定）；可直连后端 loopback（CORS 放行同源）→ 同源 guest 窗口不可用于不受信包 |
| S1b 独立来源 WebviewWindow | Tauri 默认 ACL 拒绝 app 命令（`Command ... not allowed by ACL`）；后端 CORS 拒绝 loopback；零副作用 |
| S1 Rust 恢复 | 坏启动崩溃×2 → Rust safe mode（状态文件/事件日志）→ 显式恢复；真实 `process::exit(99)` 驱动 |
| S2 持续编辑面 | 只移动 `view.dom` 换 shell：EditorView 身份、正文、undo/redo、焦点、synthetic composition、源码草稿均保持（WebView2 实测） |
| S4 独立打印 | 指定窗口渲染内存快照（含未保存内容+KaTeX）→ `PrintToPdf` 真实 PDF（90,002B/1 页，文本含未保存标记与公式）；源笔记 sha256 不变 |

## 决策

1. **首发运行域：iframe + MessagePort（shell 渲染域），强制 opaque origin。**
   guest 包 HTML 只能以 `srcdoc`/`blob:` 注入（`sandbox="allow-scripts"`，**禁止** `allow-same-origin`），
   包资源**不得**由 app 同源（`http://tauri.localhost`）提供；否则同源 iframe 可直接调用全部 app 命令（S1 对照实证）。
2. **后备路线：独立来源 WebviewWindow（ACL 默认拒绝 app 命令）**，用于需要更强隔离/独立资源的包或 iframe
   约束无法保证时的受信实验包；代价是多窗口体验，必须显式说明（不允许悄悄替换单窗承诺）。
3. **命令面（app commands）不是安全边界**：所有命令默认注册在 app 级且对 webview 可见；必须叠加：
   - guest 的 IPC 只经 Origin 校验阻断（当前 Tauri 行为，作为一层，不作为唯一防线）；
   - 宿主侧 **broker 连接身份**（包 id/激活代次/workspace/session/expectedRevision 由宿主绑定，见 T18）；
   - 每个敏感命令校验调用方 webview label（S1b 守卫原型 `E_FORBIDDEN_WEBVIEW` 已实证）；
   - 后端 Origin 白名单只含宿主 origin（`KE_CORS_ORIGINS` 收紧），guest CORS 全 blocked（S1/S1b 实证）。
4. **官方编辑面：常驻主 webview 的矩形视口**，持有真实 EditorView/history/源码 DOM；换 shell 时**只移动 DOM**
   （S2 实证身份/history 保持），不重建编辑器、不 setContent 冒充。
5. **打印面：独立只读 renderer 窗口 + Rust PrintToPdf**（S4 实证），读取指定 revision 的可信快照（含未保存内容），
   不隐式保存、不覆盖已有文件、输出在工作区之外。
6. **原生恢复：Rust 持有 bootPending/失败计数/safe mode/显式恢复**（S1 实证），不依赖 guest JS。
7. **包/状态事务：单提交点 active.json + journal + 不可变包目录**（S5 原型实证），与 T17–T19 产品化对齐。

## 被拒方案与限制

- **同源 iframe / 同源 guest 窗口**：已实证可调用全部 app 命令、可直连后端 → 禁止用于不受信包。
- **仅靠「未给 capability」宣称隔离**：app 命令不受 capability 约束（S1b 实证），不成立。
- **iframe 作为进程隔离**：不成立（iframe 与宿主同 renderer；死循环影响未测）。
- **任意第三方编辑器**：不在首发（另开 adapter 认证）；首发仅自由周边 UI + 常驻官方编辑面。
- **Linux Chromium 代替 Windows**：不成立；本 ADR 的证据均来自 Windows WebView2。

## 进入下一阶段的门槛（P0 → P1）

- 已满足：T00 测量底座/基线台账；T01 功能矩阵（130 行，含宿主服务/命令/面板/工坊任务映射 + fixtures + 失败台账）；
  S1/S1b/S2/S3/S4/S5 可复现原型（Windows 实机证据）。
- 仍为 `in_progress`（P1–P3 继续）：T02 精确 capability/自定义协议来源实验；T03 产品 NodeViews/MathLive/真实 IME；
  T04/T06 接入真实后端与运行时；T05→T16 打印产品化。T07 的「首发路线成立」结论已由本 ADR 给出。
- 进入 P1：T08 codec → T09 WorkspaceContext/CAS → T10 Core/SaveCoordinator → T11 协议 → T12 分域迁移 → T13 门槛。

## 回滚方式

- 若后续 Windows 证据推翻上述结论（例如 iframe Origin 校验在目标 WebView2 版本失效，或定制协议来源不可行），
  回退到「独立来源 WebviewWindow」路线（S1b 证据已具备），并在新 ADR 更新体验取舍与 T07 结论。
