# UI 工坊接口使用文档（Host / Guest / SDK / 协议）

> 适用：在 AstraNota 宿主里**接入/扩展 UI 工坊**，或开发一个 **guest UI 包**的开发者。
> 本文对应分支 `feat/ui-workshop`（协议版本 `PROTOCOL_VERSION = 1`，SDK `0.1.0`，包 API `apiVersion = 1`）。
> **定位：接口级交付**——宿主 UI 入口默认关闭、不是产品默认界面；接口维护规则见
> `WORKSHOP-INTERFACE-POLICY.md`，变更记录见 `WORKSHOP-INTERFACE-CHANGELOG.md`。
> 接口以代码为唯一事实源；关键实现位置在文末「参考实现与证据」。
> 平台边界：宿主产品是 Windows Tauri v2 + WebView2；Linux 只能做构建/单测，**不能**作为 Windows W 证据。

## 1. 架构与术语

```
┌──────────────────────────── 宿主（AstraNota / Tauri v2 + React） ────────────────────────────┐
│  App.tsx ── <WorkshopEntry enabled={VITE_KE_WORKSHOP==='1'}> ── WorkshopPanel（安装/信任/启用）│
│        └─ WorkshopGuestFrame（iframe：workshop.localhost，独立 origin）── t19-wire postMessage │
│                └─ ProductBrokerBackend（能力过滤 + 真实产品能力：读/写/打印/编辑命令）         │
│  EditorArea（window.__KE_WORKSHOP_EDITOR__ 受控执行器） / Core 保存链 / 打印管线 / 事件桥      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                     ▲ t19-wire 协议
┌────────────────────────────────────┴── guest 包（预编译 html/js/css）─────────────────────────┐
│  manifest.json（id/version/apiVersion/capabilities/entry/commands/assets）                     │
│  index.html + pack.js：引入 docs/ui-workshop/sdk/dist/guest-sdk.js（全局 KeWorkshopSDK）       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

| 术语 | 含义 |
| --- | --- |
| **包（pack）** | 一个预编译 UI 资源目录（html/js/css/资产）+ `manifest.json`；包含式加载，加载时不构建 |
| **guest** | 包的 UI 运行在宿主页面的 iframe 中，来源 `workshop.localhost`（独立 origin） |
| **host / broker** | 宿主侧；Broker 按「信任等级 ∩ manifest 声明」过滤能力并执行真实产品动作 |
| **信任等级 tier** | `builtin`（内置）/ `trusted`（用户显式授予）/ `community`（默认）；决定能力上限 |
| **能力 capability** | 声明式能力字符串（见 §4）；未声明/未授予 → 拒绝，不静默降级 |
| **协议线 wire** | `{type:'t19-wire', direction, msg}` 的 postMessage 消息；内层是类型化协议消息 |
| **命令 command** | manifest `commands[]` 逐条声明的可调用名；`command.invoke` 前置于声明校验 |

## 2. 五分钟上手：最小 guest 包

目录（参考 `docs/ui-workshop/packs/pack-a`）：

```
my-pack/
├── manifest.json
├── index.html
├── pack.js
└── vendor/guest-sdk.js        # 从 docs/ui-workshop/sdk/dist/guest-sdk.js 复制（iife，全局 KeWorkshopSDK）
```

`manifest.json`（字段规范见 §3）：

```json
{
  "id": "com.example.hello",
  "name": "Hello 工坊包",
  "version": "1.0.0",
  "apiVersion": 1,
  "capabilities": ["ui.shell", "panel.sidebar", "context.read"],
  "entry": { "html": "index.html" },
  "commands": [{ "name": "doc.save", "handler": "save" }],
  "assets": [
    { "path": "index.html", "sha256": "<64 位小写 hex>" },
    { "path": "pack.js", "sha256": "<...>" },
    { "path": "vendor/guest-sdk.js", "sha256": "<...>" }
  ]
}
```

`index.html` + `pack.js`：

```html
<!doctype html><html><body>
  <button id="read">读取当前文档</button>
  <pre id="out"></pre>
  <script src="vendor/guest-sdk.js"></script>
  <script src="pack.js"></script>
