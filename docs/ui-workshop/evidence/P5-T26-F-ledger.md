# P5-T26 F01–F16 逐项台账登记证据（pack A / pack B / 官方 UI 三路径）

- 生成时间：2026-10-19T15:58:37+0800
- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 11 + WebView2 隔离产品构建
- 测试构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256=`faa71dfbf5222d63aa3c1b365961055d344ce09fa27cfcadc73e607c0ef75789`，mtime=`2026-10-19T15:29:02`；本轮未重建 exe）
- 参考包：A=`com.astranota.examples.pack-a`（["ui.shell", "panel.sidebar", "context.read", "print.request"]）、B=`com.astranota.examples.pack-b`（["ui.shell", "panel.dock", "context.read"]，commands=["article.set-title", "article.set-tags"]）；构建来源=`rebuild`（测试自签密钥只在 `C:\ke-tmp`，不入仓）
- 隔离环境：workspace=`C:\ke-tmp\uiws-t26-F\workspace`；APPDATA=`C:\ke-tmp\uiws-t26-F\appdata`；PDF out=`C:\ke-tmp\uiws-t26-F\pdf-out`
- 驱动方式：CDP 主窗口（官方 UI：真实点击/输入/快捷键）+ 浏览器级 `Target.attachToTarget`(flatten) 附加 guest iframe（OOPIF，在 guest 真实 DOM 上操作）；结论读取 guest 状态镜像、宿主会话状态与磁盘文件

## 结论

- 探针 checks：**71/76 PASS**（失败项如实列出；失败不等于台账行失败，见逐行结果）。
- 本轮登记（真实执行）行数：**61 行**（写入 CSV 的 `packAEntry`/`packBEntry`/`officialBaselineResult` 共 72 行；其余行保持 `NOT_RUN`）。
- 三路径口径：pack A/B = 参考包真实能力面；官方 UI = 产品官方 UI 真实 CDP 自动化。**未执行的操作不写成 PASS**；能力面不可达的 pack 路径记 `NOT_RUN:能力面...`（不是伪造 FAIL/PASS）。

## 逐项（F01–F16 域行）

