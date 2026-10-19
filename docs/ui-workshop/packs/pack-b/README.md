# 参考包 B · Dock 写作表单（pack-b）

UI 工坊（UI Workshop）的**参考 guest 包 B**：最小可用的「写场景」Dock 面板。它演示在**不声明**
高风险的 `context.write` 能力时，如何通过 manifest 声明式命令 `command.invoke` 完成真实的文档元信息写入：
读出快照 → 从 frontmatter 解析 title/tags → 表单提交 → 宿主白名单命令 → 后端原子写 meta 落盘。

## 能力（manifest 声明，最小集）

| 能力 | 用途 |
| --- | --- |
| `ui.shell` | 协议线/命令桥基础能力（Broker 对 `command.invoke` 要求 `ui.shell`） |
| `panel.dock` | Dock 面板定位（声明式） |
| `context.read` | `context.snapshot` 读正文（用于展示内容 + 解析 title/tags） |
| `editor.commands.readonly` | T26 F03 受控编辑器命令桥（`command.invoke('editor.*')` 由 guest 发起）；**trusted 才授予**；最小白名单切换类命令，不允许任意命令/参数 |

声明命令（小写名，宿主按 `manifest.commands` 白名单校验）：

| 命令名 | handler | 语义 |
| --- | --- | --- |
| `article.set-title` | `setTitle` | 更新文档 frontmatter title（后端 `/api/articles/{rel}/meta` 原子写） |
| `article.set-tags` | `setTags` | 更新文档 frontmatter tags（同上） |
| `editor.bold` / `editor.italic` / `editor.underline` / `editor.strike` / `editor.code` | `editorBold` … | 切换类语内标记（真实宿主编辑器命令桥） |
| `editor.heading1` / `editor.heading2` / `editor.heading3` | `editorHeading1` … | 标题 1/2/3 |
| `editor.blockquote` | `editorBlockquote` | 引用块 |
| `editor.undo` / `editor.redo` | `editorUndo` / `editorRedo` | 撤销 / 重做 |

**不声明** `context.write`：写操作走声明式命令（W02 语义），演示最小能力集下的写场景；
参考包不请求比用途更多的高风险能力。

## 功能

- **SDK 发布形态**：`<script src="vendor/guest-sdk.js">`（发布 SDK iife，全局 `KeWorkshopSDK`）
  → `autoConnect` 握手 → 展示 `acceptedFeatures`/`contextId`/`epoch`；200ms 心跳 + 心跳计数。
- **读取快照**：输入工作区相对路径 → `context.snapshot` → 展示正文；从 frontmatter 解析 `title`/`tags`
  并**自动填充表单**（标签支持行内 `[a, b]`、逗号分隔与 YAML 列表三种写法）。
- **提交**：「提交标题」/「提交标签」经 `command.invoke` → 展示宿主返回结果或错误；
  命令结果追加到日志列表，成功/失败均有 UI 反馈（失败显示错误码，如空标题 → `E_INTERNAL: E_TITLE: …`）。
- **宿主事件**：监听 wire `event` 消息并展示（如 `document-saved`）。
- **状态镜像**：`postMessage({type:'t19-guest-results', payload})`，便于宿主工坊/自动化探针观察。
- **错误展示**：所有失败在红色错误框显示 `code: message`，不静默。

## 构建与签名

```bash
node docs/ui-workshop/tools/build_reference_packs.mjs \
  --key C:/ke-tmp/uiws-g7/test-key.pem --keyid k1 --json-out C:/ke-tmp/uiws-g7/build.json
```

产物：`docs/ui-workshop/packs/dist/com.astranota.examples.pack-b/`（含签名 manifest）与
`dist/com.astranota.examples.pack-b-1.0.0.zip`（zip 根含 `manifest.json`+资产，兼容 W01 离线安装）。
测试自签密钥只落在 dist（gitignore）或仓库外，**不入仓**。

## T26 F03 受控编辑器命令桥（editor.*）

