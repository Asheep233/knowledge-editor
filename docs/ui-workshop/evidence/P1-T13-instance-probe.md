# P1-T13 证据：单实例 + 退出协调（Windows 实机 6/6 PASS）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型 `uiws-s1-probe`）**
- 代码：
  - 原型 Rust 主壳：`docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/src/main.rs`
    - 接入 `tauri-plugin-single-instance`：第二实例启动 → 第一实例记录 `second-instance-detected`
      并聚焦主窗 → 第二实例立即退出；
    - **RunEvent 退出协调**：`ExitRequested` → `exit-requested` 事件 + `exit-requested.json`；
      `Exit` → `exit.json`（供产品化 T20 的退出协调/清理使用）
  - 驱动：`prototypes/p0/s1_runtime/run_instance_probe.py`（Windows Python；两次启动 + WM_CLOSE）
- 原始结果：`evidence/T13-instance-probe-results.json` · 证据类型：**W（Windows 实机）**

## 实测结果：**6/6 PASS**

| 检查 | 结果 |
| --- | --- |
| W-T13I-1 实例 1 启动并完成 boot | PASS |
| W-T13I-2 第二实例立即退出（单实例生效） | PASS（exit 0） |
| W-T13I-3 实例 1 收到 `second-instance-detected` 事件 | PASS |
| W-T13I-4 实例 1 仍在运行（未被第二实例影响） | PASS |
| W-T13I-5 WM_CLOSE 后进程干净退出 | PASS（exit 0） |
| W-T13I-6 退出协调标记落盘（ExitRequested + Exit） | PASS（`exit-requested.json`、`exit.json`） |

## 附带修复（原型工程）

- 发现 `.build(..)` 后漏接 `.run(..)` 事件循环 → 应用启动即退出（本次单实例探针调试中暴露并修复）；
  RunEvent 退出协调因此同时接上。该坑记录进 GAP 清单，产品壳启动时必须显式 run event loop。

## 结论

- T13 门禁中「单实例 / 退出协调」项在 Windows 实机成立：单实例互斥、第二实例路由事件、
  WM_CLOSE 优雅退出并落协调标记。
- T13 剩余未覆盖项：打印 job 与取消（T16 产品化）、Rust 原生恢复（T20）、恶意/故障场景与产品
  工作区打开流程合并验证（T18 W 已部分覆盖）。
