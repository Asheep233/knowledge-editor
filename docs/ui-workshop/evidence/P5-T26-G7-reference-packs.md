# P5-T26 G7：pack A/B 参考 UI（SDK 发布形态）+ 产品 W 安装启用证据

- 生成时间：2026-10-19T11:20:30+0800
- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 11 + WebView2 隔离产品构建
- 测试构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256=`764f191b71d82e3598039c246f340933ab6fd6d1557e4824ac3ad3d7895328fe`，mtime=`2026-10-19T10:33:12`）
- 参考包（源码）：`docs/ui-workshop/packs/pack-a/`、`docs/ui-workshop/packs/pack-b/`；构建工具 `docs/ui-workshop/tools/build_reference_packs.mjs`
- 签名：ed25519 keyId=`k1`，公钥=`8b6ed878888e8b480cc5357aaa9b6085f8129a34a939cde22937c8fbdf1d4dd6`（**测试自签**；密钥只在 `C:\ke-tmp` 隔离目录，不入仓）
- 被测包：A=`com.astranota.examples.pack-a`（capabilities=`["ui.shell", "panel.sidebar", "context.read", "print.request"]`）；B=`com.astranota.examples.pack-b`（capabilities=`["ui.shell", "panel.dock", "context.read"]`，commands=`["article.set-title", "article.set-tags"]`）
- 隔离工作区：`C:\ke-tmp\uiws-t26-g7\workspace`；隔离 APPDATA：`C:\ke-tmp\uiws-t26-g7\appdata`；测试文档：`Articles/g7-demo.md`；PDF 输出：`C:\ke-tmp\uiws-t26-g7\pdf-out`
- 启动 env：`KE_WS_PRINT_RENDER=1`（T16 隐藏打印 renderer 门控）+ `KE_WORKSHOP_PUBKEYS`（测试公钥）
- 驱动方式：CDP 主窗口 + 浏览器级 `Target.attachToTarget`（flatten）附加 guest iframe（OOPIF）→ 在 **guest 真实 DOM** 上执行输入/按钮点击；结论同时读取 guest 状态镜像（`t19-guest-results`）与宿主侧会话/注册表/磁盘

## 结论

**PASS**：24/24 checks 通过。本证据只覆盖下列 checks；未覆盖/未执行的部分见「限制与残余风险」。

## 被测参考包

| 包 | 用例 | 能力（manifest 声明 / 运行期授予） | 构建产物 |
| --- | --- | --- | --- |
| A | 侧栏读场景：快照正文/标题、document-saved 自动刷新、真实打印、错误展示 | `["ui.shell", "panel.sidebar", "context.read", "print.request"]` | `packs/dist/com.astranota.examples.pack-a/` + `com.astranota.examples.pack-a-1.0.0.zip` |
| B | Dock 写场景：快照/表单自动填充、command.invoke title/tags 落盘、错误展示 | `["ui.shell", "panel.dock", "context.read"]`（写走声明式命令，不声明 context.write） | `packs/dist/com.astranota.examples.pack-b/` + `com.astranota.examples.pack-b-1.0.0.zip` |

## Checks