</body></html>
```

```js
const conn = await KeWorkshopSDK.autoConnect({
  requestedFeatures: ['ui.shell', 'panel.sidebar', 'context.read'],
})
const snap = await conn.request('context.snapshot', { relPath: 'Articles/hello.md' })
document.getElementById('out').textContent = snap.content ?? '(无正文)'
setInterval(() => conn.heartbeat(), 200)
window.addEventListener('message', (e) => {
  const d = e.data
  if (d?.type === 't19-wire' && d.direction === 'host-to-guest' && d.msg?.type === 'event') {
    console.log('host event:', d.msg.event)
  }
})
```

构建/签名/安装（开发期，测试私钥只在本地）：

```bash
node docs/ui-workshop/tools/create_pack.mjs --dir my-pack --out my-pack.zip      # 打包（自动写 assets sha256）
node docs/ui-workshop/tools/sign_pack.mjs --in my-pack.zip --out my-pack.signed.zip \
  --key <测试私钥 hex> --key-id k1
# 产品安装：工坊面板「从 ZIP 安装」或 Rust 命令 workshop_pack_install（见 §9）
```

## 3. Manifest 规范

实现：`frontend/src/core/packs/manifest.ts`（`validateManifest`）。校验失败抛 `PackValidationError`（类型化 code）。

| 字段 | 规则 |
| --- | --- |
| `id` | `^[a-z0-9][a-z0-9.-]{1,80}$`（小写） |
| `name` | 非空字符串 |
| `version` | 语义版本 `\d+\.\d+\.\d+(-/+suffix)?` |
| `apiVersion` | 必须 = 宿主 `PACK_API_VERSION`（当前 1），否则 `E_API_VERSION` |
| `capabilities` | 必须全部在 allowlist 内（见 §4），不可重复；超出 → `E_CAPABILITY` |
| `entry.html` | 包内相对路径，必须在 `assets` 里 |
| `entry.sdk` | 可选；包内相对路径，必须在 `assets` 里 |
| `commands[]` | `name` 满足 `^[a-z][a-z0-9.-]{1,80}$`（**只允许小写/点/短横**，不能 camelCase）；`handler` 是标识符（如 `editorBold`），不是代码字符串 |
| `assets[]` | 每项必须有合法 64 位小写 `sha256`；`size` 可选；路径禁止绝对/穿越/隐藏路径（`E_PATH`）；不能重复 |

> **命令名大小写是硬约束**：`editor.bulletList` 这类 camelCase 无法在 manifest 声明；多词命令统一 kebab
>（`editor.bullet-list`），宿主内部映射到执行器键（见 §8）。

## 4. 能力模型

allowlist（`frontend/src/core/packs/manifest.ts` 的 `ALLOWED_CAPABILITIES`）：

| 能力 | 作用 | community | trusted | builtin |
| --- | --- | :-: | :-: | :-: |
| `ui.shell` | 协议线/握手/请求通道基础能力（Broker 要求） | ✗ | ✓ | ✓ |
| `panel.sidebar` / `panel.dock` | 面板定位 | ✓ | ✓ | ✓ |
| `context.read` | `context.snapshot` 返回正文 | ✗ | ✓ | ✓ |
| `context.write` | `context.write` 真实落盘（CAS/幂等） | ✗ | ✓ | ✓ |
| `print.request` | `print.snapshot` 走真实打印管线 | ✓ | ✓ | ✓ |
| `editor.commands.readonly` | `command.invoke` 的 `editor.*`/`doc.save` 受控命令 | ✗ | ✓ | ✓ |

规则（`frontend/src/core/packs/trustPolicy.ts`）：
1. **声明 ≠ 授予**：运行期能力 = 信任等级允许集合 ∩ manifest 声明；
2. 等级不允许的能力 → 安装/启用阶段直接拒绝（`E_CAPABILITY_TIER`），**不静默裁剪**；
3. 签名 `invalid` → 拒绝；`community` 来源为 downloaded 且未签名 → 按策略阻止（`E_UNSIGNED`）；
4. 建议**能力最小化**（只声明实际使用的能力；参考包 A/B 是范例）。

## 5. 协议线（wire / handshake / request / response / event）

实现：`frontend/src/core/protocol/types.ts`（类型契约）、`docs/ui-workshop/sdk/src/index.ts`（SDK）。

### 5.1 外层 wire（iframe postMessage）

```js
// host → guest / guest → host 统一包裹：
{ type: 't19-wire', direction: 'host-to-guest' | 'guest-to-host', msg: <内层协议消息> }
// 启动引导：
guest → { type: 't19-guest-alive' }    // 子页面就绪
host  → { type: 't19-port' }           // 宿主回端口，随后可握手
// 心跳：guest 周期发（SDK 每 200ms；宿主 8s 超时 → reportCrash）
guest → { type: 't19-heartbeat' }      // 或 window.postMessage({type:'guest-heartbeat'}) 旧式
```

### 5.2 握手

```js
{ type: 'handshake', protocolVersion: 1, sdkVersion: 'sdk-0.1.0', requestedFeatures: ['ui.shell', ...] }
// 回复：
{ type: 'handshake.response', ok: true, protocolVersion, hostVersion, acceptedFeatures: [...], contextId, epoch }
{ type: 'handshake.response', ok: false, error: { code, message, retryable } }
```

### 5.3 请求/响应

```js
{ type: 'request', requestId: 'sdk-1', method: 'context.snapshot', params: { relPath: 'Articles/a.md' } }
{ type: 'response', requestId: 'sdk-1', ok: true, result: {...} }
{ type: 'response', requestId: 'sdk-1', ok: false, error: { code: 'E_CAPABILITY', message: '缺少能力: context.read', retryable: false, details } }
// 取消（宿主可发）：{ type: 'cancel', requestId, reason? }
```

SDK 封装：`conn.request(method, params)`（超时默认 5000ms，超时 `E_TIMEOUT` retryable=true；
错误以 `SdkError{code,retryable}` 抛出）；`conn.handshake()`；`conn.heartbeat()`；`conn.close(reason)`。

### 5.4 错误码（guest 必须按 code 处理，不依赖 message 文本）

`E_VERSION` `E_UNKNOWN_METHOD` `E_BAD_PAYLOAD` `E_FORBIDDEN` `E_CAPABILITY` `E_CANCELED`
`E_TIMEOUT` `E_BUSY` `E_STALE_CONTEXT` `E_CONFLICT` `E_INTERNAL`（协议层）；
包/信任层另有 `E_MANIFEST` `E_API_VERSION` `E_PATH` `E_HASH` `E_ENTRY` `E_DUPLICATE` `E_CAPABILITY_TIER`
`E_SIGNATURE` `E_SIGNATURE_REVOKED` `E_UNSIGNED`。

## 6. 协议方法参考

### 6.1 `protocol.capabilities`
- params: `{}` → result: `{ protocolVersion, features: string[], contextId, epoch }`
- 用途：诊断当前连接实际能力（= tier ∩ manifest）。

### 6.2 `context.snapshot`（能力：`context.read`）
- params: `{ relPath: string }`（工作区相对 Markdown 路径）
- result: `{ relPath, revision, diskHash, content?, contentBytes? }`
- `content` 为当前 revision 的**完整原文**（含 BOM/frontmatter/CRLF，逐字节语义）；无能力时不含 content。
- 错误：非法路径 `E_BAD_PAYLOAD`；上下文失效 `E_STALE_CONTEXT`；后端异常 `E_INTERNAL`。

### 6.3 `context.write`（能力：`context.write`）
- params: `{ relPath, content, expectedRevision, requestId? }`
- result: `{ requestId, status: 'completed'|'conflict'|'stale'|'failed', kind?, revision?, currentRevision?, accepted?, recoveryDurable?, fileDurable? }`
- **CAS**：`expectedRevision` 与当前不一致 → `status:'conflict'`（`kind:'revision'`），不覆盖磁盘；
- 幂等：同一 `requestId` 重放安全；`completed` 表示真实落盘（文件 + 恢复日志），不是假成功。

### 6.4 `print.snapshot`（能力：`print.request`）
- params: `{ relPath: string }`（仅 `.md`）
- result: `{ pdfToken: string, pages: number | null }`
- 宿主走**真实打印管线**生成隔离 PDF；`pdfToken` 为不透明 token，`pages` 不可得时为 `null`（**禁止伪造页数**）。

### 6.5 `command.invoke`（能力：`editor.commands.readonly`；前置：manifest `commands[]` 声明）
- params: `{ name: string, args?: object }`
- result: `{ ok: true, value?: unknown }`（当前实现为 `{name, executed:true}`）
- 规则（实现：`frontend/src/components/workshop/productBrokerBackend.ts`）：
  1. `name` 必须在该包的 `manifest.commands` 中**逐条声明**（否则 `E_FORBIDDEN`）；
  2. 连接必须具备 `editor.commands.readonly`（否则 `E_CAPABILITY`）；
  3. 未知/非白名单命令 → `E_FORBIDDEN`；参数非法（参数化命令）→ `E_BAD_PAYLOAD` 且**不执行**；
  4. 执行器未就绪 → `E_INTERNAL`（message 含 `E_EDITOR_NOT_READY`）；执行失败 → `E_INTERNAL`+`E_COMMAND_EXECUTION_FAILED`。

## 7. 宿主事件（host → guest）

内层消息：`{ type: 'event', event: HostEvent }`。SDK 0.1.0 暂无事件订阅 API，guest 直接监听 wire 消息
（参考 `pack-a` 的 `onWireEvent`）。

| 事件 | 载荷 | 触发 |
| --- | --- | --- |
| `context-changed` | `{ contextId: string\|null, epoch: number\|null }` | 切换文档/上下文 |
| `theme-changed` | `{ theme: 'light'\|'dark'\|'system' }` | 产品主题切换 |
| `selection-changed` | `{ text: string, empty: boolean }` | 编辑器选区变化（可能节流） |
| `document-saved` | `{ relPath: string, revision: number }` | 保存成功（产品真实 revision） |
| `host-shutdown` | `{ reason: string }` | 宿主要求 guest 退出 |

## 8. `command.invoke` 命令白名单（21 条协议名）

以下为**跨包通用协议名**（各包仍需在 manifest 逐条声明；未声明即拒绝）。

### 8.1 切换类（14）

`editor.bold` `editor.italic` `editor.underline` `editor.strike` `editor.code`
`editor.heading1` `editor.heading2` `editor.heading3`
`editor.bullet-list` `editor.ordered-list` `editor.blockquote` `editor.code-block`
`editor.undo` `editor.redo`

- 无参数（带非空 args → `E_BAD_PAYLOAD`）；
- 语义与工具栏一致（EditorArea 执行器），作用于主窗口当前编辑器。

### 8.2 无参动作（2）

| 协议名 | 语义 |
| --- | --- |
| `editor.footnote.insert` | 插入脚注 |
| `editor.note.insert` | 插入信息块 |

> `doc.save` 同为无参动作，单独列在 §8.4；`editor.table.insert` 已在 v12 升级为参数化命令（见 §8.3）。

### 8.3 参数化动作（4）

| 协议名 | args schema | 校验（失败 `E_BAD_PAYLOAD`，不执行） |
| --- | --- | --- |
| `editor.link.insert` | `{href, text?}` | href 仅 `http(s)://`/`mailto:`、≤2048、无空白/控制字符；text ≤500；有选区 setLink，无选区插入文本（text\|\|href） |
| `editor.math.inline` | `{latex}` | 非空、≤2000、无控制字符；直接插入 `math` 节点（**不开对话框**） |
| `editor.math.block` | `{latex}` | 同上 → `mathBlock` |
| `editor.table.insert` | `{rows?, cols?, withHeaderRow?}` | rows/cols 整数 1–8（缺省 3）、withHeaderRow 布尔（缺省 true） |

