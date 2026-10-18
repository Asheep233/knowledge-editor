# P3-T20 证据：产品壳启动 recover + safe mode 状态上报（cargo 33/33，release 构建成功）

- 日期：2026-10-19 · 代码（产品仓库）：
  - `desktop/src-tauri/src/pack_store.rs`：
    - `recover_all(root)`：扫描 `workshop-packs/*/state.json`，逐包执行清理/损坏回退；
      任一包 `corrupt-no-fallback` 或读取异常 → `safeMode=true`；返回 `{checked, results, safeMode, generatedAt}`
    - `write_recover_status(root,status)`：写 `workshop-recover-status.json`（写失败不阻断启动）
    - 命令 `workshop_pack_recover_all`（UI/诊断手动触发）
  - `desktop/src-tauri/src/lib.rs`：产品 `.setup()` 启动时调用 recover_all + 写状态 + 广播
    `workshop://recover-status`（失败不阻断既有启动流程；先于窗口交互注册完成）
  - `frontend/src/core/packs/tauriPackAdapter.ts`：真实**包目录选择**（`@tauri-apps/plugin-dialog`
    目录选择器，默认 `choosePackDirectory`），替换此前的注入占位
  - `frontend/src/components/workshop/WorkshopPanel.tsx`：新增「检查/修复全部包」按钮
    （adapter.recoverAll → 产品 `workshop_pack_recover_all`），**safeMode 警告横幅**（role=alert）
  - `frontend/src/components/workshop/WorkshopEntry.tsx`：监听 `workshop://recover-status` 事件，
    入口按钮显示 **safe mode 徽标**（启动恢复后用户可见）
- 证据类型：**U/B（产品 Rust 单测 + 前端单测 + release 构建）**；Windows 端到端交互 W 尚未执行

## 验证结果

```text
$ cargo test --release          # 产品壳（新增 recover_all 单测）
test result: ok. 33 passed; 0 failed; 0 ignored
$ cargo build --release
Finished `release` profile [optimized]
$ npx vitest run src/components/workshop src/core/packs
Tests  43 passed (43)           # 工坊 UI 11 + packs 32（含 dialog / recoverAll / safeMode）
$ npx tsc -b --noEmit
exit 0
$ npx vitest run --maxWorkers=2   # 全量前端
Test Files  122 passed (122)
     Tests  1737 passed | 1 skipped (1738)
```

| 单测 | 验证 |
| --- | --- |
| `recover_all_reports_clean_and_corrupt_packs` | 干净包 action=clean；损坏 active（有 previous）→ recovered=true 且回退；
  `workshop-recover-status.json` 写入成功；safeMode=false |
| TauriPackAdapter | list/scan/install/rollback/recover/recoverAll 映射；**dialog 目录选择器**；
  null 选择不扫描；Rust 错误传播 |
| WorkshopPanel recoverAll | 点击「检查/修复全部包」→ adapter 调用 + 结果提示；safeMode=true 显示警告横幅 |
| WorkshopEntry safeMode | 收到 `workshop://recover-status`(safeMode) 事件 → 入口显示 safe mode 徽标 |

## 结论

- T20 的启动恢复链路在产品壳落地：**启动时自动清理半成品/损坏回退 + 状态文件 + 事件广播**；
  包目录选择已用真实 Tauri dialog 插件接线（不再是占位）。
- 尚未完成（T20/T21 继续）：
  1. **Windows 端到端交互 W**：启动含损坏包的 app_data → 验证 safe mode 状态可见、UI 提示、
     修复/回滚入口、卸载；真实安装包升级/回滚（T21/T26）；
  2. safeMode 已可在 UI 呈现（徽标+横幅+全部修复按钮），但尚未**阻断危险操作**，也未与
     「单实例/退出协调」状态合并；
  3. 包签名/来源信任、卸载与清理、以及 T23 控制面真实交互验收。
