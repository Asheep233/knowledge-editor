# P5-T26 G3/G4：print.snapshot 真实打印管线 + 宿主事件发射（隔离产品 W 证据）

- 生成时间：2026-10-19T10:37:09+0800
- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 隔离产品构建
- 测试构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256=`764f191b71d82e3598039c246f340933ab6fd6d1557e4824ac3ad3d7895328fe`，mtime=`2026-10-19T10:33:12`）
- guest 包：`com.probe.t26g3g4`（capabilities=`["ui.shell","context.read","print.request"]`，签名 keyId=k1，trusted）
- 隔离工作区：`C:\ke-tmp\uiws-t26-g3g4\workspace`；隔离 APPDATA：`C:\ke-tmp\uiws-t26-g3g4\appdata`；测试文档：`Articles/print-test.md`
- 启动 env：`KE_WS_PRINT_RENDER=1`（T16 隐藏打印 renderer 门控，既有产品设计）
- PDF 输出：`C:\ke-tmp\uiws-t26-g3g4\pdf-out`（隔离 BASE 下；产品诊断覆盖 `window.__KE_PRINT_OUTPUT_DIR__`，默认生产为 `appDataDir()`）
- 场景：guest 真实协议线 → 真实打印（两次 + 负向）→ 宿主真实保存/切档/主题变化 → guest 收到 HostEvent

## 结论

**PASS**：18/18 checks 通过。本证据只覆盖下列 checks；未覆盖/未执行的部分见「限制与残余风险」。

## 两轮 W 记录（修复前 → 修复后）

- **首轮**（exe sha256 前 16=`d0a1b8bf202e250f`，mtime 2026-10-19 10:24）：**14/18 PASS**。
- **本轮**（exe sha256 前 16=`764f191b71d82e35`，mtime 2026-10-19 10:33）：见上「结论」。

首轮 4 个 FAIL 的根因与修复（均已包含在本轮构建）：

| # | 首轮 FAIL | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | PDF 落在真实 `%APPDATA%\com.astranota.uiws.e2e`（非 C:\ke-tmp） | Tauri `appDataDir()` 走 Windows known folder，**不读 `APPDATA` env** | 打印输出增加诊断覆盖 `window.__KE_PRINT_OUTPUT_DIR__`（生产不设置 → appDataDir 不变；W 定向到 `C:\ke-tmp\...\pdf-out`） |
| 2 | 会话 `suspended`（首轮 16 checks 中会话检查 FAIL） | Rust PrintToPdf 在主线程 message pump 等待，打印阻塞主窗口事件循环 > 默认 1200ms guest 心跳超时 → 误判崩溃 | `WorkshopGuestFrame` guest 心跳超时放宽到 8s（组件内配置；更彻底需打印移出主线程） |
| 3 | 宿主侧无 `ke:workshop-theme-changed` window 事件 | 主题观察在 frame 内直接 `dispatcher.emit`，未走统一 window 事件链 | frame 观察 `data-theme` → dispatch window 事件 → HostEventBridge → emit（与保存/切档同链路） |
| 4 | 渲染器状态文件读不到 | 探针按隔离 `APPDATA` 读，实际在真实 known-folder 的测试 identifier 目录 | 探针改从真实 `%APPDATA%\com.astranota.uiws.e2e` 读（开始/结束清理该测试 identifier 目录）；同轮发现并修复「CDP 目标误选隐藏 print-render 页」的探针缺陷 |

## Checks

