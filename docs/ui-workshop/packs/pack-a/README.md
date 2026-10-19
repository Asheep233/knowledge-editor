# 参考包 A · 侧栏阅读器（pack-a）

UI 工坊（UI Workshop）的**参考 guest 包 A**：最小可用的「读场景」侧栏面板。它不是一个空壳——
安装并授予 trusted 后，它会经产品真实协议线握手、读当前文档正文快照、接收宿主保存事件并自动刷新，
还能触发宿主的真实打印管线。用于给外部开发者抄写起步模板，也作为 G7「参考 UI + 产品 W 安装启用证据」的被测对象。

## 能力（manifest 声明，最小集）

| 能力 | 用途 |
| --- | --- |
| `ui.shell` | 协议线/握手/心跳/请求通道基础能力（Broker 要求） |
| `panel.sidebar` | 侧栏面板定位（声明式；运行期能力 = 信任等级 ∩ manifest） |
| `context.read` | `context.snapshot` 返回正文（`content`/`contentBytes`，G1） |
| `print.request` | `print.snapshot` 走宿主真实打印管线（真实 PDF + 不透明 token，G3） |

不声明 `context.write` 等未用写能力——参考包演示**能力最小化**；W07 task-31 起声明 `editor.commands.readonly`（trusted 才授予）以接入受控编辑命令桥（见下节）。

## 功能

- **SDK 发布形态**：入口通过 `<script src="vendor/guest-sdk.js">` 加载 `docs/ui-workshop/sdk/dist/guest-sdk.js`
  （iife，全局 `KeWorkshopSDK`），`KeWorkshopSDK.autoConnect({ requestedFeatures })` 等宿主 `t19-port`
  → 握手 → 展示 `acceptedFeatures`/`contextId`/`epoch`；200ms 心跳（`conn.heartbeat()`），UI 显示心跳计数。
- **读取快照**：输入工作区相对路径（如 `Articles/example.md`）→ `context.snapshot` →
  展示 frontmatter `title`、正文摘要/全文、`revision`、`diskHash`、`contentBytes`。
- **宿主事件**：监听协议 wire 的 `event` 消息；`document-saved` 到达后把路径填入输入框并**自动重读快照**，
  事件列表记录 `relPath`/`revision`。（发布 SDK 0.1.0 尚无事件订阅 API，见「已知限制」。）
- **真实打印**：按钮请求 `print.snapshot`，展示宿主返回的 `pdfToken`/`pages`（不可得时 `null`，不伪造）。
- **错误展示**：所有失败（未连接/非法路径/能力缺失/打印失败等）在红色错误框显示 `code: message`，不静默。
- **状态镜像**：状态变化时向宿主 `postMessage({type:'t19-guest-results', payload})`，
  便于宿主工坊/自动化探针观察 UI 状态（产品宿主组件本身即收集该消息）。

## W07 task-31 受控编辑命令桥（18 条协议名）

- 宿主白名单共 18 条协议名：14 条切换命令（`editor.bold/italic/underline/strike/code/heading1/heading2/heading3/`
  `editor.bullet-list/ordered-list/blockquote/code-block/undo/redo`）+ 4 条可无头产品动作
  （`editor.table.insert`【产品默认 3×3 带表头】/`editor.footnote.insert`/`editor.note.insert`/`doc.save`）。
- 本包在 `manifest.commands` **逐条声明 18 条**（声明是 broker `declaredCommands` 前置；未声明 → `E_FORBIDDEN`），
  并声明能力 `editor.commands.readonly`（trusted 才授予；未授予 → `E_CAPABILITY`）。
- UI：「编辑器命令」面板 18 个按钮 → 真实 `command.invoke`；结果/错误显示在「最近命令」与错误框（不静默）。
- 负向：`window.__packAInvokeCommand(name, args)`（参考包自动化用 hook）可请求任意命令名；未声明/未知/大写名
  一律被宿主拒绝；**不接**对话框/文件选择类动作（`editor.link.insert`/`image.insert`/`math.*`/`module.insert`），
  guest 调用被拒绝（`E_FORBIDDEN`，无头环境不弹窗）。