| F | 已登记行 | pack A PASS | pack B PASS | 官方 PASS/FAIL/NOT_RUN | 说明 |
| --- | ---: | ---: | ---: | --- | --- |
| F01 | 1/10 | 0 | 0 | 1/0/0 | PASS:官方 UI 文件树点击打开 fe-ledger.md + 页签渲染（CDP 真实 DOM） |
| F02 | 2/6 | 0 | 1 | 2/0/0 | PASS:官方 UI 右栏标题→保存属性→frontmatter 落盘 |
| F03 | 42/42 | 0 | 0 | 37/5/0 | PASS:官方 UI Ctrl+B/Ctrl+I/工具栏加粗+撤销+重做（真实 DOM 断言） |
| F04 | 1/1 | 0 | 0 | 1/0/0 | PASS:官方 UI 插入公式→全屏公式编辑器打开（入口级） |
| F05 | 1/1 | 0 | 0 | 1/0/0 | PASS:官方 UI 表格尺寸选择器→插入表格→撤销 |
| F06 | 1/3 | 1 | 1 | 1/0/0 | PASS:官方 UI 打开 basic.md：ke-note/表格/KaTeX 真实渲染 |
| F07 | 2/3 | 0 | 0 | 2/0/0 | PASS:官方 UI 正文编辑→自动/手动保存→磁盘落盘 |
| F08 | 1/4 | 0 | 0 | 1/0/0 | PASS:官方 UI 历史快照按钮→历史版本面板打开（/api/history/list 真实调用） |
| F09 | 1/5 | 0 | 0 | 1/0/0 | PASS:官方 UI 附件面板打开（/api/attachments/list 真实调用） |
| F10 | 2/5 | 0 | 1 | 2/0/0 | PASS:官方 UI 搜索框搜索→结果渲染（/api/search 命中 2 次） |
| F11 | 1/3 | 0 | 0 | 1/0/0 | PASS:官方 UI 回收站导航→回收站面板打开（入口级） |
| F12 | 1/1 | 1 | 1 | 1/0/0 | PASS:官方 UI 源码模式 textarea 显示 Markdown 原文 |
| F13 | 3/6 | 0 | 0 | 3/0/0 | PASS:官方 UI 导出菜单→导出 PDF 对话框（含 A4 预览）真实打开；最终落盘未执行（隔离限制） |
| F14 | 1/1 | 1 | 0 | 0/0/1 | NOT_RUN:官方 UI 导出 PDF 对话框（含 A4 预览）已执行；export_pdf 落点 %USERPROFILE%/Documents 无法安全隔离（覆盖 USERP |
| F15 | 1/19 | 1 | 0 | 1/0/0 | PASS:官方 UI 设置面板：常规/外观/快捷键/维护 + 主题分组 |
| F16 | 11/11 | 0 | 0 | 0/0/11 | NOT_RUN:原生菜单非 DOM，CDP 无法真实驱动；已对 menu.rs 做只读结构审计（11 项菜单项/加速键/事件分发，见证据 P5-T26-F16-native-men |

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
| `F07` | NOT_RUN:guest 无写/恢复通道；已收到 document-saved 事件（只读观察；方法=bridge-window-event(产品真实事件入口；保存链由 F-OFF-2 覆盖)） | NOT_RUN:同左 | PASS:官方 UI 正文编辑→自动/手动保存→磁盘落盘 |
| `F08` | NOT_RUN:guest 无 history/recovery 协议方法；仅 document-saved/事件观察（方法=bridge-window-event(产品真实事件入口；保存链由 F-OFF-2 覆盖)） | NOT_RUN:同左 | PASS:官方 UI 历史快照按钮→历史版本面板打开（/api/history/list 真实调用） |
| `F09` | NOT_RUN:guest 网络被 CSP 阻断且无附件协议 | NOT_RUN:同左 | PASS:官方 UI 附件面板打开（/api/attachments/list 真实调用） |
| `F10` | NOT_RUN:pack A 无命令/搜索通道 | PASS:article.set-tags → frontmatter tags 落盘（tags 写入切片） | PASS:官方 UI 搜索框搜索→结果渲染（/api/search 命中 2 次） |
| `F11` | NOT_RUN:guest 无 trash 通道 | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 回收站导航→回收站面板打开（入口级） |
| `F12` | PASS:snapshot 返回正文原字符串（含 frontmatter；256KB 大文档可读） | PASS:snapshot 读取正文（只读） | PASS:官方 UI 源码模式 textarea 显示 Markdown 原文 |
| `F13` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 导出菜单→导出 PDF 对话框（含 A4 预览）真实打开；最终落盘未执行（隔离限制） |
| `F14` | PASS:print.snapshot→真实 PDF（%PDF，隔离目录，>1000B） | NOT_RUN:pack B 未声明 print.request 能力（能力面） | NOT_RUN:官方 UI 导出 PDF 对话框（含 A4 预览）已执行；export_pdf 落点 %USERPROFILE%/Documents 无法安全隔离（覆盖 USERPROFILE 会破坏 WebView2 CDP）→ 未执行；另验证官方 Rust print 管线 preview_pdf 真实 PDF 落盘（隔离 TEMP，36662B/%PDF） |
| `F15` | PASS:官方主题切换→theme-changed 事件到达 guest（只读同步切片；方法=real-theme-toggle） | NOT_RUN:pack B 未订阅事件/无设置通道 | PASS:官方 UI 设置面板：常规/外观/快捷键/维护 + 主题分组 |
| `CMD.editor.bold` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI Ctrl+B→strong 出现→撤销还原 |
| `CMD.editor.italic` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI Ctrl+I→em 出现→撤销还原 |
| `CMD.editor.undo` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏撤销→strong 还原 |
| `CMD.editor.redo` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏重做→strong 复现 |
| `UI.toolbar.加粗` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏「加粗」按钮→strong |
| `UI.toolbar.信息块-ke-note` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏插入信息块→[data-ke-note] 节点 |
| `UI.toolbar.表格` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 工具栏表格→尺寸选择器→插入表格 |
| `UI.export.pdf` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 导出菜单→PDF 对话框（含 A4 预览）真实打开；最终 export_pdf 落 Documents 不可隔离未执行 |
| `UI.dialog.exportpdf` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | PASS:官方 UI 导出 PDF 对话框（含 A4 预览）真实打开；最终导出落盘不可隔离未执行 |
| `API.documents.get._tree` | NOT_RUN:guest 无 /api/tree 等价受控协议方法 | NOT_RUN:同左 | PASS:官方 UI 文件树渲染（/api/tree 命中 3 次） |
| `API.search.get.root` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 搜索触发 /api/search（命中 2 次）+ 结果渲染 |
| `API.drafts.get._recovery` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 自动保存期间 /api/drafts/recovery 命中 31 次 |
| `CMD.editor.underline` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI Ctrl+U 下划线（CDP 真实操作 + DOM 断言 before=False→after=True） |
| `CMD.editor.strike` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI Ctrl+Shift+S 删除线（CDP 真实操作 + DOM 断言 before=False→after=True） |
| `CMD.editor.heading.1` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI Ctrl+Alt+1 标题 1（CDP 真实操作 + DOM 断言 before=1→after=3） |
| `CMD.editor.list.bullet` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | FAIL:官方 UI 操作后 DOM 断言未通过 |
| `CMD.editor.list.ordered` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI Ctrl+Shift+7 有序列表（CDP 真实操作 + DOM 断言 before=0→after=1） |
| `CMD.editor.blockquote` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | FAIL:官方 UI 操作后 DOM 断言未通过 |
| `CMD.editor.code.inline` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI Ctrl+E 行内代码（CDP 真实操作 + DOM 断言 before=False→after=True） |
| `CMD.editor.codeBlock` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI Ctrl+Alt+C 代码块（CDP 真实操作 + DOM 断言 before=0→after=3） |
| `UI.toolbar.斜体` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏斜体（CDP 真实操作 + DOM 断言 before=False→after=True） |
| `UI.toolbar.下划线` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏下划线（CDP 真实操作 + DOM 断言 before=False→after=True） |
| `UI.toolbar.删除线` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏删除线（CDP 真实操作 + DOM 断言 before=False→after=True） |
| `UI.toolbar.有序列表` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏有序列表（CDP 真实操作 + DOM 断言 before=0→after=1） |
| `UI.toolbar.引用` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏引用（CDP 真实操作 + DOM 断言 before=0→after=1） |
| `UI.toolbar.行内代码` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏行内代码（CDP 真实操作 + DOM 断言 before=False→after=True） |
| `UI.toolbar.代码块` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏代码块（CDP 真实操作 + DOM 断言 before=0→after=3） |
| `UI.toolbar.插入链接` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏插入链接→链接地址对话框（CDP 真实操作 + DOM 断言 before=None→after=None） |
| `UI.toolbar.插入公式` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏插入公式→行内公式编辑器（CDP 真实操作 + DOM 断言 before=None→after=None） |
| `UI.toolbar.插入块级公式` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏插入块级公式→块级公式编辑器（CDP 真实操作 + DOM 断言 before=None→after=None） |
| `UI.toolbar.注释-脚注` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏注释（脚注）→插入注释对话框（CDP 真实操作 + DOM 断言 before=None→after=None） |
| `UI.toolbar.保存-Ctrl-S` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | FAIL:官方 UI 操作后 DOM 断言未通过 |
| `UI.toolbar.微分-d-转正体-另存为新文件` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏微分 d 转正体→预览对话框（CDP 真实操作 + DOM 断言 before=None→after=None） |
| `UI.toolbar.历史快照` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏历史快照→历史版本面板（CDP 真实操作 + DOM 断言 before=None→after=None） |
| `CMD.editor.heading.2` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏「样式/标题」选择器 → 标题2（CDP 真实操作 + DOM 断言 before=0→after=1） |
| `CMD.editor.heading.3` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏「样式/标题」选择器 → 标题3（CDP 真实操作 + DOM 断言 before=0→after=1） |
| `CMD.editor.link.insert` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | FAIL:官方 UI 操作后未产生真实节点/产物（如实 FAIL） |
| `CMD.editor.image.insert` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏插入图片 → 官方 file input 注入 fixture 图片 → 真实上传+图片节点（CDP 真实操作 + DOM 断言 before=0→after=2） |
| `CMD.editor.math.block` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏插入块级公式 → mathBlock 节点（CDP 真实操作 + DOM 断言 before=0→after=1） |
| `CMD.editor.module.insert` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | FAIL:官方 UI 操作后未产生真实节点/产物（如实 FAIL） |
| `CMD.editor.footnote.insert` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏注释（脚注）→ 对话框输入 → 脚注节点（CDP 真实操作 + DOM 断言 before=0→after=2） |
| `CMD.editor.note.insert` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏信息块 → ke-note 节点（CDP 真实操作 + DOM 断言 before=0→after=1） |
| `CMD.editor.table.insert` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏表格 → 2×2 表格节点（CDP 真实操作 + DOM 断言 before=0→after=1） |
| `UI.toolbar.插入图片` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏插入图片 → 官方 file input 注入 fixture 图片 → 真实上传+图片节点（与 CMD.editor.image.insert 同一次执行）（CDP 真实操作 + DOM 断言 before=0→after=2） |
| `UI.toolbar.撤销` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏撤销 → 编辑回退（CDP 真实操作 + DOM 断言 before=None→after=None） |
| `UI.toolbar.重做` | NOT_RUN:能力面：pack 无该域受控协议/命令（结构性不可达，非伪造） | NOT_RUN:同左 | PASS:官方 UI 工具栏重做 → 编辑恢复（CDP 真实操作 + DOM 断言 before=None→after=None） |