| # | check | 结果 | 关键值 |
| --- | --- | --- | --- |
| 1 | W-T26-G3G4-1 隔离产品实例启动 + CDP 主窗口就绪（工坊入口已渲染，WebView2 IPC 可用） | PASS | `{"port": 9430, "target": "http://tauri.localhost/"}` |
| 2 | W-T26-G3G4-2 隐藏打印 renderer 创建成功（KE_WS_PRINT_RENDER=1 状态文件 ok） | PASS | `{"statusFile": "C:\\Users\\y8882\\AppData\\Roaming\\com.astranota.uiws.e2e\\print-render-status.json", "status": {"ok": true}}` |
| 3 | W-T26-G3G4-3 安装声明 print.request 的签名包（Rust ALLOWED_CAPS 放行） | PASS | `{"ok": true, "value": {"active": "1.0.0", "previous": null, "updatedAt": "SystemTime { intervals: 134368510206304050 }"}}` |
| 4 | W-T26-G3G4-4 会话 active 且运行期能力含 print.request | PASS | `{"state": "active", "capabilities": ["ui.shell", "context.read", "print.request"], "guestStatusLog": ["starting", "active", "active"]}` |
| 5 | W-T26-G3G4-5 握手能力协商含 print.request + context.read（G3/G4 前提） | PASS | `{"acceptedFeatures": ["ui.shell", "context.read", "print.request"]}` |
| 6 | W-T26-G3G4-6 print.snapshot 返回真实不透明 pdfToken（非 relPath 桩）且 pages=null（不伪造） | PASS | `{"print1": {"pdfToken": "pdf-mven8lrl-29z7qzp0", "pages": null, "tokenType": "string"}, "print2": {"pdfToken": "pdf-mven8m1a-jk2k45ov", "pages": null, "tokenType": "string"}, "phase": "guest-print-done", "error": null}` |
| 7 | W-T26-G3G4-7 pdfToken 对应真实 PDF：文件存在、%PDF 头、大小>1000、位于隔离目录 | PASS | `{"pdfPath": "C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out\\print-print-test-r0-mven8li2n3q.pdf", "size": 166439, "head": "%PDF", "underIsolatedBase": true, "token": "pdf-mven8lrl-29z7qzp0", "registryEntry": {"pdfToken": "pdf-mven8lrl-29z7qzp0", "pdfP…` |
| 8 | W-T26-G3G4-8 连续两次打印 → 不同 token/不同 PDF 文件（不覆盖语义） | PASS | `{"token1": "pdf-mven8lrl-29z7qzp0", "token2": "pdf-mven8m1a-jk2k45ov", "pdf2": "C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out\\print-print-test-r0-mven8lrxczk.pdf", "size2": 166439}` |
| 9 | W-T26-G3G4-9 非法路径 print.snapshot → 如实协议错误（不返回假 token） | PASS | `{"ok": false, "code": "E_BAD_PAYLOAD", "message": "print.snapshot relPath 非法: ../escape.md"}` |
| 10 | W-T26-G3G4-10 不存在的文档 print.snapshot → 如实错误（不返回假 token） | PASS | `{"ok": false, "code": "E_INTERNAL", "message": "E_PRINT_SNAPSHOT: 无法读取文档正文（Articles/does-not-exist.md）"}` |
| 11 | W-T26-G3G4-11 产品真实保存落盘（打开文档 + 编辑标记 → 磁盘含标记，事件由真实保存触发） | PASS | `{"opened": true, "focused": true, "typed": true, "saved": true, "savedBy": "autosave", "file": "C:\\ke-tmp\\uiws-t26-g3g4\\workspace\\Articles\\print-test.md"}` |
| 12 | W-T26-G3G4-12 document-saved 事件到达 guest 且载荷正确（relPath/revision） | PASS | `{"documentSaved": {"type": "document-saved", "relPath": "Articles/print-test.md", "revision": 1}, "hostEventObserved": true, "waitError": null}` |
| 13 | W-T26-G3G4-13 事件 revision 与后端真实 context.snapshot revision 一致（可信，非伪造） | PASS | `{"revisionCheck": {"eventRevision": 1, "liveRevision": 1, "beforeSaveRevision": 0, "match": true}, "beforeSaveRevision": 0}` |
| 14 | W-T26-G3G4-14 context-changed 事件到达 guest（真实 contextId/epoch；打开/切换文档触发） | PASS | `{"contextChanged": {"type": "context-changed", "contextId": "ke-default", "epoch": 1}, "openedSecondDoc": true, "waitError": null}` |
| 15 | W-T26-G3G4-15 theme-changed 事件到达 guest（theme=dark；data-theme 变化驱动） | PASS | `{"themeChanged": {"type": "theme-changed", "theme": "dark"}, "waitError": null}` |
| 16 | W-T26-G3G4-16 宿主侧三类 window 事件全部真实触发（保存/切档/主题链路完整性） | PASS | `{"hostEventNames": ["ke:workshop-context-changed", "ke:workshop-document-saved", "ke:workshop-context-changed", "ke:workshop-theme-changed"], "hostEvents": [{"name": "ke:workshop-context-changed", "detail": {"relPath": "Articles/print-test.…` |
| 17 | W-T26-G3G4-17 主进程存活（打印/事件链路无崩溃） | PASS | `null` |
| 18 | W-T26-G3G4-18 用户实例未运行 → N/A（隔离测试未触碰用户数据） | PASS | `{"user_pid": "N/A (not running)"}` |

## 关键实测值

