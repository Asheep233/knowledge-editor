# P5-T26 F01–F16 逐项台账登记证据（pack A / pack B / 官方 UI 三路径）

- 生成时间：2026-10-19T13:28:48+0800
- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 11 + WebView2 隔离产品构建
- 测试构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256=`764f191b71d82e3598039c246f340933ab6fd6d1557e4824ac3ad3d7895328fe`，mtime=`2026-10-19T10:33:12`；本轮未重建 exe）
- 参考包：A=`com.astranota.examples.pack-a`（["ui.shell", "panel.sidebar", "context.read", "print.request"]）、B=`com.astranota.examples.pack-b`（["ui.shell", "panel.dock", "context.read"]，commands=["article.set-title", "article.set-tags"]）；构建来源=`rebuild`（测试自签密钥只在 `C:\ke-tmp`，不入仓）
- 隔离环境：workspace=`C:\ke-tmp\uiws-t26-F\workspace`；APPDATA=`C:\ke-tmp\uiws-t26-F\appdata`；PDF out=`C:\ke-tmp\uiws-t26-F\pdf-out`
- 驱动方式：CDP 主窗口（官方 UI：真实点击/输入/快捷键）+ 浏览器级 `Target.attachToTarget`(flatten) 附加 guest iframe（OOPIF，在 guest 真实 DOM 上操作）；结论读取 guest 状态镜像、宿主会话状态与磁盘文件

## 结论

- 探针 checks：**37/40 PASS**（失败项如实列出；失败不等于台账行失败，见逐行结果）。
- 本轮登记（真实执行）行数：**27 行**（写入 CSV 的 `packAEntry`/`packBEntry`/`officialBaselineResult` 共 27 行；其余行保持 `NOT_RUN`）。
- 三路径口径：pack A/B = 参考包真实能力面；官方 UI = 产品官方 UI 真实 CDP 自动化。**未执行的操作不写成 PASS**；能力面不可达的 pack 路径记 `NOT_RUN:能力面...`（不是伪造 FAIL/PASS）。

## 逐项（F01–F16 域行）

| F | 已登记行 | pack A PASS | pack B PASS | 官方 PASS/FAIL/NOT_RUN | 说明 |
| --- | ---: | ---: | ---: | --- | --- |
| F01 | 1/10 | 0 | 0 | 1/0/0 | PASS:官方 UI 文件树点击打开 fe-ledger.md + 页签渲染（CDP 真实 DOM） |
| F02 | 1/6 | 0 | 1 | 1/0/0 | PASS:官方 UI 右栏标题→保存属性→frontmatter 落盘 |
| F03 | 1/42 | 0 | 0 | 1/0/0 | PASS:官方 UI Ctrl+B/Ctrl+I/工具栏加粗+撤销+重做（真实 DOM 断言） |
| F04 | 1/1 | 0 | 0 | 1/0/0 | PASS:官方 UI 插入公式→全屏公式编辑器打开（入口级） |
| F05 | 1/1 | 0 | 0 | 1/0/0 | PASS:官方 UI 表格尺寸选择器→插入表格→撤销 |
| F06 | 1/3 | 1 | 1 | 1/0/0 | PASS:官方 UI 打开 basic.md：ke-note/表格/KaTeX 真实渲染 |
| F07 | 1/3 | 0 | 0 | 1/0/0 | PASS:官方 UI 正文编辑→自动/手动保存→磁盘落盘 |
| F08 | 1/4 | 0 | 0 | 1/0/0 | PASS:官方 UI 历史快照按钮→历史版本面板打开（/api/history/list 真实调用） |
| F09 | 1/5 | 0 | 0 | 1/0/0 | PASS:官方 UI 附件面板打开（/api/attachments/list 真实调用） |
| F10 | 1/5 | 0 | 1 | 1/0/0 | PASS:官方 UI 搜索框搜索→结果渲染（/api/search 命中 1 次） |
| F11 | 1/3 | 0 | 0 | 1/0/0 | PASS:官方 UI 回收站导航→回收站面板打开（入口级） |
| F12 | 1/1 | 1 | 1 | 1/0/0 | PASS:官方 UI 源码模式 textarea 显示 Markdown 原文 |
| F13 | 1/6 | 0 | 0 | 1/0/0 | PASS:官方 UI 导出菜单→导出 PDF 对话框（含 A4 预览）真实打开；最终落盘未执行（隔离限制） |
| F14 | 1/1 | 1 | 0 | 0/0/1 | NOT_RUN:官方 UI 导出的最终落盘路径不受探针隔离 seam 控制，未点击执行（不伪造） |
| F15 | 1/19 | 0 | 0 | 1/0/0 | PASS:官方 UI 设置面板：常规/外观/快捷键/维护 + 主题分组 |
| F16 | 1/11 | 0 | 0 | 0/0/1 | NOT_RUN:原生菜单非 DOM，CDP 无法真实驱动；未执行 |

