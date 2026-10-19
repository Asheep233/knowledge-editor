# P5-T26 F16 原生菜单结构审计（只读；DOM/W 未覆盖）

- 生成时间：2026-10-19T15:58:37+0800
- 来源（只读）：`desktop/src-tauri/src/menu.rs`（**未修改 Rust 代码**）
- 审计项数：11 个 MenuItem（文件/编辑/视图/帮助子菜单）
- 结论：原生菜单**不是 DOM**，CDP 无法真实点击/断言 → 本文件仅为**结构性证据（U/静态）**；`feature-baseline.csv` 的 `UI.menu.*` 10 行 + F16 域行共 11 行如实记 `NOT_RUN`（W 未覆盖），不伪造 DOM。

| MID | 标签 | 加速键 | 事件 ID | 分发目标（handle_event 摘要） |
| --- | --- | --- | --- | --- |
| `MID_NEW` | 新建文档 | Ctrl+N | `ke-menu:new-document` | let _ = app.emit(MID_NEW, ()); |
| `MID_OPEN_WS` | 打开 Workspace… | Ctrl+O | `ke-menu:open-workspace` | let _ = app.emit(MID_OPEN_WS, ()); |
| `MID_NEW_WS` | 新建工作区… | （无） | `ke-menu:new-workspace` | let _ = app.emit(MID_NEW_WS, ()); |
| `MID_CLOSE_WS` | 关闭工作区 | （无） | `ke-menu:close-workspace` | let _ = app.emit(MID_CLOSE_WS, ()); |
| `MID_RECOVERY` | 恢复检查… | （无） | `ke-menu:recovery-check` | let _ = app.emit(MID_RECOVERY, ()); |
| `MID_SETTINGS` | 设置… | Ctrl+, | `ke-menu:settings` | let _ = app.emit(MID_SETTINGS, ()); |
| `MID_EXIT` | 退出 | Ctrl+Q | `ke-menu:exit` | if !crate::begin_close_handshake(app) { request_exit(app); |
| `MID_RELOAD` | 重新加载 | Ctrl+R | `ke-menu:reload` | crate::begin_reload_handshake(app), #[cfg(debug_assertions)] |
| `MID_DEVTOOLS` | 开发者工具 | F12 | `ke-menu:devtools` | if let Some(w) = app.get_webview_window("main") { w.open_devtools(); |
| `MID_RELOAD` | 重新加载 | Ctrl+R | `ke-menu:reload` | crate::begin_reload_handshake(app), #[cfg(debug_assertions)] |
| `MID_RECENT` | 最近工作区… | （无） | `ke-menu:refresh-recent` | let _ = app.emit(MID_RECENT, ()); |

## 说明

- 菜单项存在性/绑定关系：以 `menu.rs` 的 `MenuItem::with_id(...)` 与 `handle_event` 匹配为准（本审计提取）。
- 真实交互（菜单点击 → 前端事件 → 行为）需要非 DOM 的 OS 级 UI 自动化或 Rust 集成测试，本轮**未执行**；因此 F16 不满足 W 证据要求，CSV 记 NOT_RUN。
- 菜单事件语义见 `menu.rs` 注释（退出/重载走 flush 握手 `begin_close_handshake`/`begin_reload_handshake`；devtools 仅 debug 构建）。
