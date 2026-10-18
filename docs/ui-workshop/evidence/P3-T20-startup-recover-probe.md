# P3-T20 证据：启动时 recover_all + safeMode（Windows 实机 9/9 PASS）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型 `uiws-s1-probe`，真实文件系统）**
- 代码：
  - 原型 Rust：`pack_store_proto.rs` 新增 `pack_recover_all`（与产品壳同语义）；
    `main.rs` setup 环境驱动：`S1_PACK_SEED`（安装 v1/v2 + 损坏 active；可选无回退损坏包）与
    `S1_PACK_RECOVER_ON_START`（启动 recover → 写 `workshop-recover-status.json` + 事件）
  - 驱动：`prototypes/p0/s1_runtime/run_startup_recover_probe.py`（Windows Python，三阶段：播种→恢复→safeMode）
- 原始结果：`evidence/T20-startup-recover-probe-results.json` · 证据类型：**W（Windows 真实文件系统）**

## 实测结果：**9/9 PASS**

| 检查 | 结果 |
| --- | --- |
| W-T20-1 播种损坏包（v2 active 损坏 + previous v1） | PASS |
| W-T20-2 启动时执行 recover 并产出状态文件 | PASS（checked=1，状态文件生成） |
| **W-T20-3 损坏 active 自动回退** | PASS（recovered=true，action=rollback-corrupt-active） |
| **W-T20-4 回退后磁盘 state.json active=1.0.0** | PASS |
| W-T20-5 有 previous 时 safeMode=false 且应用正常启动 | PASS |
| **W-T20-6 无 previous 损坏包 → action=corrupt-no-fallback** | PASS |
| **W-T20-7 启动恢复 safeMode=true** | PASS（checked=2） |
| **W-T20-8 safeMode 下应用仍正常启动**（boot + recover 事件） | PASS |
| W-T20-9 数据目录在真实 Windows 文件系统 | PASS |

## 结论

- T20 的**启动恢复链路**在 Windows 实机成立：启动时扫描已安装包 → 半成品/损坏回退 →
  safeMode 状态落文件与事件；**恢复不阻断应用启动**（与产品壳 `.setup()` 实现一致语义）。
- 剩余（T20 继续）：
  1. 产品壳的该路径目前由 Rust 单测覆盖（`recover_all_reports_clean_and_corrupt_packs`），
     尚未在**真实产品安装目录**做端到端 W（需隔离安装/数据目录，避免干扰用户正在运行的 App）；
  2. safeMode 前端呈现已完成（徽标/横幅/全部修复），但「阻断危险操作」未做；
  3. 与单实例/退出协调状态合并、卸载后清理、包签名信任链。