## 探针 checks（真实执行明细）

| # | check | 结果 | 关键值 |
| --- | --- | --- | --- |
| 1 | W-G7-1 构建工具产出两个签名参考包（A/B）：dist manifest assets sha256/size 与实际文件一致、签名为 ed25519/k1 128hex、zip 根含 manifest+资产 | PASS | `{"packs": {"com.astranota.examples.pack-a": {"distDir": "C:\\ke-tmp\\uiws-t26-F\\dist\\com.astranota.examples.pack-a", "signature": {"alg": "ed25519", "keyId": "k1", "signatureLen": 128}, "assets": [{"path": "index.html", "declaredSha256": "b26958cdc3e1e011c80cad1358f217a9b94f5267f47dc18f650c7eec6ff…` |
| 2 | W-G7-2 构建幂等：`--check` 通过（源 manifest assets 哈希已回写、vendored SDK 已同步） | PASS | `{"exit": 0, "stderrTail": "[build_reference_packs] CHECK OK: 2 packs · manifest 更新 0 · vendored SDK 同步 0 · 签名 ed25519 keyId=k1 pub=f0cfa21fd54c689f…（provided）\n"}` |
| 3 | W-G7-3 源 manifest（入库）只含哈希/大小、不含签名，且与 dist 签名清单字段一致 | PASS | `{"com.astranota.examples.pack-a": {"sourceManifest": "F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-workshop\\packs\\pack-a\\manifest.json", "signedInSource": false, "alignedWithDist": true}, "com.astranota.examples.pack-b": {"sourceManifest": "F:\\Work\\KE Project\\knowledge-editor\\docs\\ui-wor…` |
| 4 | F-PREP-1 隔离产品启动 + CDP 就绪（工坊入口已渲染） | PASS | `{"port": 9926, "exeSha256": "faa71dfbf5222d63aa3c1b365961055d344ce09fa27cfcadc73e607c0ef75789", "exeMtime": "2026-10-19T15:29:02", "packsMode": "rebuild"}` |
| 5 | F-PREP-2 安装参考包 A/B（Rust 安装 + 签名校验 valid） | PASS | `{"installA": true, "verifyA": true, "installB": true, "verifyB": true}` |
| 6 | F-PREP-3 参考包 A/B 均授予 trusted 且签名 valid | PASS | `{"trustedA": true, "trustedB": true, "signatureValid": true}` |
| 7 | F-OFF-1 F01 官方 UI：文件树打开文档 + 页签渲染 | PASS | `{"clicked": true, "opened": true, "tabVisible": true, "editorHead": "F 台账标题\n\nF-LEDGER-BODY-MARKER 这是一段用于官方 UI 与 guest 读取的台账正文。\n\n列表项一\n\n列表项二\n\n\n"}` |
| 8 | F-OFF-17 F06 官方 UI 打开 basic.md：KE 信息块/表格/公式真实渲染 | PASS | `{"clicked": true, "opened": true, "keNoteRendered": true, "tableRendered": true, "katexRendered": true, "boldRendered": true}` |
| 9 | F-OFF-2 F07 官方 UI：正文编辑 → 自动/手动保存落盘 | PASS | `{"saved": true, "savedBy": "autosave", "diskHasMarker": true}` |
| 10 | F-OFF-3 F02 官方 UI：右栏元数据（标题）→ 保存属性 → frontmatter 落盘 | PASS | `{"inputSet": true, "saveButtonVisible": true, "clicked": true, "frontmatterHasTitle": true, "frontmatter": "\nke_version: 1\ntitle: F 台账标题-官方\ntags:\n  - ledger\n"}` |
| 11 | F-OFF-4 CMD.editor.bold 官方 UI 快捷键 Ctrl+B 加粗（真实 DOM 断言） | PASS | `{"ctrlBApplied": true, "undoRestored": true}` |
| 12 | F-OFF-5 CMD.editor.italic 官方 UI 快捷键 Ctrl+I 斜体 | PASS | `{"ctrlIApplied": true, "undoRestored": true}` |
| 13 | F-OFF-6 UI.toolbar.加粗/撤销/重做 官方 UI 工具栏按钮 | PASS | `{"boldToolbar": true, "undo": true, "redo": true}` |
| 14 | F-OFF-7 UI.toolbar.信息块-ke-note 官方 UI 插入信息块节点 | PASS | `{"noteInserted": true, "undoRestored": true}` |
| 15 | F-OFF-8 UI.toolbar.表格 官方 UI 表格尺寸选择器 → 插入表格 | PASS | `{"pickerOpened": true, "tableInserted": true, "undoRestored": true}` |
| 16 | F-OFF-9 F04 官方 UI 插入公式 → 全屏公式编辑器打开（入口级） | PASS | `{"mathToolbarClicked": true, "mathModalOpened": true, "dismissed": true}` |
| 17 | F-OFF-10 F12 官方 UI 源码模式（正文⇄源码）显示 Markdown 原文 | PASS | `{"toggled": true, "confirmAccepted": true, "textareaShown": true, "rawContainsLedger": true, "backToWysiwyg": true, "rawHead": "# F 台账标题\n\nF-LEDGER-BODY-MARKER 这是一段用于官方 UI 与 guest 读取的台账正文。\n\n- 列表项一\n- 列表项二\n\nF-LEDGER-SAVE-MARKER", "saveStateHint": "份快照，存放于笔记旁\n\nMarkdown 为唯一事实源\n索引可整体重建\n\nF 台账标题…` |
| 18 | F-OFF-11 F10 官方 UI 搜索框搜索 → 结果渲染（内部 /api/search 真实调用） | PASS | `{"inputSet": true, "resultsRendered": true, "apiRouteHits": 2}` |
| 19 | F-OFF-12 F08 官方 UI 历史快照按钮 → 历史版本面板打开 | PASS | `{"opened": true, "apiHistoryHits": 2, "closed": true}` |
| 20 | F-OFF-13 F09 官方 UI 附件面板打开（内部 attachments API） | PASS | `{"toggled": true, "panelVisible": true, "apiAttachmentHits": 2}` |
| 21 | F-OFF-14 F11 官方 UI 回收站导航项 → 回收站面板打开 | PASS | `{"navClicked": true, "trashPanelVisible": true}` |
| 22 | F-OFF-15 F13 官方 UI 导出菜单 → 导出 PDF 对话框（含 A4 预览；不执行落盘） | PASS | `{"menuOpened": true, "menuItems": {"导出 Markdown（KE 格式）": true, "导出普通 Markdown (.md)": true, "导出文档包 (.zip)": true, "导出 PDF（打印为 PDF）": true}, "pdfDialogOpened": true, "a4Preview": true, "dismissed": true, "note": "官方 UI 导出对话框（含 A4 预览）真实打开；最终 export_pdf 落 Documents 不可隔离，未执行（不伪造）"}` |
| 23 | F-OFF-19 F14 官方 print 管线 preview_pdf 真实 PDF 落盘（隔离 TEMP；export_pdf Documents 不可隔离未执行） | PASS | `{"invoke": {"ok": true, "error": null}, "pdfPath": "C:\\ke-tmp\\uiws-t26-F\\temp\\AstraNota-preview\\preview-47696-1792396209601468600.pdf", "exists": true, "size": 36662, "head": "%PDF", "underIsolatedTemp": true, "cleanedByOfficialCommand": true}` |
| 24 | F-OFF-16 F15 官方 UI 设置面板（常规/外观/快捷键/维护 + 主题分组） | PASS | `{"opened": true, "groups": {"常规": true, "外观": true, "快捷键": true, "维护": true}, "themeGroup": true}` |
| 25 | F-F3-CMD.editor.underline | PASS | `{"row": "CMD.editor.underline", "label": "Ctrl+U 下划线", "before": false, "after": true}` |
| 26 | F-F3-CMD.editor.strike | PASS | `{"row": "CMD.editor.strike", "label": "Ctrl+Shift+S 删除线", "before": false, "after": true}` |
| 27 | F-F3-CMD.editor.heading.1 | PASS | `{"row": "CMD.editor.heading.1", "label": "Ctrl+Alt+1 标题 1", "before": 1, "after": 3}` |
| 28 | F-F3-CMD.editor.list.bullet | FAIL | `{"row": "CMD.editor.list.bullet", "label": "Ctrl+Shift+8 无序列表", "before": 1, "after": 1}` |
| 29 | F-F3-CMD.editor.list.ordered | PASS | `{"row": "CMD.editor.list.ordered", "label": "Ctrl+Shift+7 有序列表", "before": 0, "after": 1}` |
| 30 | F-F3-CMD.editor.blockquote | FAIL | `{"row": "CMD.editor.blockquote", "label": "Ctrl+Shift+B 引用", "before": 0, "after": 0}` |
| 31 | F-F3-CMD.editor.code.inline | PASS | `{"row": "CMD.editor.code.inline", "label": "Ctrl+E 行内代码", "before": false, "after": true}` |
| 32 | F-F3-CMD.editor.codeBlock | PASS | `{"row": "CMD.editor.codeBlock", "label": "Ctrl+Alt+C 代码块", "before": 0, "after": 3}` |
| 33 | F-F3-UI.toolbar.斜体 | PASS | `{"row": "UI.toolbar.斜体", "label": "工具栏斜体", "before": false, "after": true}` |
| 34 | F-F3-UI.toolbar.下划线 | PASS | `{"row": "UI.toolbar.下划线", "label": "工具栏下划线", "before": false, "after": true}` |
| 35 | F-F3-UI.toolbar.删除线 | PASS | `{"row": "UI.toolbar.删除线", "label": "工具栏删除线", "before": false, "after": true}` |
| 36 | F-F3-UI.toolbar.有序列表 | PASS | `{"row": "UI.toolbar.有序列表", "label": "工具栏有序列表", "before": 0, "after": 1}` |
| 37 | F-F3-UI.toolbar.引用 | PASS | `{"row": "UI.toolbar.引用", "label": "工具栏引用", "before": 0, "after": 1}` |
| 38 | F-F3-UI.toolbar.行内代码 | PASS | `{"row": "UI.toolbar.行内代码", "label": "工具栏行内代码", "before": false, "after": true}` |
| 39 | F-F3-UI.toolbar.代码块 | PASS | `{"row": "UI.toolbar.代码块", "label": "工具栏代码块", "before": 0, "after": 3}` |
| 40 | F-F3-UI.toolbar.插入链接 | PASS | `{"row": "UI.toolbar.插入链接", "label": "工具栏插入链接→链接地址对话框", "dialogOpened": true, "dialogText": "链接地址"}` |
| 41 | F-F3-UI.toolbar.插入公式 | PASS | `{"row": "UI.toolbar.插入公式", "label": "工具栏插入公式→行内公式编辑器", "dialogOpened": true, "dialogText": "行内公式"}` |
| 42 | F-F3-UI.toolbar.插入块级公式 | PASS | `{"row": "UI.toolbar.插入块级公式", "label": "工具栏插入块级公式→块级公式编辑器", "dialogOpened": true, "dialogText": "块级公式"}` |
| 43 | F-F3-UI.toolbar.注释-脚注 | PASS | `{"row": "UI.toolbar.注释-脚注", "label": "工具栏注释（脚注）→插入注释对话框", "dialogOpened": true, "dialogText": "插入注释"}` |
| 44 | F-F3-UI.toolbar.保存-Ctrl-S | FAIL | `{"row": "UI.toolbar.保存-Ctrl-S", "label": "工具栏保存按钮→磁盘落盘", "saveClicked": true, "diskSaved": false}` |
| 45 | F-F3-UI.toolbar.微分-d-转正体-另存为新文件 | PASS | `{"row": "UI.toolbar.微分-d-转正体-另存为新文件", "label": "工具栏微分 d 转正体→预览对话框", "dialogOpened": true}` |
| 46 | F-F3-UI.toolbar.历史快照 | PASS | `{"row": "UI.toolbar.历史快照", "label": "工具栏历史快照→历史版本面板", "dialogOpened": true, "dialogText": "历史版本"}` |
| 47 | F-F3B-CMD.editor.heading.2 | PASS | `{"row": "CMD.editor.heading.2", "kind": "heading", "label": "工具栏「样式/标题」选择器 → 标题2", "before": 0, "after": 1}` |
| 48 | F-F3B-CMD.editor.heading.3 | PASS | `{"row": "CMD.editor.heading.3", "kind": "heading", "label": "工具栏「样式/标题」选择器 → 标题3", "before": 0, "after": 1}` |
| 49 | F-F3B-CMD.editor.link.insert | FAIL | `{"row": "CMD.editor.link.insert", "kind": "link", "label": "工具栏插入链接 → 地址对话框输入 URL → 真实链接节点", "dialogOpened": true, "before": 0, "after": 0, "hrefs": []}` |
| 50 | F-F3B-CMD.editor.image.insert | PASS | `{"row": "CMD.editor.image.insert", "kind": "image", "label": "工具栏插入图片 → 官方 file input 注入 fixture 图片 → 真实上传+图片节点", "fileInputHooked": true, "fileInputClicks": 1, "inject": {"ok": true, "size": 70}, "before": 0, "after": 2}` |
| 51 | F-F3B-CMD.editor.math.block | PASS | `{"row": "CMD.editor.math.block", "kind": "math_block", "label": "工具栏插入块级公式 → mathBlock 节点", "modalOpened": true, "before": 0, "after": 1}` |
| 52 | F-F3B-CMD.editor.module.insert | FAIL | `{"row": "CMD.editor.module.insert", "kind": "module", "label": "工具栏插入模块 → 模块选择器 → 插入模块正文", "pickerOpened": true, "inserted": false, "preExisting": false}` |
| 53 | F-F3B-CMD.editor.footnote.insert | PASS | `{"row": "CMD.editor.footnote.insert", "kind": "footnote", "label": "工具栏注释（脚注）→ 对话框输入 → 脚注节点", "dialogOpened": true, "before": 0, "after": 2}` |
| 54 | F-F3B-CMD.editor.note.insert | PASS | `{"row": "CMD.editor.note.insert", "kind": "note", "label": "工具栏信息块 → ke-note 节点", "before": 0, "after": 1}` |
| 55 | F-F3B-CMD.editor.table.insert | PASS | `{"row": "CMD.editor.table.insert", "kind": "table", "label": "工具栏表格 → 2×2 表格节点", "pickerOpened": true, "cellClicked": true, "before": 0, "after": 1}` |
| 56 | F-F3B-UI.toolbar.插入图片 | PASS | `{"row": "UI.toolbar.插入图片", "kind": "image", "label": "工具栏插入图片 → 官方 file input 注入 fixture 图片 → 真实上传+图片节点（与 CMD.editor.image.insert 同一次执行）", "fileInputHooked": true, "fileInputClicks": 1, "inject": {"ok": true, "size": 70}, "before": 0, "after": 2}` |
| 57 | F-F3B-UI.toolbar.撤销 | PASS | `{"row": "UI.toolbar.撤销", "kind": "undo", "label": "工具栏撤销 → 编辑回退", "markerPresent": true, "undone": true}` |
| 58 | F-F3B-UI.toolbar.重做 | PASS | `{"row": "UI.toolbar.重做", "kind": "redo", "label": "工具栏重做 → 编辑恢复", "markerPresent": true, "undone": true, "redone": true}` |
| 59 | F-AUDIT-F16 原生菜单只读结构审计（menu.rs；DOM/W 未覆盖，CSV 记 NOT_RUN） | PASS | `{"itemCount": 11, "domDriven": false, "wCovered": false, "source": "desktop/src-tauri/src/menu.rs"}` |
| 60 | F-PA-0 pack A 启用：会话 active + guest iframe + 发布 SDK 握手 | PASS | `{"state": "active", "capabilities": ["ui.shell", "panel.sidebar", "context.read", "print.request"], "sid": true}` |
| 61 | F-PA-1 F12 pack A：context.snapshot 读取正文原字符串（含 frontmatter） | PASS | `{"snapshot": {"relPath": "Articles/fe-ledger.md", "revision": 1, "hasContent": true, "contentLen": 153, "title": "F 台账标题-官方"}, "domTitle": "F 台账标题-官方", "expectedTitle": "F 台账标题-官方", "revision": 1}` |
| 62 | F-PA-2 F06 pack A：读取 basic.md 的 KE 信息块/公式原文 | PASS | `{"relPath": "Articles/basic.md", "contentLen": 640, "hasKeNote": true, "hasMath": true, "domContentHead": "# 一级标题\n\n普通段落，包含 **加粗**、*斜体*、`行内代码` 与 [链接](Attachments/files/sample.pdf)。\n\n## 二级标题\n\n- 无序项 A\n- 无序项 B\n  - 嵌套项\n\n1. 有序项一\n2. 有"}` |
| 63 | F-PA-3 F12 pack A：大文档（256KB）快照读取 | PASS | `{"relPath": "Articles/large-256kb.md", "contentLen": 117196, "expectedChars": 117196, "hasContent": true}` |
| 64 | F-PA-4 F14 pack A：print.snapshot → 真实 PDF（%PDF，>1000B，隔离目录） | PASS | `{"printResult": {"pdfToken": "pdf-mveyh16j-y348uo3v", "pages": null}, "pdfPath": "C:\\ke-tmp\\uiws-t26-F\\pdf-out\\print-fe-ledger-r1-mveyh0z21319.pdf", "pdfSize": 68233, "pdfHead": "%PDF"}` |
| 65 | F-PA-5 pack A：非法路径错误以类型化错误展示（不静默） | PASS | `{"lastError": {"code": "E_BAD_PAYLOAD", "message": "print.snapshot relPath 非法: ../escape.md"}, "errorText": "E_BAD_PAYLOAD: print.snapshot relPath 非法: ../escape.md"}` |
| 66 | F-PA-6 F07/F08 pack A：官方保存 → document-saved 事件到达 guest 并自动刷新快照 | PASS | `{"event": {"type": "document-saved", "relPath": "Articles/fe-ledger.md", "revision": 2, "receivedAt": 1792396390852}, "autoRefreshed": true, "saved": false, "eventMethod": "bridge-window-event(产品真实事件入口；保存链由 F-OFF-2 覆盖)", "hostEventLog": ["document-saved"]}` |
| 67 | F-PA-7 F15 pack A：官方主题切换 → theme-changed 事件到达 guest | PASS | `{"event": {"type": "theme-changed", "theme": "dark", "receivedAt": 1792396453107}, "eventMethod": "real-theme-toggle", "hostEventLog": ["document-saved", "theme-changed", "theme-changed"]}` |
| 68 | F-PA-8 pack A 停用：会话 stopped + guest iframe 卸载 | PASS | `{"stopClicked": true, "state": "stopped", "guestIframes": 0}` |
| 69 | F-PB-0 pack B 启用：会话 active + guest iframe + 发布 SDK 握手 | PASS | `{"state": "active", "capabilities": ["ui.shell", "panel.dock", "context.read"], "sid": true}` |
| 70 | F-PB-1 F02 pack B：读取快照 + frontmatter 自动填充标题 | PASS | `{"snapshot": {"relPath": "Articles/fe-ledger.md", "revision": 1, "hasContent": true, "contentLen": 153}, "formTitle": "F 台账标题-官方", "titleInput": "F 台账标题-官方", "expectedTitle": "F 台账标题-官方"}` |
| 71 | F-PB-2 F06 pack B：读取 basic.md 的 KE 信息块原文 | PASS | `{"relPath": "Articles/basic.md", "contentLen": 640, "hasKeNote": true}` |
| 72 | F-PB-3 F02 pack B：command.invoke article.set-title → 后端 frontmatter 落盘 | PASS | `{"commandResult": {"name": "article.set-title", "ok": true, "value": {"ok": true, "value": {"relPath": "Articles/fe-ledger.md", "title": "F 台账标题", "tags": ["ledger"]}}, "at": 1792396652747}, "frontmatter": "\nke_version: 1\ntitle: F 台账标题\ntags:\n  - ledger\n"}` |
| 73 | F-PB-4 F10 pack B：command.invoke article.set-tags → 后端 frontmatter 落盘 | PASS | `{"commandResult": {"name": "article.set-tags", "ok": true, "value": {"ok": true, "value": {"relPath": "Articles/fe-ledger.md", "title": "F 台账标题", "tags": ["ledger", "probe"]}}, "at": 1792396675996}, "frontmatter": "\nke_version: 1\ntitle: F 台账标题\ntags:\n  - ledger\n  - probe\n"}` |
| 74 | F-PB-5 pack B：空标题被宿主拒绝（E_TITLE）且磁盘不被改 | PASS | `{"errorText": "E_INTERNAL: E_TITLE: 标题为空或过长", "lastError": {"code": "E_INTERNAL", "message": "E_TITLE: 标题为空或过长"}, "frontmatterAfterError": "\nke_version: 1\ntitle: F 台账标题\ntags:\n  - ledger\n  - probe\n"}` |
| 75 | F-PB-6 pack B 停用：会话 stopped | PASS | `{"stopClicked": true, "state": "stopped"}` |
| 76 | F-FINAL-1 主进程存活 / 用户实例未受影响（未运行→N/A） / 会话已停用 | PASS | `{"procAlive": true, "userPid": "(not running)", "ourProcesses": 1, "finalSessionState": "stopped"}` |

