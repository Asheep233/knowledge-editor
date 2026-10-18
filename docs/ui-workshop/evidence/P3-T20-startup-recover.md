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
- 证据类型：**U/B（产品 Rust 单测 + 前端单测 + release 构建）**；Windows 端到端交互 W 尚未执行

## 验证结果

```text
$ cargo test --release          # 产品壳（新增 recover_all 单测）
test result: ok. 33 passed; 0 failed; 0 ignored
$ cargo build --release
Finished `release` profile [optimized]
$ npx vitest run src/core/packs/tauriPackAdapter.test.ts
Tests  7 passed (7)             # 含 dialog 目录选择器用例
$ npx tsc -b --noEmit
exit 0
```

| 单测 | 验证 |
| --- | --- |
| `recover_all_reports_clean_and_corrupt_packs` | 干净包 action=clean；损坏 active（有 previous）→ recovered=true 且回退；
  `workshop-recover-status.json` 写入成功；safeMode=false |
| TauriPackAdapter（7 例） | list/scan/install/rollback/recover 映射；**dialog 目录选择器**（directory=true, multiple=false）；
  null 选择不扫描；Rust 错误传播 |

## 结论

- T20 的启动恢复链路在产品壳落地：**启动时自动清理半成品/损坏回退 + 状态文件 + 事件广播**；
  包目录选择已用真实 Tauri dialog 插件接线（不再是占位）。
- 尚未完成（T20/T21 继续）：
  1. **Windows 端到端交互 W**：启动含损坏包的 app_data → 验证 safe mode 状态可见、UI 提示、
     修复/回滚入口、卸载；真实安装包升级/回滚（T21/T26）；
  2. safeMode 目前是状态标记：尚未在前端呈现/阻断危险操作，也未与「单实例/退出协调」状态合并；
  3. 包签名/来源信任、卸载与清理、以及 T23 控制面真实交互验收。