### 已知限制

- 多词命令协议名使用 kebab-case（`editor.bullet-list` 等）；旧 camelCase（`editor.bulletList`）仅宿主后端
  legacy 兼容直调，manifest 命令名 schema 不允许大写 → 无法声明。
- `doc.save` 的真实落盘由产品保存链保证（W 验证：编辑 marker 后磁盘出现 marker + mtime 变化，不只查返回值）。
## 构建与签名

```bash
# 仓库根执行；产物在 docs/ui-workshop/packs/dist/（已 gitignore，密钥不入仓）
node docs/ui-workshop/tools/build_reference_packs.mjs \
  --key C:/ke-tmp/uiws-g7/test-key.pem --keyid k1 --json-out C:/ke-tmp/uiws-g7/build.json
```

- 工具会：同步 `vendor/guest-sdk.js` ← `docs/ui-workshop/sdk/dist/guest-sdk.js`、回写 `manifest.json`
  的 assets `sha256/size`、把带 ed25519 签名的副本与 zip 产物写到 `dist/`；
- 不传 `--key` 时会在 `dist/.test-signing-key.pem` 生成**测试自签密钥**（仅本地测试，不入仓）；
- `--check` 可用于 CI 校验清单哈希/vendored SDK 是否过期。

## 安装与启用（产品）

1. 宿主启动时通过 `KE_WORKSHOP_PUBKEYS` 注入签名公钥：`{"k1":{"key":"<build-info.json 的 signing.publicKeyHex>"}}`；
2. 安装：宿主 IPC `workshop_pack_install { sourceDir: <dist/com.astranota.examples.pack-a> }`，
   或工坊面板「选择 ZIP 离线包」选 `dist/com.astranota.examples.pack-a-1.0.0.zip`；
3. 工坊面板 → 「授予信任」（trusted）→「启用 guest」；
4. 在包内输入测试文档路径 →「读取快照」；改动并保存文档可观察 `document-saved` 自动刷新；
   「打印快照」需要测试构建以 `KE_WS_PRINT_RENDER=1` 启动（隐藏打印 renderer，T16 既有门控）。

## 已知限制（如实记录）

- **发布 SDK 0.1.0 无事件订阅 API**：`document-saved`/`context-changed`/`theme-changed` 需按协议 wire
  `window.addEventListener('message', ...)` 直接解析（本包如此实现）；建议后续 SDK 增加 `onEvent()`。
- **guest 无法直接发现「当前打开文档」**：协议无「当前 relPath」字段；本包只能由用户输入路径，
  或等 `document-saved` 事件（事件带 relPath）后自动刷新。`context-changed` 只带 contextId/epoch。
- **状态镜像是演示/可观测性通道**：`t19-guest-results` 是宿主既有诊断消息类型，不是正式协议方法。
- 打印**页数不可得**（`pages: null`）；打印期间宿主主窗口会被 Rust PrintToPdf 短暂阻塞（既有产品行为）。
- 本包是**参考实现**（demo 级 frontmatter 解析、单文件视图），不是生产插件；不替代 F01–F16 逐项台账。
- 隔离残余风险沿用 `evidence/P5-T26-A7-isolation.md`：guest 可探测到 `__TAURI_INTERNALS__` 存在
  （remote IPC 已拒绝，宿主显示 `E_ISOLATION_RESIDUAL` 横幅）。

## 文件

```
manifest.json        # 包清单（构建工具回写 assets sha256/size；源清单不含签名）
index.html           # 入口（相对引用 pack.css / vendor/guest-sdk.js / pack.js）
pack.css / pack.js   # 样式与 guest UI 逻辑
vendor/guest-sdk.js  # 由构建工具从 docs/ui-workshop/sdk/dist/guest-sdk.js 同步（发布 SDK）
```
