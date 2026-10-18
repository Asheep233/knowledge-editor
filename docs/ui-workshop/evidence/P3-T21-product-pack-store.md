# P3-T21/T17 证据：产品壳 Rust 原生包存储（真实 Tauri 主进程，cargo 32/32）

- 日期：2026-10-19 · 代码（**产品仓库**）：
  - `desktop/src-tauri/src/pack_store.rs`：产品 Rust 包存储（与原型 `pack_store_proto.rs` 同语义，
    路径改为 `app_data_dir()/workshop-packs`，**不触碰用户笔记目录**）
    - 命令：`workshop_pack_scan`（安装前预览：身份/能力/apiVersion/哈希校验）、
      `workshop_pack_install`（staging→rename→state 单提交点+journal）、`workshop_pack_list`、
      `workshop_pack_verify`、`workshop_pack_activate`、`workshop_pack_rollback`、`workshop_pack_recover`
      （active 损坏自动回退 previous）
  - `desktop/src-tauri/src/lib.rs`：注册上述命令（既有命令/行为不变）
  - `desktop/src-tauri/Cargo.toml`：新增 `sha2 = "0.10"`（只用于包资产哈希校验）
- 证据类型：**U/B（产品 Rust 单测 + Release 构建）**；尚未由产品前端调用（适配器/UI 集成下一步），
  无 Windows 交互 W 证据（T21/T26 验收前）

## 验证结果

```text
$ cargo test --release        # 产品壳（含 3 个新 pack_store 单测）
test result: ok. 32 passed; 0 failed; 0 ignored
$ cargo build --release
Finished `release` profile [optimized]
knowledgeeditor.exe  15,508,992 B
```

| 新单测 | 验证 |
| --- | --- |
| `safe_rel_rejects_traversal_and_absolute` | `../`、绝对路径、盘符路径拒绝；正常资产路径通过 |
| `scan_ok_and_tampered_blocked` | 合法包扫描 preview（packId/blocked=false）；资产被篡改 → `E_HASH` 拒绝 |
| `install_list_rollback_recover_chain` | 安装 v1 → 升级 v2（active/previous）→ list 仅含已安装包 → verify →
  回滚交换 → 损坏 active → recover 自动回退到 previous（`rollback-corrupt-active`） |

## 结论

- T17/T21 的**产品壳原生实现**落地：安装/预览/升级/回滚/损坏恢复在真实 Tauri 主进程可执行并通过单测；
  包目录位于应用数据区，与笔记库隔离。
- 尚未完成（T21 继续）：
  1. 前端适配器（`invoke` 包装）+ T23 WorkshopPanel 集成（含真实包目录选择/进度/取消）；
  2. Windows 端到端交互 W 证据（安装→启用→回滚→卸载，含损坏/safe mode 路径）（T21/T26）；
  3. 包签名/来源校验接入、包卸载与清理、与 T20 Rust 原生恢复/单实例启动流程合并。