| # | check | 结果 | 关键值 |
| --- | --- | --- | --- |
| 1 | W-G7-1 构建工具产出两个签名参考包（A/B）：dist manifest assets sha256/size 与实际文件一致、签名为 ed25519/k1 128hex、zip 根含 manifest+资产 | PASS | `{"packs": {"com.astranota.examples.pack-a": {"distDir": "C:\\ke-tmp\\uiws-t26-g7\\dist\\com.astranota.examples.pack-a", "signature": {"alg": "ed25519", "keyId": "k1", "signatureLen": 128}, "assets": [{"path": "index.html", "declaredSha256": "b26958cdc3e1e011c8…` |
| 2 | W-G7-2 构建幂等：`--check` 通过（源 manifest assets 哈希已回写、vendored SDK 已同步） | PASS | `{"exit": 0, "stderrTail": "[build_reference_packs] CHECK OK: 2 packs · manifest 更新 0 · vendored SDK 同步 0 · 签名 ed25519 keyId=k1 pub=8b6ed878888e8b48…（provided）\n"}` |
| 3 | W-G7-3 源 manifest（入库）只含哈希/大小、不含签名，且与 dist 签名清单字段一致 | PASS | `{"com.astranota.examples.pack-a": {"sourceManifest": "F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\packs\\pack-a\\manifest.json", "signedInSource": false, "alignedWithDist": true}, "com.astranota.examples.pack-b": {"sourceManifest": "F:\\Work\\KE…` |
| 4 | W-G7-4 隔离产品实例启动 + CDP 主窗口就绪（工坊入口已渲染，WebView2 IPC 可用） | PASS | `{"port": 9806, "exeSha256": "764f191b71d82e3598039c246f340933ab6fd6d1557e4824ac3ad3d7895328fe", "exeMtime": "2026-10-19T10:33:12"}` |
| 5 | W-G7-5 安装参考包 A（Rust 安装成功；产品侧签名校验 valid） | PASS | `{"install": {"ok": true, "value": {"active": "1.0.0", "previous": null, "updatedAt": "SystemTime { intervals: 134368536186323381 }"}}, "verify": {"ok": true, "value": true}, "sourceDir": "C:\\ke-tmp\\uiws-t26-g7\\dist\\com.astranota.examples.pack-a"}` |
| 6 | W-G7-6 授予参考包 A trusted（面板显示签名 valid + 信任 trusted） | PASS | `{"clicked": true, "trustedVisible": true, "signatureValidVisible": true}` |
| 7 | W-G7-7 pack A 会话 active 且 guest iframe 已挂载；运行期能力 = 声明最小集（无多余能力） | PASS | `{"state": "active", "capabilities": ["ui.shell", "panel.sidebar", "context.read", "print.request"], "guestSessionFound": true, "guestStatusLog": ["starting", "active", "active"], "isolationResidual": true, "iframeTargets": [{"targetId": "7E1F6BE9A387A1EED28E26…` |
| 8 | W-G7-8 pack A 内发布 SDK `autoConnect` 握手成功（acceptedFeatures/contextId/epoch/hostVersion） | PASS | `{"handshake": {"protocolVersion": 1, "hostVersion": "product-guest-host", "contextId": "ke-default", "epoch": 1}, "acceptedFeatures": ["ui.shell", "panel.sidebar", "context.read", "print.request"], "sdkVersion": "0.1.0"}` |
| 9 | W-G7-9 pack A 心跳：宿主收到 t19-heartbeat 计数增长；guest UI 心跳计数增长 | PASS | `{"hostHeartbeatsBefore": 0, "hostHeartbeatsAfter": 5, "guestHeartbeatBefore": 0, "guestHeartbeatAfter": 5}` |
| 10 | W-G7-10 pack A 经真实 UI「读取快照」→ 展示 frontmatter 标题 + 真实正文（=磁盘原文语义）+ revision/diskHash | PASS | `{"snapshot": {"relPath": "Articles/g7-demo.md", "revision": 0, "diskHash": "76f3f9440ecb89eb339887a0343eff7ffb3f9f128427e7e9559ecfcd6d9c43a2", "hasContent": true, "contentLen": 80}, "domTitle": "G7 参考文档", "domContentHead": "参考包正文：读场景与写场景。\n\n- 侧栏阅读器展示标题与内容片段\n…` |
| 11 | W-G7-11 pack A 错误展示：宿主返回类型化错误（非法打印路径 → E_BAD_PAYLOAD）时 UI 明文展示，不静默 | PASS | `{"errorVisible": true, "errorText": "E_BAD_PAYLOAD: print.snapshot relPath 非法: ../escape.md", "printResultDom": "失败：print.snapshot relPath 非法: ../escape.md", "probe": "print.snapshot relPath=../escape.md"}` |
| 12 | W-G7-12 pack A「打印快照」→ print.snapshot 返回真实不透明 pdfToken，对应隔离目录真实 PDF（%PDF、大小>1000） | PASS | `{"printResult": {"pdfToken": "pdf-mveosbb7-xsaq1vh6", "pages": null}, "tokenEntry": {"pdfToken": "pdf-mveosbb7-xsaq1vh6", "pdfPath": "C:\\ke-tmp\\uiws-t26-g7\\pdf-out\\print-g7-demo-r0-mveosb4ck3.pdf", "relPath": "Articles/g7-demo.md", "revision": 0, "pages": …` |
| 13 | W-G7-13 打印期间/之后 guest 会话未被心跳误判（state 仍 active；G3 心跳超时放宽回归） | PASS | `{"stateAfterPrint": "active"}` |
| 14 | W-G7-14 pack A 收到宿主真实保存触发的 document-saved 事件（relPath/revision）并在 UI 展示 | PASS | `{"saved": true, "savedBy": "autosave", "lastEvent": {"type": "document-saved", "relPath": "Articles/g7-demo.md", "revision": 1, "receivedAt": 1792380024998}, "domLastEvent": "document-saved · Articles/g7-demo.md · revision=1"}` |
| 15 | W-G7-15 pack A 事件后自动刷新快照：revision 与事件一致、正文含真实保存标记（读到的不是旧内容） | PASS | `{"autoSnapshot": {"revision": 1, "reason": "document-saved", "tail": "参考包正文：读场景与写场景。\n\n- 侧栏阅读器展示标题与内容片段\n- Dock 表单提交 title/tags\n\nG7-SAVE-MARKER"}, "eventRevision": 1, "diskHasMarker": true}` |
| 16 | W-G7-16 停用 pack A guest 生效：会话 stopped/failed/idle + guest iframe 卸载（旧连接载体关闭） | PASS | `{"stopClicked": true, "state": "stopped", "guestIframes": 0}` |
| 17 | W-G7-17 安装参考包 B（Rust 安装成功；产品侧签名校验 valid） | PASS | `{"install": {"ok": true, "value": {"active": "1.0.0", "previous": null, "updatedAt": "SystemTime { intervals: 134368536256546230 }"}}, "verify": {"ok": true, "value": true}, "sourceDir": "C:\\ke-tmp\\uiws-t26-g7\\dist\\com.astranota.examples.pack-b"}` |
| 18 | W-G7-18 pack B 会话 active；运行期能力 = 声明最小集（ui.shell/panel.dock/context.read） | PASS | `{"state": "active", "capabilities": ["ui.shell", "panel.dock", "context.read"], "sessionFull": {"capabilities": ["ui.shell", "panel.dock", "context.read"], "lastError": null, "packId": "com.astranota.examples.pack-b", "state": "active", "updatedAt": "SystemTim…` |
| 19 | W-G7-19 pack B guest 内发布 SDK 握手成功 + 心跳计数增长 | PASS | `{"handshake": {"protocolVersion": 1, "hostVersion": "product-guest-host", "contextId": "ke-default", "epoch": 1}, "acceptedFeatures": ["ui.shell", "panel.dock", "context.read"], "hostHeartbeats": [32, 36], "guestHeartbeats": [0, 5], "declaredCommands": ["artic…` |
| 20 | W-G7-20 pack B 经真实 UI 读取快照：展示正文 + 从 frontmatter 自动填充 title（tags 为空可接受） | PASS | `{"snapshot": {"relPath": "Articles/g7-demo.md", "revision": 1, "hasContent": true, "contentLen": 109}, "titleInput": "G7 参考文档", "tagsInput": "", "domContentHead": "参考包正文：读场景与写场景。\n\n- 侧栏阅读器展示标题与内容片段\n- Dock 表单提交 title/tags\n\nG7-SAVE-MARKER"}` |
| 21 | W-G7-21 pack B「提交标题」经 command.invoke（article.set-title）成功，后端真实落盘 frontmatter title | PASS | `{"commandResult": {"name": "article.set-title", "ok": true, "value": {"ok": true, "value": {"relPath": "Articles/g7-demo.md", "title": "G7 表单标题", "tags": []}}, "at": 1792380027838}, "frontmatter": "\nke_version: 1\ntitle: G7 表单标题\n", "domCommandResult": "artic…` |
| 22 | W-G7-22 pack B「提交标签」经 command.invoke（article.set-tags）成功，后端真实落盘 frontmatter tags | PASS | `{"commandResult": {"name": "article.set-tags", "ok": true, "value": {"ok": true, "value": {"relPath": "Articles/g7-demo.md", "title": "G7 表单标题", "tags": ["g7", "probe"]}}, "at": 1792380028240}, "frontmatter": "\nke_version: 1\ntitle: G7 表单标题\ntags:\n  - g7\n  …` |
| 23 | W-G7-23 pack B 错误展示：空标题被宿主命令白名单拒绝（E_TITLE），UI 明文显示错误，磁盘 title 未被改 | PASS | `{"errorVisible": true, "errorText": "E_INTERNAL: E_TITLE: 标题为空或过长", "lastError": {"code": "E_INTERNAL", "message": "E_TITLE: 标题为空或过长"}, "frontmatterAfterError": "\nke_version: 1\ntitle: G7 表单标题\ntags:\n  - g7\n  - probe\n"}` |
| 24 | W-G7-24 主进程存活 / 用户实例未受影响（未运行 → N/A）/ guest 已停用（无残留会话） | PASS | `{"procAlive": true, "userPid": "(not running)", "ourProcesses": 1, "finalSessionState": "stopped", "workshopAppLogTail": "\n[sidecar] INFO:     127.0.0.1:61457 - \"GET /api/fs/events?since=1 HTTP/1.1\" 200 OK\n[sidecar] INFO:     127.0.0.1:61457 - \"POST /api/…` |