```json
{
  "build": {
    "exe": "C:\\ke-tmp\\uiws-t26\\bin\\knowledgeeditor.exe",
    "sha256": "764f191b71d82e3598039c246f340933ab6fd6d1557e4824ac3ad3d7895328fe",
    "mtime": "2026-10-19T10:33:12"
  },
  "launch_env": {
    "KE_WS_PRINT_RENDER": "1",
    "APPDATA": "isolated",
    "KE_WORKSPACE": "isolated"
  },
  "isolated_pdf_dir": "C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out",
  "renderer_status": {
    "ok": true
  },
  "renderer_status_file": "C:\\Users\\y8882\\AppData\\Roaming\\com.astranota.uiws.e2e\\print-render-status.json",
  "session": {
    "state": "active",
    "capabilities": [
      "ui.shell",
      "context.read",
      "print.request"
    ]
  },
  "accepted_features": [
    "ui.shell",
    "context.read",
    "print.request"
  ],
  "snapshot_before_save": {
    "revision": 0,
    "relPath": "Articles/print-test.md",
    "hasContent": true
  },
  "print1": {
    "token": "pdf-mven8lrl-29z7qzp0",
    "pages": null,
    "registryEntry": {
      "pdfToken": "pdf-mven8lrl-29z7qzp0",
      "pdfPath": "C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out\\print-print-test-r0-mven8li2n3q.pdf",
      "relPath": "Articles/print-test.md",
      "revision": 0,
      "pages": null,
      "bytes": 0,
      "createdAt": 1792377421617
    },
    "pdfPath": "C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out\\print-print-test-r0-mven8li2n3q.pdf",
    "pdfSize": 166439,
    "pdfHead": "%PDF"
  },
  "print2": {
    "token": "pdf-mven8m1a-jk2k45ov",
    "pages": null,
    "registryEntry": {
      "pdfToken": "pdf-mven8m1a-jk2k45ov",
      "pdfPath": "C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out\\print-print-test-r0-mven8lrxczk.pdf",
      "relPath": "Articles/print-test.md",
      "revision": 0,
      "pages": null,
      "bytes": 0,
      "createdAt": 1792377421966
    },
    "pdfPath": "C:\\ke-tmp\\uiws-t26-g3g4\\pdf-out\\print-print-test-r0-mven8lrxczk.pdf",
    "pdfSize": 166439
  },
  "bad_path": {
    "ok": false,
    "code": "E_BAD_PAYLOAD",
    "message": "print.snapshot relPath 非法: ../escape.md"
  },
  "missing_doc": {
    "ok": false,
    "code": "E_INTERNAL",
    "message": "E_PRINT_SNAPSHOT: 无法读取文档正文（Articles/does-not-exist.md）"
  },
  "save": {
    "saved": true,
    "savedBy": "autosave",
    "markerInDisk": true,
    "save_chain": "core(/api/context/write)"
  },
  "document_saved": {
    "type": "document-saved",
    "relPath": "Articles/print-test.md",
    "revision": 1
  },
  "revision_check": {
    "eventRevision": 1,
    "liveRevision": 1,
    "beforeSaveRevision": 0,
    "match": true
  },
  "before_save_revision": 0,
  "context_changed": {
    "type": "context-changed",
    "contextId": "ke-default",
    "epoch": 1
  },
  "theme_changed": {
    "type": "theme-changed",
    "theme": "dark"
  },
  "guest_all_events": [
    {
      "type": "context-changed",
      "contextId": "ke-default",
      "epoch": 1
    },
    {
      "type": "document-saved",
      "relPath": "Articles/print-test.md",
      "revision": 1
    },
    {
      "type": "context-changed",
      "contextId": "ke-default",
      "epoch": 3
    },
    {
      "type": "theme-changed",
      "theme": "dark"
    }
  ],
  "host_events": [
    {
      "name": "ke:workshop-context-changed",
      "detail": {
        "relPath": "Articles/print-test.md"
      },
      "at": 1792377422102
    },
    {
      "name": "ke:workshop-document-saved",
      "detail": {
        "relPath": "Articles/print-test.md",
        "revision": 1
      },
      "at": 1792377425899
    },
    {
      "name": "ke:workshop-context-changed",
      "detail": {
        "relPath": "Articles/second.md"
      },
      "at": 1792377426224
    },
    {
      "name": "ke:workshop-theme-changed",
      "detail": {
        "theme": "dark"
      },
      "at": 1792377427307
    }
  ],
  "diag": {
    "start": {
      "blocked": false,
      "capabilities": [
        "ui.shell",
        "context.read",
        "print.request"
      ],
      "hasEntry": true,
      "hasSession": true
    },
    "log": [
      "starting",
      "active",
      "active"
    ],
    "body": "AstraNota\nAlpha\nCtrl K\n全部文档\n最近更新\n标签\n回收站\n模块\n新建\n暂无模块\n文章\n新建\n新建文件夹\nprint-test.md\nsecond.md\n附件 0\n设置\n\n从左侧选择一篇文档，或新建一篇开始创作\n\nMarkdown 为唯一事实源，所有内容本地存储\n\n+ 新建文档\n文档属性\n未打开文档\n大纲\n0\n\n暂无标题（使用 # / ## / ###）\n\nMarkdown 为唯一事实源\n索引可整体重建\n\n未打开文档\n本地存储 · 自动保存已开启\n后端 v1.2.18\nC:\\ke-tmp\\uiws-t26-g3g4\\workspace\n创意工坊\n创意工坊\n关闭\n创意工坊\n\n安装前会展示包身份与能力影响，需显式确认\n\n检查/修复全部包\n选择包并预览…\n选择 ZIP 离线包…\n已将 com.probe.t26g3g4 设为 trusted\n已安装包\nT26 G3G4 Print/Events Pack com.probe.t26g3g4\n版本 1.0.0 · 已激活\n信任：trusted\n签名：valid\n回滚\n修复/恢复\n授予信任\n撤销信任\nguest：active\n协议线已连接\n能力：ui.shell, context.read, print.request\n启用 guest\n停用 guest\nE_ISOLATION_RESIDUAL: guest 可见 __TAURI_INTERNALS__（remote IPC 已拒绝，残余风险见 ADR-004）\n卸载"
  },
  "guest_status_log": [
    "starting",
    "active",
    "active"
  ],
  "app_log_tail": [
    "[sidecar] INFO:     127.0.0.1:58583 - \"GET /api/articles/Articles/second.md HTTP/1.1\" 200 OK",
    "[sidecar] INFO:     127.0.0.1:57384 - \"GET /api/fs/events?since=0 HTTP/1.1\" 200 OK",
    "[sidecar] INFO:     127.0.0.1:58583 - \"POST /api/workspace/recent-documents HTTP/1.1\" 201 Created",
    "[sidecar] INFO:     127.0.0.1:57384 - \"OPTIONS /api/fs/events?since=1 HTTP/1.1\" 200 OK",
    "[sidecar] INFO:     127.0.0.1:57384 - \"GET /api/fs/events?since=1 HTTP/1.1\" 200 OK",
    "[sidecar] INFO:     127.0.0.1:57384 - \"GET /api/fs/events?since=1 HTTP/1.1\" 200 OK"
  ]
}
```