**不暴露**：`editor.link`/`image`/`math`/`module` 的对话框/文件选择类动作（无头环境会阻塞）；
`editor.bold` 等 camelCase 旧名仅宿主 legacy 兼容直调，**manifest 无法声明**（schema 限制）。

### 8.4 `doc.save`
- 协议名 `doc.save`（属 action 类，需 `editor.commands.readonly` + 声明）；触发产品保存动作；
- 真实落盘由产品保存链保证；验证时**必须查磁盘内容/mtime**，不能只看返回值。

## 9. 安装 / 信任 / 启用生命周期

### 9.1 产品侧 Rust 命令（前端经 Tauri `invoke` 调用）

| 命令 | 用途 |
| --- | --- |
| `workshop_pack_scan` / `workshop_pack_install` | 扫描本地目录清单 → 独立事务安装 |
| `workshop_pack_stage_zip` / `workshop_pack_install_staged` / `workshop_pack_abort_staged` | ZIP 离线包预览/安装/取消 |
| `workshop_pack_verify` | 校验包（清单/资产/签名状态） |
| `workshop_pack_list` | 列出已安装包（含 active/previous/signatureStatus） |
| `workshop_pack_activate` / `workshop_pack_rollback` / `workshop_pack_uninstall` | 版本切换/回滚/卸载 |
| `workshop_pack_recover` / `workshop_pack_recover_all` / `workshop_pack_startup_status` | 启动恢复（journal/损坏回滚）与只读恢复状态 |
| `workshop_pack_session_status` / `workshop_pack_session_report` | guest 会话状态落盘/读取 |
| `workshop_pack_read_asset` | 按白名单读取包内资源 |