> 注：登记行包含域行（F01–F16 各 1 行）+ 本轮真实执行的细粒度行（快捷键/工具栏/导出/API 等），详见下方 CSV 登记清单；`F16` 三路径均 NOT_RUN（原生菜单非 DOM 可驱动、guest 不应触达窗口）。

## CSV 登记清单（本轮写入）

| featureId | packAEntry | packBEntry | officialBaselineResult |
| --- | --- | --- | --- |
| `F01` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 文件树点击打开 fe-ledger.md + 页签渲染（CDP 真实 DOM） |
| `F02` | NOT_RUN:pack A 未声明 commands（能力面） | PASS:command.invoke article.set-title → 后端 frontmatter 落盘 | PASS:官方 UI 右栏标题→保存属性→frontmatter 落盘 |
| `F03` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI Ctrl+B/Ctrl+I/工具栏加粗+撤销+重做（真实 DOM 断言） |
| `F04` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 插入公式→全屏公式编辑器打开（入口级） |
| `F05` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 表格尺寸选择器→插入表格→撤销 |
| `F06` | PASS:context.snapshot 读到 basic.md 的 KE 信息块/公式原文（只读） | PASS:context.snapshot 读到 basic.md 的 KE 信息块原文（只读） | PASS:官方 UI 打开 basic.md：ke-note/表格/KaTeX 真实渲染 |
| `F07` | NOT_RUN:guest 无写/恢复通道；仅收到 document-saved 事件（见 checks F-PA-6） | NOT_RUN:同左 | PASS:官方 UI 正文编辑→自动/手动保存→磁盘落盘 |
| `F08` | NOT_RUN:guest 无 history/recovery 协议方法 | NOT_RUN:同左 | PASS:官方 UI 历史快照按钮→历史版本面板打开（/api/history/list 真实调用） |
| `F09` | NOT_RUN:guest 网络被 CSP 阻断且无附件协议 | NOT_RUN:同左 | PASS:官方 UI 附件面板打开（/api/attachments/list 真实调用） |
| `F10` | NOT_RUN:pack A 无命令/搜索通道 | PASS:article.set-tags → frontmatter tags 落盘（tags 写入切片） | PASS:官方 UI 搜索框搜索→结果渲染（/api/search 命中 1 次） |
| `F11` | NOT_RUN:guest 无 trash 通道 | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 回收站导航→回收站面板打开（入口级） |
| `F12` | PASS:snapshot 返回正文原字符串（含 frontmatter；256KB 大文档可读） | PASS:snapshot 读取正文（只读） | PASS:官方 UI 源码模式 textarea 显示 Markdown 原文 |
| `F13` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 导出菜单→导出 PDF 对话框（含 A4 预览）真实打开；最终落盘未执行（隔离限制） |
| `F14` | PASS:print.snapshot→真实 PDF（%PDF，隔离目录，>1000B） | NOT_RUN:pack B 未声明 print.request 能力（能力面） | NOT_RUN:官方 UI 导出的最终落盘路径不受探针隔离 seam 控制，未点击执行（不伪造） |
| `F15` | FAIL:执行失败（真实失败，见 checks） | NOT_RUN:pack B 未订阅事件/无设置通道 | PASS:官方 UI 设置面板：常规/外观/快捷键/维护 + 主题分组 |
| `CMD.editor.bold` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI Ctrl+B→strong 出现→撤销还原 |
| `CMD.editor.italic` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI Ctrl+I→em 出现→撤销还原 |
| `CMD.editor.undo` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏撤销→strong 还原 |
| `CMD.editor.redo` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏重做→strong 复现 |
| `UI.toolbar.加粗` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏「加粗」按钮→strong |
| `UI.toolbar.信息块-ke-note` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏插入信息块→[data-ke-note] 节点 |
| `UI.toolbar.表格` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏表格→尺寸选择器→插入表格 |
| `UI.export.pdf` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 导出菜单项真实点击→PDF 对话框（含预览）；落盘未执行 |
| `UI.dialog.exportpdf` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 导出 PDF 对话框真实打开（预览/取消可用）；落盘未执行 |
| `API.documents.get._tree` | NOT_RUN:guest 无 /api/tree 等价受控协议方法 | NOT_RUN:同左 | PASS:官方 UI 文件树渲染（/api/tree 命中 1 次） |
| `API.search.get.root` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 搜索触发 /api/search（命中 1 次）+ 结果渲染 |
| `API.drafts.get._recovery` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 自动保存期间 /api/drafts/recovery 命中 1 次 |

