# P3-T19 升级证据：guest entry 来自**已安装包**（真实资源加载）— Windows/WebView2 8/8 PASS

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型 `uiws-s1-probe`）**
- 代码：
  - 原型 Rust：新增 `pack_read_asset`（路径安全校验后读取已安装包资产）；setup 新增
    `S1_PACK_SEED_PACK_DIR`（从真实包目录安装：manifest/assets/哈希校验）；
    `run_t19_entry_probe.py` 构造真实包（manifest + entry HTML 内含 guest bundle）；
  - host 探针：优先经 `pack_read_asset` 从**已安装包**读取 entry HTML 注入 sandbox iframe
    （`guestSource='pack-entry'`，字节数记录）；失败回退内联 guest（探针健壮性，非本次路径）
- 原始结果：`evidence/T19-pack-entry-probe-results.json` · 证据类型：**W（Windows/WebView2 实机）**

## 实测结果：**8/8 PASS**

| 检查 | 结果 |
| --- | --- |
| W-T19E-1 setup 从真实包目录安装成功（哈希校验/state 提交） | PASS（`pack-seeded-from-dir`） |
| W-T19E-2 已安装包 manifest/entry 落盘 | PASS |
| **W-T19E-3 guest entry 来自已安装包（非内联 fallback）** | PASS（`pack-entry`，7,807 bytes） |
| W-T19E-4 host+guest 探针完成 | PASS |
| W-T19E-5 guest 经 Broker 握手 + 只读 snapshot（能力放行） | PASS |
| W-T19E-6 崩溃未超限 → suspended | PASS |
| W-T19E-7 超限 → failed + 停用 + recover + safeMode | PASS |
| W-T19E-8 真实 Windows 文件系统/环境 | PASS |

## 结论

- T19 的「**包入口真实资源加载 + 受限会话装配 + 崩溃升级/safeMode**」在 Windows 实机闭环：
  guest HTML 来自 T17 安装目录（manifest/资产哈希校验后），经 PackageHost→Broker→HostDispatcher
  会话执行；崩溃策略与恢复真实生效。
- 剩余（T19 收尾）：
  1. 真实 WebView 崩溃信号（renderer crash/导航失败）而非探针显式 reportCrash；
  2. 包入口多资源（sdk/js/css/字体）加载与离线资源完整性；与 T17 产品化安装目录/签名链路合并；
  3. 与 T20 safeMode UI/停用状态持久化联动；Windows 产品端到端交互 W（T26）。
