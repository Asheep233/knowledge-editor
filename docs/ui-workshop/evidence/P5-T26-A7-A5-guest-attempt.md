# P5-T26 A7/A5 尝试记录：真实产品 guest 宿主（**8/11，被 CSP 阻断，未完成**）

- 日期：2026-10-19 · 状态：**未通过（不当 A7/A5 证据）**
- 工具：`tools/run_t26_guest_probe.py`（隔离产品构建 VITE_KE_WORKSHOP=1 + CDP 驱动工坊 UI）
- 原始结果：`evidence/T26-A7-A5-guest-results.json`（8/11，失败项保留）

## 已达成（真实产品壳）

| 检查 | 结果 |
| --- | --- |
| 隔离产品启动 + 安装签名包 / 工坊面板打开 | PASS |
| **community 等级启用 → E_CAPABILITY_TIER 拒绝（能力上限生效）** | PASS |
| **trusted 启用 → guest active + sandbox iframe 渲染** | PASS |
| **会话状态落盘 active（packId/能力子集）** | PASS |
| 停用 → 会话状态持久化 stopped | PASS |
| 主进程存活 / 用户实例不受影响 | PASS |

## 失败根因（重要发现）

- **guest 心跳 0 次**：sandbox iframe `srcdoc` 中的内联脚本被产品 CSP 阻断——
  `tauri.conf.json security.csp: script-src 'self'`（且有 `frame-src 'self' asset:`），
  srcdoc 为非 self 内联脚本 → 脚本不执行 → 无心跳 → 崩溃检测无法触发（A7-5/6 失败）。
- 这证明 ADR-004 中的**回退方案（独立 origin/custom protocol）是必需的**，不能只靠 srcdoc：
  包入口必须由**独立 origin**提供（各自响应 CSP 可定义），父级 `frame-src` 允许该协议。

## 追加修复（保留）

- guestHost 心跳监控增加「从未收到心跳」兜底（避免又一种静默）；组件暴露
  `window.__keGuestHeartbeats` 诊断计数；
- 隔离测试构建同步源码流程修正（此前 test copy 未同步新命令，导致
  `workshop_pack_read_asset not found`；现在构建脚本会先 cp src/*.rs）。

## 后续（A7 收尾方案，已写入 ADR-004 修订）

1. Rust 注册自定义协议 `workshop://`（按 packId/version 解析已安装包文件，限制路径/大小）；
   iframe 使用 `src="workshop://<packId>/<version>/<entry>"`（或 host 映射路径），沙箱仍 `allow-scripts`；
2. 协议响应设置**包文档自身 CSP**（允许包内脚本/样式/资产，限制网络/父窗口访问）；
3. 隔离守卫改为校验 iframe origin 与 `__TAURI_INTERNALS__` 不可达；
4. 重跑 A7/A5 W（启用→active→心跳→崩溃→safeMode→停用持久化）。
