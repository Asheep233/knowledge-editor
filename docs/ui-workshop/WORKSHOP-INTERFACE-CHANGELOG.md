# UI 工坊接口变更记录（Interface Changelog）

> 规则见 `WORKSHOP-INTERFACE-POLICY.md`：**每次接口变更必须在本文件追加一条**。
> 版本字段：`protocol vN`（wire 契约）、`sdk vX.Y.Z`（guest SDK）、`pack apiVersion N`（manifest 契约）。

## v1（当前基线，2026-10-19）

- **protocol v1**：`PROTOCOL_VERSION = 1`；方法 5 个：
  `protocol.capabilities`、`context.snapshot`、`context.write`、`print.snapshot`、`command.invoke`；
  事件 5 个：`context-changed`、`theme-changed`、`selection-changed`、`document-saved`、`host-shutdown`；
  错误码 11 个（`E_VERSION`…`E_INTERNAL`）；wire：`t19-wire` / `t19-guest-alive` / `t19-port` /
  `handshake` / `request` / `response` / `event` / `cancel` / `t19-heartbeat`。
- **sdk v0.1.0**：`connectGuest/autoConnect/handshake/request/heartbeat/close`；`SdkError{code,retryable}`；
  暂无事件订阅 API（guest 监听 wire `event`）。
- **pack apiVersion 1**：manifest 字段 `id/name/version/apiVersion/capabilities/entry/commands/assets`；
  assets 必带 sha256；命令名 `^[a-z][a-z0-9.-]{1,80}$`；能力 allowlist 7 项。
- **能力上限**：builtin=all；trusted=7 项全部；community=`panel.sidebar`/`panel.dock`/`print.request`。
- **命令白名单 21 条协议名**：14 切换（`editor.bold/italic/underline/strike/code/heading1/heading2/heading3/`
  `editor.bullet-list/ordered-list/blockquote/code-block/undo/redo`）+ 3 无参动作
  （`editor.table.insert`/`editor.footnote.insert`/`editor.note.insert`）+ 4 参数化
  （`editor.link.insert`/`editor.math.inline`/`editor.math.block`/`editor.table.insert` 参数化表单）+ `doc.save`
  （其中 `editor.table.insert` 同时以无参/参数化语义存在；实现以参数化命令为准，缺省 3×3 带表头）。
- **宿主生命周期命令**：`workshop_pack_scan/verify/install/list/activate/rollback/uninstall/recover/recover_all/`
  `startup_status/session_status/session_report/read_asset/stage_zip/install_staged/abort_staged`。
- **宿主 UI 定位**：接口级交付；`WorkshopEntry` 由 `VITE_KE_WORKSHOP==='1'` 显式开启，默认构建不显示。

## 变更模板（复制使用）

```
## vX（YYYY-MM-DD）
- protocol: vA → vB（是否破坏性 / 迁移说明）
- sdk: vX.Y.Z → vX.Y.Z（新增/变更 API）
- pack apiVersion: N（是否升级）
- 能力/命令白名单：新增/删除清单
- 兼容性：旧 guest/旧包行为；回退方案
- 文档/测试/证据：Guide 小节、契约测试、W 证据、矩阵/一致性检查结果
```