## 能力/链路变化（T26 G3/G4 后）

| 层 | 变化 |
| --- | --- |
| 协议方法 `print.snapshot` | 由**假桩** `{pdfToken: relPath, pages: 1}` 改为真实打印：隔离目录真实 PDF + 不透明 token + `pages: number|null`（不可得知数 → null，不伪造） |
| 产品 Broker 后端 | `ProductBrokerBackend.print` 按 relPath 从后端读**可信快照**（正文+revision）→ PrintJobManager（产品渲染器 + Rust `print_snapshot_pdf`）→ 应用数据目录 PDF；能力 `print.request` 双校验；失败如实抛类型化错误 |
| 打印渲染器 | 新增 `core/print/productPrintRenderer.ts` + `printEditorBridge.ts`：复用产品编辑器同源 schema（`editor.storage.markdown.manager` + `generateHTML`）把快照 Markdown 渲染为自包含打印 HTML；**不读编辑器当前 DOM/不隐式保存** |
| 输出安全 | `core/print/printOutput.ts`：绝对路径/.pdf/拒穿越（Rust 侧再验绝对+不覆盖）；文件名含 revision+时钟+随机 → 不覆盖；落在 `appDataDir()`（非工作区） |
| token 语义 | `core/print/printTokenRegistry.ts`：不透明 token → 真实 pdfPath/revision/pages（宿主可反查；guest 不可见路径） |
| 宿主事件 `document-saved` | EditorArea 保存真实落盘后 dispatch → WorkshopGuestFrame 桥 → `dispatcher.emit`；revision 取 Core 保存真实值，旧链由后端快照补全（不伪造） |
| 宿主事件 `context-changed` | EditorArea 打开/切换文档 → dispatch → 桥用真实 contextId/epoch（退回默认上下文时记 error） |
| 宿主事件 `theme-changed` | WorkshopGuestFrame 观察 `documentElement[data-theme]`（产品 applyTheme 唯一落点）→ emit |

