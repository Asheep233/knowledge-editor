# P5-T26 W07 证据（部分）：guest 无限循环故障 — 宿主独立可恢复，W 8/8 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建 + workshop 协议 guest）
- 工具：`tools/run_t26_fault_probe.py`（故障包：guest 600ms 后进入 60s busy loop；隔离环境 +
  预置 app_config/settings 自动打开工作区）；原始结果：`evidence/T26-W07-fault-results.json`
- 证据类型：**W（真实产品客/宿主进程行为）**

## 实测结果：8/8 PASS（无限循环类别）

| 检查 | 结果 |
| --- | --- |
| W-T26-W07-1 安装故障签名包 | PASS |
| W-T26-W07-2 guest 已启用（active） | PASS |
| **W-T26-W07-3 guest 无限循环后宿主 IPC 仍可响应** | PASS（**未被 guest 阻塞**） |
| **W-T26-W07-4 心跳中断被检测（会话 suspended）** | PASS |
| **W-T26-W07-5 连续故障超限 → failed + safeMode UI** | PASS |
| **W-T26-W07-5b 停用 → stopped 持久化（恢复操作可用）** | PASS |
| **W-T26-W07-5c 宿主进程存活、无崩溃** | PASS |
| W-T26-W07-6 用户实例未受影响 | PASS |

## 结论

- **重要正面发现**：跨域 sandbox iframe 的 guest busy loop **未阻塞宿主渲染进程**
  （WebView2 将该 iframe 置于独立 renderer/进程），宿主心跳检测可继续运行 → 检测
  suspended → 连续超限 failed + safeMode → 停用持久化。**W07 的「无限循环」故障类别通过**。
- 但仍属 **W07 部分通过**：CPU/内存压力、boot crash、桥接超时、连续启动失败、**原生 Rust 恢复
  + I 门禁**未验证；且本探针依赖 guest 与宿主不同进程的实现细节，Tauri/WebView2 升级需复跑。
- 前次失败尝试记录保留：`P5-T26-W07-fault-attempt.md`（环境问题修正：预置 app_config/settings）。