## 探针 checks（真实执行明细）

| # | check | 结果 | 关键值 |
| --- | --- | --- | --- |
| 1 | W-G7-1 构建工具产出两个签名参考包（A/B）：assets sha256/签名/zip 结构复核 | PASS | `{"packs": ["com.astranota.examples.pack-a", "com.astranota.examples.pack-b"], "signature": "ed25519/k1"}` |
| 2 | W-G7-2 构建幂等 --check 通过 | PASS | `{"exit": 0}` |
| 3 | W-G7-3 源 manifest 与 dist 签名清单字段一致（不含签名） | PASS | `{"aligned": true}` |
| 4 | F-PREP-1 隔离产品启动 + CDP 就绪（工坊入口已渲染） | PASS | `{"port": 9902, "exeSha256": "764f191b71d82e3598039c246f340933ab6fd6d1557e4824ac3ad3d7895328fe", "exeMtime": "2026-10-19T10:33:12"}` |
| 5 | F-PREP-2 安装参考包 A/B（Rust 安装 + 签名校验 valid） | PASS | `{"installA": true, "verifyA": true, "installB": true, "verifyB": true}` |
| 6 | F-PREP-3 参考包 A/B 均授予 trusted 且签名 valid | PASS | `{"trustedA": true, "trustedB": true, "signatureValid": true}` |
| 7 | F-OFF-1 F01 官方 UI：文件树打开文档 + 页签渲染 | PASS | `{"opened": true, "tabVisible": true}` |
| 8 | F-OFF-17 F06 官方 UI 打开 basic.md：KE 信息块/表格/公式真实渲染 | PASS | `{"opened": true, "keNoteRendered": true, "tableRendered": true, "katexRendered": true, "boldRendered": true}` |
| 9 | F-OFF-2 F07 官方 UI：正文编辑 → 自动/手动保存落盘 | PASS | `{"saved": true, "savedBy": "autosave"}` |
| 10 | F-OFF-3 F02 官方 UI：右栏元数据（标题）→ 保存属性 → frontmatter 落盘 | PASS | `{"frontmatterHasTitle": true}` |
| 11 | F-OFF-4 CMD.editor.bold 官方 UI 快捷键 Ctrl+B 加粗（真实 DOM 断言） | PASS | `{"ctrlBApplied": true, "undoRestored": true}` |
| 12 | F-OFF-5 CMD.editor.italic 官方 UI 快捷键 Ctrl+I 斜体 | PASS | `{"ctrlIApplied": true, "undoRestored": true}` |
| 13 | F-OFF-6 UI.toolbar.加粗/撤销/重做 官方 UI 工具栏按钮 | PASS | `{"boldToolbar": true, "undo": true, "redo": true}` |
| 14 | F-OFF-7 UI.toolbar.信息块-ke-note 官方 UI 插入信息块节点 | PASS | `{"noteInserted": true, "undoRestored": true}` |
| 15 | F-OFF-8 UI.toolbar.表格 官方 UI 表格尺寸选择器 → 插入表格 | PASS | `{"pickerOpened": true, "tableInserted": true, "undoRestored": true}` |
| 16 | F-OFF-9 F04 官方 UI 插入公式 → 全屏公式编辑器打开（入口级） | PASS | `{"mathModalOpened": true, "dismissed": true}` |
| 17 | F-OFF-10 F12 官方 UI 源码模式（正文⇄源码）显示 Markdown 原文 | PASS | `{"textareaShown": true, "rawContainsLedger": true, "confirmAccepted": true}` |
| 18 | F-OFF-11 F10 官方 UI 搜索框搜索 → 结果渲染（内部 /api/search 真实调用） | PASS | `{"resultsRendered": true, "apiRouteHits": 1}` |
| 19 | F-OFF-12 F08 官方 UI 历史快照按钮 → 历史版本面板打开 | PASS | `{"opened": true, "apiHistoryHits": 1}` |
| 20 | F-OFF-13 F09 官方 UI 附件面板打开（内部 attachments API） | PASS | `{"panelVisible": true, "apiAttachmentHits": 1}` |
| 21 | F-OFF-14 F11 官方 UI 回收站导航项 → 回收站面板打开 | PASS | `{"trashPanelVisible": true}` |
| 22 | F-OFF-15 F13 官方 UI 导出菜单 → 导出 PDF 对话框（含 A4 预览；不执行落盘） | PASS | `{"menuItems": 4, "pdfDialogOpened": true, "a4Preview": true, "dismissed": true, "note": "最终落盘未执行（export_pdf 落盘路径不受探针隔离 seam 控制）"}` |
| 23 | F-OFF-16 F15 官方 UI 设置面板（常规/外观/快捷键/维护 + 主题分组） | PASS | `{"groups": ["常规", "外观", "快捷键", "维护"], "themeGroup": true}` |
| 24 | F-PA-0 pack A 启用：会话 active + guest iframe + 发布 SDK 握手 | PASS | `{"state": "active", "capabilities": ["ui.shell", "panel.sidebar", "context.read", "print.request"]}` |
| 25 | F-PA-1 F12 pack A：context.snapshot 读取正文原字符串（含 frontmatter） | PASS | `{"relPath": "Articles/fe-ledger.md", "revision": 1, "hasContent": true, "contentLen": 153, "title": "F 台账标题-官方"}` |
| 26 | F-PA-2 F06 pack A：读取 basic.md 的 KE 信息块/公式原文 | PASS | `{"relPath": "Articles/basic.md", "contentLen": 640, "hasKeNote": true, "hasMath": true}` |
| 27 | F-PA-3 F12 pack A：大文档（256KB）快照读取 | PASS | `{"relPath": "Articles/large-256kb.md", "contentLen": 117196, "expectedChars": 117196, "hasContent": true}` |
| 28 | F-PA-4 F14 pack A：print.snapshot → 真实 PDF（%PDF，隔离目录，>1000B） | PASS | `{"pdfToken": "pdf-mvet1d41-z6gqjksg", "pdfPath": "C:\\ke-tmp\\uiws-t26-F\\pdf-out\\print-fe-ledger-r1-*.pdf", "pdfSize": 68233, "pdfHead": "%PDF", "pages": null}` |
| 29 | F-PA-5 pack A：非法路径错误以类型化错误展示（不静默） | PASS | `{"lastError": {"code": "E_BAD_PAYLOAD", "message": "print.snapshot relPath 非法: ../escape.md"}}` |
| 30 | F-PA-6 F07/F08 pack A：官方保存 → document-saved 事件到达 guest 并自动刷新快照 | FAIL | `{"saved": false, "hostEventLog": [], "reason": "工坊模态打开时主编辑面输入/保存链路未在窗口内触发（两次运行均未稳定通过）"}` |
| 31 | F-PA-7 F15 pack A：官方主题切换 → theme-changed 事件到达 guest | FAIL | `{"event": {}, "hostEventLog": [], "reason": "工坊模态下设置面板交互未稳定触发主题事件（一次运行曾 PASS，v1 按未稳定记 FAIL）"}` |
| 32 | F-PA-8 pack A 停用：会话 stopped + guest iframe 卸载 | FAIL | `{"stopClicked": false, "reason": "前置事件任务失败后工坊面板状态不确定，停用按钮未找到"}` |
| 33 | F-PB-0 pack B 启用：会话 active + guest iframe + 发布 SDK 握手 | PASS | `{"state": "active", "capabilities": ["ui.shell", "panel.dock", "context.read"]}` |
| 34 | F-PB-1 F02 pack B：读取快照 + frontmatter 自动填充标题 | PASS | `{"relPath": "Articles/fe-ledger.md", "hasContent": true, "formTitle": "F 台账标题-官方"}` |
| 35 | F-PB-2 F06 pack B：读取 basic.md 的 KE 信息块原文 | PASS | `{"relPath": "Articles/basic.md", "contentLen": 640, "hasKeNote": true}` |
| 36 | F-PB-3 F02 pack B：command.invoke article.set-title → 后端 frontmatter 落盘 | PASS | `{"ok": true, "note": "写入目标为 guest 表单最后加载路径 Articles/basic.md（commandResult.value.relPath 可核对）"}` |
| 37 | F-PB-4 F10 pack B：command.invoke article.set-tags → 后端 frontmatter 落盘 | PASS | `{"ok": true, "note": "同上，目标 Articles/basic.md；tags 落盘成功"}` |
| 38 | F-PB-5 pack B：空标题被宿主拒绝（E_TITLE）且磁盘不被改 | PASS | `{"errorText": "E_INTERNAL: E_TITLE: 标题为空或过长"}` |
| 39 | F-PB-6 pack B 停用：会话 stopped | PASS | `{"stopClicked": true, "state": "stopped"}` |
| 40 | F-FINAL-1 主进程存活 / 用户实例未受影响（未运行→N/A） / 会话已停用 | PASS | `{"procAlive": true, "userPid": "(not running)", "finalSessionState": "stopped"}` |

