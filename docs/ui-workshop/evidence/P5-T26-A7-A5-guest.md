# P5-T26 A7/A5 证据：真实产品壳 guest 宿主（独立 origin + 能力上限 + 崩溃/safeMode）— W 11/11 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2 155（隔离测试构建 com.astranota.uiws.e2e）
- 工具：`tools/run_t26_guest_probe.py`（CDP 驱动真实工坊 UI；隔离 APPDATA/工作区/签名包；
  当前源码 PyInstaller sidecar）
- 原始结果：`evidence/T26-A7-A5-guest-results.json` · 证据类型：**W（真实产品 UI/自定义协议/命令/文件）**

## 实测结果：11/11 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-A7/A5-1 隔离产品启动并安装签名包 | PASS |
| W-T26-A7/A5-2 工坊面板打开（真实已安装包） | PASS |
| **W-T26-A5-1 community 等级启用 → E_CAPABILITY_TIER 拒绝（能力上限运行时生效）** | PASS |
| **W-T26-A7/A5-3 trusted 启用 → guest active + sandbox iframe** | PASS |
| **W-T26-A7/A5-4 会话状态落盘 active（packId/能力子集）** | PASS |
| **W-T26-A7/A5-5a guest 心跳到达宿主（自定义协议 origin + postMessage）** | PASS |
| **W-T26-A7/A5-5 心跳中断自动检测 → 超限 failed** | PASS |
| **W-T26-A7/A5-6 safeMode 提示出现（guest 禁用）** | PASS |
| **W-T26-A7/A5-7 停用 guest → 会话状态持久化 stopped** | PASS |
| W-T26-A7/A5-8 主进程存活 | PASS |
| W-T26-A7/A5-9 用户运行中的 AstraNota 未受影响 | PASS |

## 关键实现（本轮新增/修复）

1. **`workshop://` 自定义协议**（`workshop_protocol.rs`）：Windows 映射 `http://workshop.localhost/…`，
   按 `/<packId>/<version>/<rel>` 解析已安装包文件；路径穿越/绝对路径拒绝、10MB 上限、
   包文档响应自带 CSP（允许包内联脚本/样式/同源资产，`connect-src 'none'`，`frame-ancestors` 限定
   主窗口）→ **解决 A7 首跑 CSP 阻断 srcdoc 脚本问题**；tauri.conf `frame-src` 增加
   `http://workshop.localhost`；Rust API 单测 3 例（cargo **44 passed**）。
2. **前端 guest 宿主**：`ProductHostBackend.entryUrl()` 生成 workshop URL，iframe 优先 `src`（独立
   origin），回退 `srcDoc`；`GuestSessionHost` 返回 entryUrl。
3. **状态机修复**：`deactivate` 不再写 `stopped`（避免覆盖 failed/safeMode）；failed 时同步 safeMode
   横幅；停用按钮在 failed 后仍可用（停止并持久化 stopped）。
4. 隔离测试流程：源码/tauri.conf 同步到测试副本（identifier/productName/frontendDist 覆盖）。

## 结论

- **A7（产品侧包隔离宿主）与 A5（能力上限运行时）完成**：真实产品壳可安装/启用签名包，guest 在
  独立 origin 受限会话运行，能力按 T24 信任等级强制，崩溃心跳检测→failed→safeMode→停用持久化闭环。
- T26 剩余：真实 OS 中文 IME/多 DPI（T15/T26 专项）、安装包升级/回滚演练（T27）、
  minor：真实 renderer process crash 注入方式/子资源完整性（后续迭代）。T26 仍未最终认证（不冒进）。
