# P5-T26 W06 证据：guest 执行/网络边界 — 产品 W 8/8 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2 155（隔离产品构建；workshop 协议 origin）
- 工具：`tools/run_t26_boundary_probe.py`（签名包内 guest 脚本实测 fetch/worker/WebSocket/越权；
  真实加载来源下验证，不依赖 CORS/CSP 文本声明）
- 原始结果：`evidence/T26-W06-boundary-results.json` · 证据类型：**W（真实产品 guest 执行环境）**

## 实测结果：8/8 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-W06-1 安装签名包 | PASS |
| W-T26-W06-2 guest origin `http://workshop.localhost` | PASS |
| **W-T26-W06-3 fetch 相对/loopback/外部均被阻断（CSP connect-src 'none'）** | PASS（3/3 blocked） |
| **W-T26-W06-4 worker/blob 被阻断（功能级：worker 无执行）** | PASS |
| **W-T26-W06-5 WebSocket 被阻断（功能级：ws-error）** | PASS |
| **W-T26-W06-6 越权 context.write 被 Capability 拒绝（E_CAPABILITY）** | PASS（granted=[ui.shell,context.read]） |
| W-T26-W06-7 主进程存活 / W-T26-W06-8 用户实例未受影响 | PASS |

## 说明

- 网络边界来自包文档 CSP（`connect-src 'none'`、默认 `default-src 'none'` → worker 也被阻断），
  并在真实 guest 内以**功能级**验证（worker 未执行、WebSocket 未连接），不是只看 CSP 文本；
- 越权方法经 host Broker 能力过滤拒绝（`E_CAPABILITY`，details 给出 required/granted）；
- guest 仍可见 `__TAURI_INTERNALS__`（残余风险，见 `P5-T26-A7-isolation.md`），但 IPC invoke 不可用；
- 剩余（W06 未完成项）：导航/下载/伪造消息的系统化测试、loopback 资源（img/font）白名单验证、
  Tauri 升级后边界回归（已列入里程碑 NOT_RUN 子项）。
