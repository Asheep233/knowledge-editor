# P3-T19 升级证据 2：多资源包 + 心跳真实崩溃检测 — Windows/WebView2 8/8 PASS

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型 `uiws-s1-probe`）**
- 代码：
  - guest `t19_guest.ts`：握手/快照完成后每 200ms 发 `t19-heartbeat`（心跳用于宿主崩溃检测）；
  - host `t19_host.ts`：从**已安装包**读取 `index.html` + `style.css` + `sdk.js`（占位符注入，
    安装期哈希校验）→ 心跳监控（>1200ms 中断 → **自动 reportCrash**，无需探针显式上报）→
    超限 failed/deactivate/recover/safeMode；旧 T19 探针（单资源）同步兼容并通过 8/8；
  - `run_t19_multiasset_probe.py`：构造 3 资产包 → 从目录安装 → 读取多资源 → 心跳 → 移除 iframe
    模拟 renderer 崩溃 → 自动检测 → 超限恢复；8 项断言。
- 原始结果：`evidence/T19-multiasset-probe-results.json` · 证据类型：**W（Windows/WebView2 实机）**

## 实测结果：**8/8 PASS**

| 检查 | 结果 |
| --- | --- |
| W-T19M-1 setup 从真实包目录安装 3 资产（哈希校验） | PASS |
| W-T19M-2 已安装包完整落盘（manifest/css/js/entry） | PASS（4 文件） |
| **W-T19M-3 entry/css/js 多资源从已安装包加载** | PASS（assetsLoaded=[index.html, style.css, sdk.js]） |
| W-T19M-4 host+guest 握手 + 只读 snapshot | PASS |
| W-T19M-5 guest 心跳到达宿主 | PASS |
| **W-T19M-6 iframe 移除后宿主自动检测崩溃（心跳超时）→ suspended** | PASS（autoDetectedCrashes=1） |
| **W-T19M-7 超限 → failed + deactivate + recover + safeMode** | PASS |
| W-T19M-8 真实 WebView2/Windows 环境 | PASS（UA Edg/155） |

## 结论

- T19 的「多资源离线包加载 + 真实崩溃**检测**（心跳中断而非探针自报）+ 降级/恢复链路」在 Windows 实机闭环；
  旧单资源探针同步通过（8/8），未回归。
- 剩余（T19 收尾）：
  1. 真实 **renderer process crash**（非 iframe 移除模拟）与导航失败/无响应检测；
  2. 多资源完整性（字体/图片/子资源 CSP）、zip 离线包与 T17/T21 产品安装目录合并；
  3. 心跳协议化（SDK 内置）、与 T20 safeMode UI/停用持久化联动、产品壳端到端 W（T26）。