## 内部路由命中（官方 UI 真实调用证据，来自隔离实例 app.log）

```json
{
  "tree": 1,
  "search": 1,
  "drafts_recovery": 1,
  "history_list": 1,
  "attachments_list": 1
}
```

## 限制与未覆盖原因（如实）

- **pack 能力面限制**：参考包 A/B 只声明最小能力（A: ui.shell/panel.sidebar/context.read/print.request；B: ui.shell/panel.dock/context.read + 2 条声明式命令）。工作区生命周期（F01）、编辑器命令/快捷方式（F03/F04/F05）、附件（F09）、回收站（F11）、导入导出（F13）、桌面行为（F16）等在 guest 协议面没有对应方法/命令 → packA/B 列记 `NOT_RUN:能力面...`（结构性不可达，非伪造结果）；这与 `reports/F01-F16-COVERAGE.md` 的审计结论一致（G5/G6 仍未变）。
- **官方 UI 导出落盘未执行**：官方「导出 PDF」最终 `export_pdf` 的落盘路径不受本探针隔离 seam（`__KE_PRINT_OUTPUT_DIR__` 只覆盖 print_snapshot）控制，为避免写出隔离目录/真实用户目录，探针只验证「菜单→对话框（含 A4 预览）→取消」，**没有点击最终导出**；F13/F14 的官方行因此如实标注「落盘副作用未执行」。
- **F16 原生菜单不可自动化**：桌面原生菜单不是 DOM，CDP 无法真实点击；guest 侧也不应有窗口/菜单通道 → F16 三路径全部 NOT_RUN（不伪造）。
- **F03 只抽样**：42 条格式/快捷键行中本轮真实执行 4 条快捷键动作 + 3 条工具栏动作（含撤销/重做/信息块/表格）；其余行保持 NOT_RUN（未逐条执行，不填）。
- **官方基线口径**：`officialBaselineResult` 全部来自产品官方 UI 的真实 CDP 自动化（点击/输入/快捷键），并用真实 DOM/磁盘/内部 API 日志断言；不是单测/happy-dom 结果。域行（F01–F16）为「代表性任务」执行结果，不等价 ACCEPTANCE 原文全量标准（任务包原件不在仓库）。
- **同时段隔离**：运行前检测并等待其它隔离实例（另一 W 探针）退出，避免单实例互相接管；本轮实际等待结果见 checks/F-PREP-1。
- **Windows W 证据性质**：隔离测试构建 + 隔离 APPDATA/工作区 + 测试自签密钥；不等于正式发布认证；用户 App（`D:\AstraNota`）未运行、未触碰。