## 关键实测值

```json
{
  "packA": {
    "install": {
      "ok": true,
      "value": {
        "active": "1.0.0",
        "previous": null,
        "updatedAt": "SystemTime { intervals: 134368536186323381 }"
      }
    },
    "verify": {
      "ok": true,
      "value": true
    },
    "session": {
      "state": "active",
      "capabilities": [
        "ui.shell",
        "panel.sidebar",
        "context.read",
        "print.request"
      ],
      "lastError": null
    },
    "handshake": {
      "protocolVersion": 1,
      "hostVersion": "product-guest-host",
      "contextId": "ke-default",
      "epoch": 1
    },
    "snapshot": {
      "relPath": "Articles/g7-demo.md",
      "revision": 0,
      "diskHash": "76f3f9440ecb89eb339887a0343eff7ffb3f9f128427e7e9559ecfcd6d9c43a2",
      "hasContent": true,
      "contentLen": 80,
      "title": "G7 参考文档",
      "snippet": "参考包正文：读场景与写场景。\n\n- 侧栏阅读器展示标题与内容片段\n- Dock 表单提交 title/tags",
      "reason": "manual"
    },
    "printResult": {
      "pdfToken": "pdf-mveosbb7-xsaq1vh6",
      "pages": null
    },
    "lastEvent": {
      "type": "document-saved",
      "relPath": "Articles/g7-demo.md",
      "revision": 1,
      "receivedAt": 1792380024998
    },
    "autoSnapshotRevision": 1,
    "stopState": "stopped",
    "dom": {
      "docTitle": "G7 参考文档",
      "docContentHead": "参考包正文：读场景与写场景。\n\n- 侧栏阅读器展示标题与内容片段\n- Dock 表单提交 title/tags",
      "lastEvent": "document-saved · Articles/g7-demo.md · revision=1",
      "errorText": "E_BAD_PAYLOAD: print.snapshot relPath 非法: ../escape.md"
    }
  },
  "packB": {
    "install": {
      "ok": true,
      "value": {
        "active": "1.0.0",
        "previous": null,
        "updatedAt": "SystemTime { intervals: 134368536256546230 }"
      }
    },
    "verify": {
      "ok": true,
      "value": true
    },
    "session": {
      "state": "active",
      "capabilities": [
        "ui.shell",
        "panel.dock",
        "context.read"
      ],
      "lastError": null
    },
    "handshake": {
      "protocolVersion": 1,
      "hostVersion": "product-guest-host",
      "contextId": "ke-default",
      "epoch": 1
    },
    "snapshot": {
      "relPath": "Articles/g7-demo.md",
      "revision": 1,
      "hasContent": true,
      "contentLen": 109,
      "title": "G7 参考文档",
      "tags": []
    },
    "titleCommand": {
      "name": "article.set-title",
      "ok": true,
      "value": {
        "ok": true,
        "value": {
          "relPath": "Articles/g7-demo.md",
          "title": "G7 表单标题",
          "tags": []
        }
      },
      "at": 1792380027838
    },
    "tagsCommand": {
      "name": "article.set-tags",
      "ok": true,
      "value": {
        "ok": true,
        "value": {
          "relPath": "Articles/g7-demo.md",
          "title": "G7 表单标题",
          "tags": [
            "g7",
            "probe"
          ]
        }
      },
      "at": 1792380028240
    },
    "errorCommand": {
      "code": "E_INTERNAL",
      "message": "E_TITLE: 标题为空或过长"
    },
    "disk": {
      "frontmatterAfterTitle": "\nke_version: 1\ntitle: G7 表单标题\n",
      "frontmatterAfterTags": "\nke_version: 1\ntitle: G7 表单标题\ntags:\n  - g7\n  - probe\n"
    }
  }
}
```

