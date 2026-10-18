# P5-T26 A2 证据：真实产品壳快照打印（隐藏 renderer + ready 握手）— W 9/9 PASS

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（真实产品壳隔离测试构建 com.astranota.uiws.e2e）**
- 工具：`tools/run_t26_print_probe.py`（CDP `Runtime.evaluate` 调真实 Tauri 命令；不读编辑器 DOM）
- 原始结果：`evidence/T26-A2-print-results.json` · 证据类型：**W（真实产品进程/WebView2/文件系统）**

## 前置修复（W 探针发现的真实缺陷）

1. **`PrintRenderState` 未 `.manage()`**：`print_snapshot_pdf` 命令 State 注入失败
   （`state not managed for field state`）——T16 单元/构建测试无法发现，产品运行时 W 首次暴露；
   已在 `lib.rs` 注册 `.manage(print_snapshot::PrintRenderState::default())`（cargo 38 passed 复验）。
2. **renderer 创建可观测性**：启动创建 renderer 后写 `app_data/print-render-status.json`
   （`{"ok":true|false,"error"}`），不依赖 stderr 控制台（GUI 进程 stderr 不可见）。
3. **测试构建资源嵌入**：测试副本 `frontendDist=../dist-build`（相对路径）→ 资源嵌入二进制、
   页面 origin 为 `http://tauri.localhost`，IPC 可用；`frontendDist` 用绝对路径会导致 file:// origin
   → IPC `Origin header is not a valid URL`（已实证）。

## 实测结果：9/9 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-A2-1 隔离产品实例启动 + WebView2 remote debugging 可用 | PASS |
| W-T26-A2-2 主窗口执行上下文可用（`__TAURI_INTERNALS__.invoke`） | PASS（等待 boot 完成） |
| **W-T26-A2-2b 隐藏打印 renderer 创建成功（状态文件 ok）** | PASS |
| **W-T26-A2-3 快照打印命令返回成功** | PASS |
| **W-T26-A2-4 PDF 生成、%PDF 头、大小合理** | PASS（63,258 bytes，`%PDF`） |
| **W-T26-A2-5 已存在目标 → 拒绝覆盖** | PASS |
| **W-T26-A2-6 非法相对路径 → E_PATH 拒绝** | PASS |
| **W-T26-A2-7 ready 握手生效（无 E_PRINT_RENDER_TIMEOUT 兜底）** | PASS |
| **W-T26-A2-8 用户运行中的 AstraNota 未受影响（PID 存在）** | PASS |

## 事件记录（必须透明）

- 首版 runner 的清理逻辑误用 `taskkill /F /IM knowledgeeditor.exe`，**误杀了用户运行中的 AstraNota
  （原 PID 69108）**；已即时修复清理规则（只按 Popen PID 终止测试进程 + sidecar 仅按
  `F:\Work\Dev\cargo-target\*` 路径白名单清理），并重启用户 App（当前 PID 82360，主窗口正常、
  后端已拉起）。T26 工具文档已写入红线：**禁止按镜像名杀进程**。
- 该事件不影响用户磁盘数据（App 自动保存；重启后正常），但属于操作事故，后续所有脚本必须按 PID/
  路径白名单清理。

## 结论

- T26 计划 **A2 场景完成**（真实产品壳、隔离环境、可复现）：隐藏 renderer 创建、ready 握手真实生效、
  快照打印产出有效 PDF、路径安全与不覆盖生效、用户实例不受影响。
- 下一步：A3 启动 recover/safeMode（产品级预置损坏包）、A4/A6 签名安装与安装回滚卸载（CDP 驱动工坊
  或预置包状态）、A5/A7/A8。