## 复现

```powershell
$env:PYTHONIOENCODING='utf-8'
py -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_feature_entry_probe.py'
```

原始 JSON：`docs/ui-workshop/evidence/T26-F-ledger-results.json`

## v1 交付说明（未完成，如实）

- 探针 `tools/run_feature_entry_probe.py` 已交付且可复现（隔离构建/CDP/官方 UI 自动化/客态 DOM/路径白名单清理）。
- 本 v1 证据 checks：**37/40 PASS**；CSV 登记 **27 行**（其余 F 域行保持 NOT_RUN）。
- **未完成原因**：正式全量批次被并发 W07 探针打断（CDP `WinError 10053`）+ 时间预算超时；按 Lead 指示不重跑全量，使用两次真实执行结果（完成批次 + 正式批次官方 UI 阶段）。
- **未稳定项**：pack A 的 document-saved 事件 / theme-changed 事件 / 停用 guest（3 项 FAIL）——原因是工坊模态打开时主编辑面输入与设置面板交互不稳定；下一窗口优先修复（非模态触发或专门的宿主事件注入 seam），随后补 F07/F08/F15 的 pack 事件证据。
- **未执行项**：官方导出落盘（F13/F14 只到对话框）、F16 原生菜单（非 DOM）、F03 其余 35 行；CSV 均保持 NOT_RUN，不伪造。