## 限制与残余风险（如实记录）

- **隐藏打印 renderer 仍是 env 门控（`KE_WS_PRINT_RENDER=1`）**：默认发布启动不创建 → `print.snapshot` 会如实返回 `E_PRINT_RENDER` 类错误（不是假成功）。产品化默认开启需 Rust 改动（T16 既有设计，本任务按「不改 Rust」红线未做）。
- **页数不可得**：Rust `print_snapshot_pdf`（WebView2 PrintToPdf）不回传页数，前端无文件读取权限 → 协议 `pages` 如实为 `null`。A2 证据已记录「页数」未验证。
- **渲染保真**：快照渲染复用产品编辑器 schema/解析器（结构与官方渲染同源），但隐藏 renderer 无 React NodeView/应用 CSS：公式为 `data-ke-math*` 线性 LaTeX（无 KaTeX 视觉）、信息块/附件为降级样式、`Attachments/` 图片相对路径在 renderer origin 下不可解析（asset 协议 scope 仅 TEMP 预览，本任务未扩 Rust scope）。W 只断言真实 PDF 产出，不断言像素级一致。
- **打印页宽**：transport 未传 `contentWidth`（渲染器不读编辑器 DOM/布局），Rust 回退 A4 宽；未对齐「编辑器正文内容宽」。
- **theme-changed 的 W 触发方式**：用 CDP 改写 `documentElement.dataset.theme`（等价产品 `applyTheme` 的写入效果，也就是事件源本身）；未驱动设置面板「主题选项」UI 点击（避免脆弱 UI 交互）。产品接线为 MutationObserver 监听该属性。
- **context-changed 语义**：产品当前单工作区单默认上下文（`ke-default`），事件按任务要求由**文档打开/切换**触发，携带真实 contextId/epoch；不是工作区切换（工作区生命周期仍宿主独占，F01 未做）。
- **epoch 既有风险**：产品 `currentEpoch()` 固定返回 1（F 审计附带风险），本任务未改；为让 guest 在宿主 Core 保存（会 switch 上下文 epoch）后仍能读快照/打印，`fetchGuestSnapshot` 增加了「epoch 失效 → 失效缓存重试一次」的兜底（仅 guest 后端读取路径）。
- **document-saved revision 的真实性依赖保存链**：`VITE_KE_CORE_SAVE=1` 时 revision 为 Core 真实递增；默认旧保存链后端 context 注册表不跟踪**每次**旧链写入的 revision（既有 F 审计缺口），此时事件 revision 为后端可得的 context 快照 revision（一致但不保证递增）。本次构建通过日志确认保存链（见 observed.save_chain）。
- **Windows known folder 隔离限制（已用诊断覆盖规避）**：Tauri `appDataDir()` 走 Windows known folder（**不读 `APPDATA` env**），测试构建的 `app_data_dir` = 真实 `%APPDATA%\com.astranota.uiws.e2e`（独立 identifier、非用户 App 数据）。为遵守「PDF 只写 C:\ke-tmp 隔离目录」红线，探针设置产品诊断覆盖 `window.__KE_PRINT_OUTPUT_DIR__ = <BASE>\pdf-out`（仅可信主窗口可设、生产不设置 → appDataDir）；开始/结束都清理测试 identifier 目录。该覆盖是**测试/排障 seam**，不是生产打印行为。
- **打印会阻塞主线程（真实产品限制）**：Rust `print_snapshot_pdf` 的 WebView2 打印在 `with_webview` + `wait_for_async_operation` 中 message pump 等待完成，期间主窗口 JS 事件循环被占用；T19 默认 1200ms 心跳超时会把「宿主在打印」误判为 guest 崩溃（本次首轮即实测 suspended）。已在 `WorkshopGuestFrame` 把 guest 心跳超时放宽到 8s 规避误判（仍能捕获真失联）；更彻底修复需把打印移出主线程/暂停心跳（超出 task-7 允许改动范围，未做）。
- **W 只验证隔离测试构建**：不等于官方 UI 全量基线；不替代 F01–F16 逐项登记。

## 复现

```powershell
# 前置：测试构建 C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe 已包含本任务前端改动
# （Lead 协调：frontend `VITE_KE_WORKSHOP=1`（建议 + VITE_KE_CORE_SAVE=1）build → 隔离 src-tauri cargo build）
$env:PYTHONIOENCODING='utf-8'
& 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_t26_guest_g3g4_probe.py'
```

原始 JSON：`docs/ui-workshop/evidence/T26-G3G4-results.json`