- 宿主白名单 14 条：`bold/italic/underline/strike/code/heading1/heading2/heading3/bulletList/orderedList/blockquote/codeBlock/undo/redo`
  （协议名 `editor.<command>`，**大小写敏感**；实现见 `frontend/src/components/workshop/productBrokerBackend.ts`
  的 `WORKSHOP_EDITOR_COMMAND_WHITELIST`）。
- 本包在 `manifest.commands` **逐条声明 11 条**：`editor.bold/italic/underline/strike/code/heading1/heading2/heading3/blockquote/undo/redo`
  （声明是 broker 的 `declaredCommands` 白名单前置；未声明的命令会被 `E_FORBIDDEN` 拒绝）。
- 能力：新增声明 `editor.commands.readonly`（trusted 才授予；未授予 → `E_CAPABILITY`）。
- UI：`index.html` 的「编辑器命令」面板 11 个按钮，真实点击 → `command.invoke` → 宿主真实编辑器 DOM 生效
  （加粗→strong、斜体→em、标题→h1/h2/h3、引用→blockquote、撤销/重做）。
- 负向：`window.__packBInvokeCommand(name, args)`（参考包自动化/演示用 hook）可直接请求任意命令名；
  未声明 / 未知 / 大写名一律被宿主拒绝并展示错误码（**不假成功**）。

### 已知限制（T26 F03 pack B 覆盖缺口，如实记录）

- 白名单中 **`bulletList` / `orderedList` / `codeBlock` 三条为 camelCase**，而 packs manifest 的
  `commands[].name` 校验仅允许 `^[a-z][a-z0-9.-]{1,80}$`（见 `frontend/src/core/packs/manifest.ts`
  与 `tools/build_reference_packs.mjs` 的 `COMMAND_RE`）→ 这 3 条**无法在 manifest 声明**，
  guest 调用会被 broker 的 `declaredCommands` 前置拒绝（`E_FORBIDDEN`）。属产品 schema 与白名单命名
  不一致的缺口，需后续产品决策（放宽命令名或统一协议名），本参考包不绕过。
- `editor.*` 仅覆盖切换类/历史类命令，不含文本插入/删除/选区/任意命令（最小白名单，安全边界）。
## 安装与启用（产品）

1. 宿主启动时 `KE_WORKSHOP_PUBKEYS` 注入签名公钥（`build-info.json` 的 `signing.publicKeyHex`）；
2. 安装 `workshop_pack_install { sourceDir: <dist/com.astranota.examples.pack-b> }`
   或工坊面板选 `dist/com.astranota.examples.pack-b-1.0.0.zip`；
3. 工坊面板「授予信任」（trusted）→「启用 guest」；
4. 包内输入测试文档路径（如 `Articles/example.md`）→「读取快照」→ 修改标题/标签 →「提交」；
   磁盘 frontmatter 应被后端原子更新（可通过外部查看文档确认）。

## 已知限制（如实记录）

- **命令写通道 = 两条元信息命令（title/tags）+ 11 条 `editor.*` 编辑器切换命令**，不是通用文件/任意命令 API；正文写入需
  `context.write`（G2，trusted/builtin），本参考包按最小能力集刻意不声明。
- **发布 SDK 0.1.0 无事件订阅 API**：事件监听按协议 wire 直接解析，建议后续 SDK 增加 `onEvent()`。
- **guest 无法发现「当前打开文档」**：需用户输入 relPath（或由 `document-saved` 事件得知），协议无当前路径字段。
- 参考包是 demo 级实现（简单 frontmatter 解析、单文档表单），不是生产插件；不替代 F01–F16 逐项台账。
- 隔离残余风险沿用 `evidence/P5-T26-A7-isolation.md`（`E_ISOLATION_RESIDUAL` 横幅）。

## 文件

```
manifest.json        # 包清单（含 commands 声明；构建工具回写 assets sha256/size）
index.html           # 入口（相对引用 pack.css / vendor/guest-sdk.js / pack.js）
pack.css / pack.js   # 样式与 guest UI 逻辑（表单/命令/事件/错误展示）
vendor/guest-sdk.js  # 由构建工具从 docs/ui-workshop/sdk/dist/guest-sdk.js 同步（发布 SDK）
```
