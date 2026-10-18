# P3-T19 证据：包隔离宿主 Windows/WebView2 实机探针（8/8 PASS）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型 `uiws-s1-probe`）**
- 代码：
  - host：`docs/ui-workshop/core/packs/probe/t19_host.ts` —— 真实 `PackageHost`（会话/崩溃策略）
    + 真实 `Broker`/`brokeredHandlers`/`HostDispatcher`，通过 `window.postMessage` JSON 线连接 guest iframe；
  - guest：`probe/t19_guest.ts` —— sandbox iframe 内真实协议 `GuestClient`（握手 + 只读 snapshot）
  - 宿主窗口：`prototypes/p0/s1_runtime/tauri_sandbox/`（Rust setup 打开 t19-render；`run_t19_probe.py` 驱动）
- 原始结果：`evidence/T19-package-host-probe-results.json` · 证据类型：**W（Windows/WebView2 实机）**

## 实测结果：**8/8 PASS**

| 检查 | 结果 |
| --- | --- |
| W-T19-1 Rust setup 打开 t19-render 窗口 | PASS |
| W-T19-2 host+guest 探针完成 | PASS |
| **W-T19-3 PackageHost 会话 active，连接受限** | PASS：role=guest、capabilities=`['context.read']`、context/epoch 绑定、declaredCommands=[] |
| **W-T19-4 guest 经 Broker 完成握手 + 只读 snapshot** | PASS（能力放行，revision=1） |
| **W-T19-5 崩溃未超限 → suspended（可重启）** | PASS（两次均 suspended） |
| **W-T19-6 崩溃超限 → failed** | PASS |
| **W-T19-7 超限触发停用 + recover + safeMode** | PASS（deactivate=1, recover=1, safeMode=true） |
| W-T19-8 真实 WebView2（UA=Edg/155） | PASS |

## 结论

- T19 的**隔离宿主控制面**在 Windows/WebView2 实机成立：包会话装配为受限 Broker 连接（能力/epoch/
  命令白名单），guest 只能经 broker 访问允许方法；崩溃策略（suspended→超限 failed→停用+自动 recover+
  safeMode）真实生效。
- 尚未完成（T19 继续）：
  1. 真实包入口资源加载（manifest entry html/sdk 来自 T17 产品化安装目录，而非探针内联 guest）；
  2. 崩溃信号来自真实 WebView（renderer crash/导航失败/无响应）而非探针显式上报；
  3. 停用/恢复状态持久化与 T20 safeMode UI 联动；Windows 端到端交互 W（安装→启动→崩溃→修复→卸载）。