## 参考包实现要点（可复用）

| 层 | 实现 |
| --- | --- |
| 包结构 | `manifest.json` + 入口 `index.html` + 相对引用 `pack.css` / `pack.js` / `vendor/guest-sdk.js`；构建工具回写 assets sha256/size、签名只进 dist、zip 根含 manifest+资产 |
| SDK 形态 | 包内 vendored `docs/ui-workshop/sdk/dist/guest-sdk.js`（iife，全局 `KeWorkshopSDK`）；`autoConnect({requestedFeatures})` → 握手 → `request(method, params)` + 200ms `heartbeat()` |
| pack A | 读 `context.snapshot`（content/contentBytes）展示标题/正文/revision/diskHash；按 wire 监听 `event`（document-saved → 自动重读）；「打印快照」→ `print.snapshot`（真实 PDF token，pages=null 不伪造）；错误框展示类型化错误 |
| pack B | 读快照展示正文 + frontmatter 解析填充表单；`command.invoke` 提交 `article.set-title`/`article.set-tags`（宿主白名单 → 后端原子写 meta）；空标题 → 显示宿主拒绝错误 |
| 能力最小化 | A 只声明 ui.shell/panel.sidebar/context.read/print.request；B 只声明 ui.shell/panel.dock/context.read（不声明 context.write，写走命令）；运行期能力与声明**逐项一致** |
| 可观测性 | 状态镜像经既有 `t19-guest-results` 消息（宿主组件本就收集）→ 探针可读；UI 内同时有人类可读状态/错误 |

