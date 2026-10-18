# P3-T17/T19 证据：产品壳包资产读取命令（A7 前置，cargo 40/40）

- 日期：2026-10-19 · 代码（产品仓库）：
  - `desktop/src-tauri/src/pack_store.rs` 新增命令 `workshop_pack_read_asset(id, version, path)`：
    `safe_rel` 路径校验（禁止 `..`/绝对路径）、id/version 同样校验、仅已安装目录、5MB 上限、
    读失败返回可读错误；`lib.rs` 注册命令；
  - 单测 `read_asset_paths_and_content`：安全路径/穿越拒绝/内容读取；产品 cargo **40 passed**、
    release 构建成功。
- 证据类型：**U/B（Rust 单测 + 构建）**；产品运行时 W 依赖 A7 宿主接入（ADR-004）。

## 结论

- A7「真实入口资源加载」的产品侧能力就绪（安装期哈希已保证目录不可变；读取命令只做路径/大小安全校验）；
- 剩余：会话状态命令、前端宿主适配器/隔离守卫、工坊 UI 启用/停用、A7/A5 产品 W。