### 9.2 状态机（面板/适配器视角）

```
安装（scan→verify→install 事务） → tier=community（默认）
  → 用户「授予信任」→ tier=trusted → 「启用 guest」→ session: starting → active
  → 停用 → stopped；崩溃 → reportCrash → safeMode（连续失败）
  → 卸载（程序/数据按策略）；启动恢复：rollback-corrupt-active / cleanup-journal
```

### 9.3 前端适配器接口（`WorkshopAdapter`，`components/workshop/WorkshopPanel.tsx`）

`listInstalled / stageFromFile / confirmInstall / cancelPreview / rollback / recover / recoverAll? /
startupStatus? / uninstall? / tierOf? / grantTrust? / revokeTrust? / createGuestBackend? / stageFromZip?`

产品实现：`frontend/src/core/packs/tauriPackAdapter.ts`（默认）；测试/嵌入可注入替身。

## 10. 宿主前端接入点（把工坊接进另一个前端 UI）

| 接入点 | 文件 | 用法 |
| --- | --- | --- |
| 入口按钮 | `components/workshop/WorkshopEntry.tsx` | `<WorkshopEntry enabled={VITE_KE_WORKSHOP==='1'} adapter?={...} />`；默认关闭零影响 |
| 控制面板 | `components/workshop/WorkshopPanel.tsx` | 传入 `WorkshopAdapter`（安装/信任/启用/恢复） |
| guest 容器 | `components/workshop/WorkshopGuestFrame.tsx` | iframe（独立 origin）+ wire + 心跳（8s 超时）+ 事件桥；需 `ProductHostBackend` |
| 能力后端 | `components/workshop/productBrokerBackend.ts` | 真实 context 读/写、打印、命令桥、能力过滤 |
| 编辑器执行器 | `components/layout/EditorArea.tsx` | 注册 `window.__KE_WORKSHOP_EDITOR__`（仅主窗口、卸载清理） |
| 宿主事件桥 | `components/workshop/hostEventBridge.ts` | 产品 window 事件 → `document-saved`/`context-changed`/`theme-changed` |
| 健康提示 | `components/runtime/RuntimeHealthBanner.tsx` | sidecar/运行时不可用的 UI 提示（能力不可用时不误报） |