## 内部路由命中（官方 UI 真实调用证据，来自隔离实例 app.log）

```json
{
  "tree": 3,
  "search": 2,
  "drafts_recovery": 31,
  "history_list": 3,
  "attachments_list": 2,
  "workspace_current": 2,
  "workspace_init": 0,
  "workspace_recent": 9,
  "context_snapshot": 10
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

## v4 第三轮增量（task-20）：F03 剩余 12 行 + F16 原生菜单审计（2026-10-19）

- 本轮 checks：**71/76 PASS**；F03 剩余 12 行真实执行 **12 行**（10 PASS / 2 FAIL）→ F03 累计 42/42 行登记。
- 历史轮次：v1 `4528897`（27 行）/ v2 `cc322ca`（事件三项修复）/ v3 `78e5c25`（F03 批量 22 行 + F14 preview_pdf）。

### F03 剩余 12 行（无默认快捷键；官方工具栏/菜单入口真实执行；真实节点/产物才 PASS）

| featureId | 结果 | 操作 | DOM 断言（前→后） |
| --- | --- | --- | --- |
| `CMD.editor.heading.2` | PASS | 工具栏「样式/标题」选择器 → 标题2 | before=0 → after=1 |
| `CMD.editor.heading.3` | PASS | 工具栏「样式/标题」选择器 → 标题3 | before=0 → after=1 |
| `CMD.editor.link.insert` | FAIL | 工具栏插入链接 → 地址对话框输入 URL → 真实链接节点 | before=0 → after=0 |
| `CMD.editor.image.insert` | PASS | 工具栏插入图片 → 官方 file input 注入 fixture 图片 → 真实上传+图片节点 | before=0 → after=2 |
| `CMD.editor.math.block` | PASS | 工具栏插入块级公式 → mathBlock 节点 | before=0 → after=1 |
| `CMD.editor.module.insert` | FAIL | 工具栏插入模块 → 模块选择器 → 插入模块正文 | before=None → after=None |
| `CMD.editor.footnote.insert` | PASS | 工具栏注释（脚注）→ 对话框输入 → 脚注节点 | before=0 → after=2 |
| `CMD.editor.note.insert` | PASS | 工具栏信息块 → ke-note 节点 | before=0 → after=1 |
| `CMD.editor.table.insert` | PASS | 工具栏表格 → 2×2 表格节点 | before=0 → after=1 |
| `UI.toolbar.插入图片` | PASS | 工具栏插入图片 → 官方 file input 注入 fixture 图片 → 真实上传+图片节点（与 CMD.editor.image.insert 同一次执行） | before=0 → after=2 |
| `UI.toolbar.撤销` | PASS | 工具栏撤销 → 编辑回退 | before=None → after=None |
| `UI.toolbar.重做` | PASS | 工具栏重做 → 编辑恢复 | before=None → after=None |

### F16 原生菜单结构审计（只读 menu.rs；DOM/W 未覆盖）

- 审计 11 个 MenuItem（含 ID/标签/加速键/事件 ID）；**原生菜单非 DOM，CDP 无法真实点击 → 仅结构性证据（U/静态）**；CSV 11 行如实 NOT_RUN。
- 证据：`evidence/P5-T26-F16-native-menu-audit.md`（含 handle_event 分发目标），报告「附录 G」G.2 有完整表格。

| MID | 标签 | 加速键 | 事件 ID |
| --- | --- | --- | --- |
| `MID_NEW` | 新建文档 | Ctrl+N | `ke-menu:new-document` |
| `MID_OPEN_WS` | 打开 Workspace… | Ctrl+O | `ke-menu:open-workspace` |
| `MID_NEW_WS` | 新建工作区… | （无） | `ke-menu:new-workspace` |
| `MID_CLOSE_WS` | 关闭工作区 | （无） | `ke-menu:close-workspace` |
| `MID_RECOVERY` | 恢复检查… | （无） | `ke-menu:recovery-check` |
| `MID_SETTINGS` | 设置… | Ctrl+, | `ke-menu:settings` |
| `MID_EXIT` | 退出 | Ctrl+Q | `ke-menu:exit` |
| `MID_RELOAD` | 重新加载 | Ctrl+R | `ke-menu:reload` |
| `MID_DEVTOOLS` | 开发者工具 | F12 | `ke-menu:devtools` |
| `MID_RELOAD` | 重新加载 | Ctrl+R | `ke-menu:reload` |
| `MID_RECENT` | 最近工作区… | （无） | `ke-menu:refresh-recent` |

## v5 F03 FAIL 根因审计（task-21，2026-10-19）

- 复核方式：`--audit-f03` 定向隔离实例（正确前置条件 + 多输入通道变体；未改产品代码）。
- **分类结论**：4×`AUTOMATION_LIMITATION`（list.bullet / save / link.insert / module.insert → 复核通过，CSV 已改判 PASS 并注明方法） + 1×`PRODUCT_BUG/FINDING`（blockquote → 保持 FAIL）。
- `CMD.editor.blockquote` 根因：`KeBlockquote`（frontend/src/editor/extensions/KeBlockJoin.ts:104/131）重写 `addKeyboardShortcuts()` 只返回 `Backspace`，覆盖丢弃上游 `@tiptap/extension-blockquote:109` 的 `Mod-Shift-b` 绑定 → Ctrl+Shift+B 无反应；工具栏「引用」命令可用（bq 0→1）。属产品缺陷（快捷方式失效），未改产品代码，记 FINDING 供决策。
- 证据：`evidence/P5-T26-F03-fail-audit.md` + JSON `f03FailAudit`；报告附录 H。

## v6 blockquote 修复后复测（task-23，2026-10-19）

- 修复提交 `f4759a2`；复测构建 `c849241bc9dd6be31cae8f3b7ac6c386b7c3431dcbec4d706f7725e86577be8f`（mtime `2026-10-19T16:43:26`）。
- `--audit-blockquote-fix` 复测：**6/6 PASS**；折叠光标/选中文本 Ctrl+Shift+B 均 blockquote 0→1（可取消）；工具栏行为不变；引用块内 atom 后空段落 Backspace 一次删除（不回归）；Ctrl+B/Ctrl+I/撤销/重做不受影响。
- 原 v5 唯一 PRODUCT_FINDING 已修复 → **F03 台账 42/42 行全部 PASS**；CSV blockquote 行改判 PASS 并注明修复后复测。
- 证据：`evidence/P5-T26-F03-fail-audit.md`「修复后复测」段 + JSON `f03FailAudit.fixed`；报告附录 I。

## v7 pack B 编辑器命令桥（task-26，2026-10-19）

- pack B 扩展：`manifest.commands` 逐条声明 **11 条** `editor.*` 命令（bold/italic/underline/strike/code/heading1-3/blockquote/undo/redo），capabilities 新增 `editor.commands.readonly`（trusted 授予）；UI 增加 11 个命令按钮 + 负向 hook；README 记录 schema 缺口。
- 产品 W 探针（新 `tools/run_t26_pack_editor_cmd_probe.py`）：**22/22 PASS**（构建→安装→trusted→guest→guest 真实 DOM 点按钮→主窗口 `.ProseMirror` DOM 断言→负向拒绝→会话仍 active）。
- F03 台账：`packBEntry` 新增 **11 行 PASS**（bold/italic/underline/strike/code/heading1-3/blockquote/undo/redo，W-T26-7..16）；F03 域行 packBEntry 记 PARTIAL（覆盖 11 行 + schema 缺口）。
- 负向：大写/未知/未声明命令均 `E_FORBIDDEN`（broker manifest 前置），主窗口 DOM 不变，不假成功。
- schema 缺口：`bulletList`/`orderedList`/`codeBlock` camelCase 无法在 manifest 声明（正则 `^[a-z][a-z0-9.-]{1,80}$`）→ 相应行保持 NOT_RUN。
- 证据：`evidence/P5-T26-pack-editor-cmd.md` + `T26-pack-editor-cmd-results.json`；报告附录 J。

## v8 kebab 三命令 W + F03 packB 补齐（task-28，2026-10-19）

- 构建 `ad1ffa18a12aaa2b169c0fe386a8dae7b9e9ea0468702a4cb229df3fac144d70`（含 8a57a3f：多词命令协议名 kebab 映射）；pack B 声明 14 条 editor.* 协议名（11 单词 + 3 kebab），签名包重建。
- 产品 W 探针 **26/26 PASS**：guest 真实 DOM 点「无序列表/有序列表/代码块」→ `command.invoke(editor.bullet-list/ordered-list/code-block)` → 主窗口 DOM `ul 0→1` / `ol 0→1` / `pre 0→4` 且**撤销还原**；结果回显 `{ok:true,value:{name:<kebab>,executed:true}}`。
- 回归：原 11 条单词命令 DOM 断言与撤销/重做、负向拒绝、会话 active 全部保持 PASS（无回归）。
- F03 台账：packBEntry 新增 **3 行 PASS**（CMD.editor.list.bullet / list.ordered / codeBlock）→ **packB PASS 行数 11→14**。
- legacy camelCase 不可在 manifest 声明（schema 限制，非缺陷）：直接请求被 E_FORBIDDEN 拒绝。
- 证据：`evidence/P5-T26-pack-editor-cmd.md` v8 段 + `T26-pack-editor-cmd-results.json`；报告附录 K。

## v9 4 条动作（table/footnote/note/doc.save）W + F03 packB 补齐（task-30，2026-10-19）

- 构建 `e5a0891de9b18b5f1996470aee13927e14ffd3898244de8e37c3db26fd9223ce`（含 38748a2：18 条协议名 = 14 切换 + 4 无头动作）；pack B manifest 声明 18 条，签名包重建。
- 产品 W 探针 **30/30 PASS**：table→`table` 3 行/3 表头且撤销还原；footnote→`ke-footnote-ref`+`sup` 且撤销还原；note→`[data-ke-note]` 且撤销还原；**doc.save → 编辑 marker 后真实落盘（磁盘 marker 出现 + mtime 变化，不只查返回值）**。
- 负向：未声明/大写/未知 + 不接的对话框类（link/image/math/module）全部拒绝（E_FORBIDDEN）且 DOM 不变；原 26 项全部回归 PASS。
- F03 台账：packBEntry 新增 **4 行 PASS**（CMD.editor.table.insert / footnote.insert / note.insert / UI.toolbar.保存-Ctrl-S）→ **packB PASS 行数 14→18**。
- 证据：`evidence/P5-T26-pack-editor-cmd.md` v9 段 + `T26-pack-editor-cmd-results.json`；报告附录 L。

## v10 pack A 编辑命令桥（task-31，2026-10-19）

- pack A（侧栏阅读器）接入受控编辑命令桥：manifest 声明 18 条协议名（14 切换 + 4 动作）+ `editor.commands.readonly`；UI 新增 18 个命令按钮；保留原读/打印/事件；签名包重建。
- 产品 W 探针 `--pack a`：**30/30 PASS**（复用 pack B 同一套断言）：guest 真实 DOM 点按钮 → command.invoke → 主窗口 DOM strong/em/u/s/code/h1/h2/h3/ul/ol/pre/blockquote/table 3×3/脚注/ke-note + 撤销还原；doc.save 真实落盘（磁盘 marker+mtime）；负向全部拒绝且 DOM 不变。
- F03 台账：packAEntry 新增 **18 行 PASS**；F05 域行 packAEntry=PARTIAL（仅表格插入动作面，不伪造）。
- 证据：`evidence/T26-packA-editor-cmd-results.json` + `P5-T26-pack-editor-cmd.md` v10 段；报告附录 M。

## v11 pack 路径证据映射（task-32，2026-10-19）

- 用既有产品 W 证据补全 pack 路径行（**无新 W/不启动产品**）：新增 packA PASS **2 行**、packB PASS **5 行**（CMD.doc.save 行 ×2、W05 协议快照/订阅/命令结果 ×2、W02 表单交接 packB）。
- 不可达行（fs/modules/drafts/index/tags 后端 API，原空白）10 行 → 如实 `NOT_RUN` + W06 网络边界原因；F07 域行 `NOT_RUN→PARTIAL`（doc.save 真实落盘 + document-saved 事件；自动保存/恢复无通道）；F02/F10 域行原因更新。
- 统计：packA PASS **24/130 行**、packB PASS **25/130 行**；PARTIAL：packA 3、packB 2；详见 `evidence/P5-T26-F-pack-mapping.md`。
- 证据：`evidence/P5-T26-F-pack-mapping.md`（逐行映射/不可达原因/域统计）；报告附录 N。

## v12 参数化命令 packA/B W + F 台账（task-34，2026-10-19）

- 构建 `53dfacc35f53cafc14efd42ec5ec33cb252a1ff41a5248e149bc912d509393dd`（含 1d33dd6：21 条协议名 = 14 切换 + 4 参数化 link/math/table + 3 无参动作）；pack A/B manifest 声明 21 条，签名包重建。
- 产品 W：**pack B 36/36 PASS、pack A 36/36 PASS**（新增 6 checks/包）：link（无选区插入文本+link mark / 有选区 setLink）、math.inline/block（`.ke-math--inline`/`--block` 真实插入，**无 MathLive 弹窗**）、table {rows:2,cols:4}（真实尺寸）、撤销还原全部 PASS；负向 6 例（javascript: scheme/超长 href/缺 latex/超长 latex/rows=99/无参命令带 args）全部 `E_BAD_PAYLOAD` 且 DOM 不变。
- F 台账：`CMD.editor.link.insert`、`CMD.editor.math.block` 的 packA/packBEntry 新增 **PASS（2 行）**；`CMD.editor.table.insert` 备注更新为参数化尺寸证据；F04/F05 域行 packA/packB=PARTIAL（插入动作面，非全部深层操作）。
- 统计：packA PASS **26/130 行**、packB PASS **27/130 行**；PARTIAL A=4 B=4；详见报告附录 O。
- 证据：`evidence/T26-pack-editor-cmd-results.json`（36 checks）、`T26-packA-editor-cmd-results.json`（36 checks）、`P5-T26-pack-editor-cmd.md` v12 段。