## 限制与残余风险（如实记录）

- **签名密钥为测试自签**：本证据用每次运行临时生成的 ed25519 密钥（`C:\ke-tmp\uiws-t26-g7\keys\`，不入仓；产物 dist 已 gitignore）；产品通过 `KE_WORKSHOP_PUBKEYS` 注入公钥。正式分发仍需密钥管理/信任根（W04 未完成项）。
- **打印 renderer 仍是 env 门控（`KE_WS_PRINT_RENDER=1`）**：默认发布启动不创建隐藏 renderer，`print.snapshot` 会如实返回错误（不伪造成功）；参考包 A 的打印按钮在默认发布环境会显示该错误。产品化默认开启需 Rust 改动（T16 既有设计）。
- **PDF 输出目录隔离用产品诊断覆盖**：Tauri `appDataDir()` 走 Windows known folder（不读 `APPDATA` env），探针设置 `window.__KE_PRINT_OUTPUT_DIR__=<C:\ke-tmp>\pdf-out`（生产不设置 → appDataDir）。该覆盖是测试/排障 seam。
- **发布 SDK 0.1.0 没有事件订阅 API**：参考包按协议 wire 直接监听 `{type:'event', event}`；这是 SDK 发布形态的已知缺口（建议后续 `onEvent()`），未在本任务扩 SDK（超出允许改动范围）。
- **guest 无「当前打开文档 relPath」发现通道**：协议握手与 `context-changed` 均不带当前文档路径；参考包 A 需用户输入路径或等 `document-saved` 事件（事件带 relPath）；B 同。属产品协议缺口（F 审计相关），参考包按现状实现。
- **驱动方式说明**：探针通过 CDP 附加 guest iframe（OOPIF）后在 guest 真实 DOM 上点击/输入（等价用户操作），结论仍以 guest 状态镜像 + 宿主侧数据为准；这不是 mock，宿主/后端/SDK/协议全为真实链路。
- **隔离残余风险（既有）**：guest 页面出现 `E_ISOLATION_RESIDUAL: guest 可见 __TAURI_INTERNALS__` 横幅（remote IPC 已拒绝），沿用 `evidence/P5-T26-A7-isolation.md` 结论，与参考包无关。
- **frontmatter 解析为 demo 级**：参考包用简单正则解析 title/tags（覆盖行内/YAML 列表/逗号写法），不是完整 YAML 解析器；生产包应按需引入解析库（注意 CSP 禁网络，需内置）。
- **打印页数不可得**：`pages: null`（Rust PrintToPdf 不回传页数，不伪造）。
- **测试构建独立 identifier 目录清理**：`%APPDATA%\com.astranota.uiws.e2e`（测试构建 identifier，非用户 App 数据）在开始/结束清理；用户 App（`D:\AstraNota`）未运行，未触碰。
- 本证据为**隔离测试构建**上的 Windows 产品 W，不等于官方 UI 全量基线；不替代 F01–F16 逐项登记。

## 复现

```powershell
# 前置：sdk/dist/guest-sdk.js 已存在（node docs/ui-workshop/sdk/build.mjs）；
#      隔离测试构建 C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe 已含 G1/G2/G3/G4（本任务未重建 exe）
$env:PYTHONIOENCODING='utf-8'
& 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_reference_packs_probe.py'
```

原始 JSON：`docs/ui-workshop/evidence/T26-G7-reference-packs-results.json`