**最小接线（宿主）**：入口 `WorkshopEntry` + 适配器 `createTauriPackAdapter()`；面板启用时通过
`createGuestBackend()` 建 `ProductHostBackend` 交给 `WorkshopGuestFrame`。UI 接入约定见
`reports/AGENT-FRONTEND-INTEGRATION-RUNBOOK.md`。

## 11. 安全模型与红线

- guest 在 **独立 origin**（`workshop.localhost`）iframe 中运行；不继承宿主 window/Internals 权限；
- **CSP 网络边界**（W06）：`connect-src 'none'`——guest 不能直调后端 `/api/*`，只能用受控协议；
- 能力声明式 + tier 上限 + manifest 命令逐条声明；未声明/未授予一律拒绝（`E_FORBIDDEN`/`E_CAPABILITY`）；
- 命令白名单最小化：21 条协议名（14 切换 + 4 参数化 + 2 无参动作）+ `doc.save`；不暴露任意命令执行、不暴露对话框类；
- 写通道 CAS + 幂等 requestId + 真实落盘语义；打印页数不可得时为 null（不伪造）；
- 信任等级持久化在宿主设置（`TrustStore`）；安装事务化（不留半成品）。

## 12. 调试与验证

```bash
# SDK 自检（无需产品）
node docs/ui-workshop/sdk/build.mjs && node docs/ui-workshop/sdk/self-test.mjs    # 4/4

# 打包 / 签名工具自检
node docs/ui-workshop/tools/create_pack.mjs --self-test
node docs/ui-workshop/tools/sign_pack.mjs --self-test

# 仓库级验证
python3 docs/ui-workshop/tools/build_validation_matrix.py --check          # MATRIX GATE: PASS
python3 docs/ui-workshop/tools/verify_delivery_consistency.py              # 9/9 PASS（含 DC-9 接口维护）

# 产品 W（仅 Windows，隔离构建；顺序执行、窗口独占、隔离 APPDATA/工作区）
python tools/run_t26_pack_editor_cmd_probe.py --pack a    # 命令桥 36/36
python tools/run_t26_guest_io_probe.py                    # G1/G2 14/14
python tools/run_reference_packs_probe.py                 # 参考包 24/24
```

