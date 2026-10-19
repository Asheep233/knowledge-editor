# UI 工坊接口维护规则（Interface Policy）

> **定位**：UI 工坊以 **接口级** 交付（协议 / SDK / manifest / 命令白名单 / 宿主能力）。
> **前端 UI 不是默认产品界面**：`WorkshopEntry` 由 `VITE_KE_WORKSHOP==='1'` 显式开启，默认构建不显示；
> 工坊面板仅作为参考/开发与验证用界面存在。任何“把工坊塞进主 UI”的改动需主理人另行决策，不是默认要求。

本文件是**接口契约的维护规则**：**每次改动接口相关代码/文档，必须同步维护下列内容**（PR/提交自查项）。

## 1. 接口范围（受维护对象）

| 层 | 单一事实源 | 对外文档 |
| --- | --- | --- |
| 协议契约（方法/事件/错误码/wire） | `frontend/src/core/protocol/types.ts`（`PROTOCOL_VERSION`、`PROTOCOL_CONTRACT`） | `WORKSHOP-INTEGRATION-GUIDE.md` §5–§7 |
| 包 manifest / 能力 allowlist | `frontend/src/core/packs/manifest.ts`（`PACK_API_VERSION`、`ALLOWED_CAPABILITIES`） | Guide §3–§4 |
| 信任/能力上限 | `frontend/src/core/packs/trustPolicy.ts` | Guide §4 |
| guest SDK（wire/握手/request/心跳） | `docs/ui-workshop/sdk/src/index.ts`（`SDK_VERSION`） | `docs/ui-workshop/sdk/`、Guide §2/§5 |
| 命令白名单（`command.invoke`） | `frontend/src/components/workshop/productBrokerBackend.ts` 的 `WORKSHOP_COMMAND_PROTOCOL_NAMES` | Guide §8 |
| 宿主安装/生命周期命令 | `desktop/src-tauri/src/*`（`workshop_pack_*`） | Guide §9 |
| 变更记录 | `WORKSHOP-INTERFACE-CHANGELOG.md` | 本文件 §3 |

## 2. 兼容性规则

1. **协议 `PROTOCOL_VERSION`**：破坏性变更（删/改方法、字段语义、错误码含义）必须升 major 并更新
   `PROTOCOL_CONTRACT` 快照；**只允许增量新增**方法/字段/事件（旧 guest 忽略未知字段即可，additive）。
2. **包 API `apiVersion`**：manifest 字段/语义破坏性变更 → 升 `PACK_API_VERSION`，旧包按不兼容**无损拒绝**，
   不静默降级。
3. **能力 allowlist**：新增能力必须 **评审 + 能力上限矩阵 + 协议/SDK 同步升版 + 文档**；删除能力 = 破坏性变更。
4. **命令白名单**：新增/删除 `command.invoke` 协议名 = 接口变更；新增必须有参数校验、负向测试、W 证据；
   命令名必须满足 manifest schema（小写点分/kebab，不使用 camelCase）。
5. **SDK**：`SDK_VERSION` 与 `docs/ui-workshop/sdk/package.json` 必须一致；wire 协议 major 与 SDK 版本分开。
   发布形态 `dist/guest-sdk.{js,mjs}` 必须随源码一起重建提交。
6. **宿主 UI 默认关闭**：`VITE_KE_WORKSHOP` 默认不开；不得把工坊入口/面板设为产品默认可见。

## 3. 每次更新必须维护的清单（Definition of Done）

- [ ] **协议**：`types.ts` 类型 + `PROTOCOL_CONTRACT` 快照 + 契约测试（`frontend/src/core/protocol/*test*`）通过；
- [ ] **manifest/能力**：`manifest.ts` 校验 + `trustPolicy.ts` 上限矩阵 + 相关单测同步；
- [ ] **命令白名单**：`productBrokerBackend.ts` 白名单/参数校验/负向错误 + 单测；
- [ ] **SDK**：`sdk/src` 改动则升 `SDK_VERSION` + `sdk/package.json` + 重建 `sdk/dist` + 自检 4/4；
- [ ] **文档**：更新 `WORKSHOP-INTEGRATION-GUIDE.md` 对应小节 + `WORKSHOP-INTERFACE-CHANGELOG.md` 追加本次变更；
- [ ] **验收**：`python3 docs/ui-workshop/tools/build_validation_matrix.py --check` PASS；
  `python3 docs/ui-workshop/tools/verify_delivery_consistency.py` PASS（含接口维护检查 DC-9）；
- [ ] **运行验证**：相关前端/后端测试；涉及真实产品行为需 W 探针证据（Windows/WebView2；Linux 不得冒充）；
- [ ] **兼容性说明**：破坏性变更需在本文件/ADR 记录迁移与回退方案；旧包/旧 guest 的行为必须明确。

## 4. 检查方式（自动）

`python3 docs/ui-workshop/tools/verify_delivery_consistency.py` 现包含 **DC-9 接口维护检查**：
- 本策略与 `WORKSHOP-INTERFACE-CHANGELOG.md` 存在；
- CHANGELOG 含当前 `protocol v1` / `sdk v0.1.0` / `pack apiVersion 1`；
- `SDK_VERSION` 与 `sdk/package.json` 一致；
- Guide 中引用本策略与 CHANGELOG；
- 前端 UI 入口仍由 `VITE_KE_WORKSHOP` 显式开关控制（默认不发）。

> 该检查是文档/版本一致性守卫，不替代代码契约测试与 W 证据；接口变更仍以 Guide + CHANGELOG + 测试为准。