**常见错误对照**：`E_FORBIDDEN`（未声明/未授权命令）→ 检查 manifest `commands`；
`E_CAPABILITY`（能力未授予）→ 检查 tier 与 capabilities；`E_BAD_PAYLOAD`（参数非法）→ 对照 §8.3；
`E_STALE_CONTEXT`/`conflict`（上下文/revision 过期）→ 重新 snapshot 后用新 revision 写；
`E_TIMEOUT`（可重试）→ 宿主忙/超时，按 retryable 处理。

## 13. 版本兼容与已知限制

| 项 | 说明 |
| --- | --- |
| 协议版本 | `PROTOCOL_VERSION=1`；新增方法须升版本或走能力协商；破坏性变更由 contract 测试拦截 |
| SDK | 发布形态 `docs/ui-workshop/sdk/dist/guest-sdk.js|mjs`（iife 全局 `KeWorkshopSDK`）；`0.1.0` 暂无事件订阅 API（监听 wire `event`） |
| 命令名 | 多词命令必须 kebab（`editor.bullet-list`）；camelCase 不可声明（schema 硬约束） |
| 对话框类 | link/image/math/module 的交互式对话框未接命令桥（`E_FORBIDDEN` 拒绝）；参数化无头版本见 §8.3 |
| W07 已知限制 | C2-7 不自动修复损坏包（数据安全，需卸载重装）；B1-6/B2-5 运行时不自愈（重启可恢复） |
| 平台 | 产品 W 证据仅 Windows/WebView2 有效；T27 I 门禁（安装/升级/回滚）当前环境未执行（见 `reports/DECISION-T27-I-gate-blocked.md`） |

## 14. 参考实现与证据

| 内容 | 位置 |
| --- | --- |
| 参考包 A（侧栏阅读器：读/打印/事件/21 命令） | `docs/ui-workshop/packs/pack-a/` |
| 参考包 B（元数据表单 + 参数化 UI；23 条命令 = 21 条通用协议名 + 2 条 article.*） | `docs/ui-workshop/packs/pack-b/` |
| guest SDK 源码与发布 dist | `docs/ui-workshop/sdk/` |
| 协议/包/信任实现 | `frontend/src/core/protocol/types.ts`、`core/packs/{manifest,trustPolicy,packageHost,productHostAdapter}.ts`、`components/workshop/*` |
| 产品 W 证据 | `docs/ui-workshop/evidence/`（G1/G2、G3/G4、G7、packA/B 命令桥、B 段冒烟等） |
| 验收矩阵/状态 | `validation-matrix.csv`、`reports/FINAL-DELIVERY-STATUS.md` |
| 前端 UI 接入 Runbook | `reports/AGENT-FRONTEND-INTEGRATION-RUNBOOK.md` |
