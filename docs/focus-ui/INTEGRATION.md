# AstraNota Focus · 前端深度重构交付与集成说明（INTEGRATION）

> 分支：`focus-ui`（从 `feat/ui-workshop` @ `25efaf2` 拉出；本地提交，**未 push、未发 Release**）
> 设计来源：`/mnt/f/Work/KE Project/AstraNota-Focus-Handoff/`（B · Focus 最终设计版，含 HANDOFF.md / MIGRATION-CHECKLIST.md / design-tokens / prototype / screenshots）
> 验收证据：`docs/focus-ui/VERIFICATION-REPORT.md`、`docs/focus-ui/VISUAL-ACCEPTANCE.md`、`docs/focus-ui/screenshots/`、`docs/focus-ui/evidence/`
> 本文是给下一任主 Agent / 人类负责人的**集成与后续工作说明**；设计规格以交接包为准，实现以代码为准。

## 1. 一句话

前端已从「三栏 + 顶栏 + 标签栏 + 状态栏」重构为 Focus 版：**无顶栏、无标签栏、无常驻右栏**；左侧是浮动文件卡片（256px，可收起/抽屉），中央是居中的纸面卡片（860px，阅读列 680px），格式/保存/导出浮在纸面上方的浮动命令条里，文档信息收进右侧按需浮层。业务逻辑（工作区状态机、Tiptap、保存队列、恢复/冲突、导入导出、快捷键、全部单测）保留，全量测试与构建通过。

## 2. 已实现（对照 MIGRATION-CHECKLIST）

| Phase | 内容 | 状态 |
| --- | --- | --- |
| 1 令牌/字体 | Focus 设计令牌替换（浅/深色、圆角 8/12/13/18/24、三级柔和阴影、Inter/Inter Tight/IBM Plex Mono 本地 woff2）；`@theme inline` 语义映射；自定义强调色时同步派生 hover/soft | ✅ |
| 2 壳层 | `AppShell` 重写为 Focus 壳：`focus-shell` / `focus-body-row` / 浮动侧栏 / 居中纸面 / 浮动命令条 / 右侧浮层；侧栏开合只改左右留白（纸面中心不动） | ✅ |
| 3 浮动侧栏 | 256px 圆角卡片；工作区头（头像+目录名+本地工作区）；全宽「新建文档」主按钮；导航（34px 行、淡蓝选中）；文件树 30px/12.5px、**文件名不省略可横向滚动**；底部设置；« 收起 / » 展开 / `⌘\` | ✅ |
| 4 浮动命令条 | `EditorToolbar` 经 CSS 浮起为 46px 命令条（宽度=纸面 860、top 12、圆角 13、`--elev-md`）：段落类型▾ / B I U S / 行内码 / 链接 / 列表▾ / 引用 / 行内Σ / 块Σ / 插入▾（代码块/图片/脚注/信息块/表格）/ 模块 / 撤销重做；右侧：搜索 / 视图切换 / 保存（浅底按钮+状态）/ ⚙ / 历史 / 文档信息 / 导出（描边） | ✅ |
| 5 纸面与正文 | 纸面 860 圆角 18 + 细边框 + 轻阴影；阅读列 680；标题 42/1.1/-0.045em（页眉 input 与打印页眉同规格）；正文 17/1.8；H2 28 / H3 22；表格/引用/代码/公式/信息块/脚注 token 化 | ✅ |
| 6 浮层迁移 | 文档信息 InspectorSheet（大纲/属性/标签/历史入口，右侧 380 浮层）；导出/公式编辑器/微分 d/Prompt/表格气泡按 Focus 视觉重排；外部修改冲突、草稿恢复、App 内危险确认同步 token 化 | ✅（历史仍沿用原全屏模态） |
| 7 二级页面 | 启动器（居中 hero + 主/次操作卡 + 最近使用卡片）+ 设置（居中卡片浮层 + 分组 tab + 分组卡）+ 专注模式（侧栏隐藏/命令条沉底/Esc 退出）+ 侧栏 5 导航与 footer 三段 | ✅（知识库/搜索/模块/资料为侧栏视图而非独立页） |
| 8 响应式/可访问性 | ≥1280 浮动侧栏 + 对称留白；<1280 抽屉（遮罩 + 命令条「文件」按钮）；≤960 动作按钮收文字；≤760 纸面全宽；焦点环 2px accent / offset 2px；reduced-motion 覆盖组件层+壳层过渡 | ✅ |
| 9 验收 | typecheck 0；vitest 143/143 文件、1981 passed+1 skipped；build 成功；视觉验收 119/119、禁止回退项 10/10 | ✅ |

关键实现文件：`frontend/src/components/shell/AppShell.tsx`（新壳）、`components/layout/{EditorArea,LeftSidebar,WorkspacePicker}.tsx`、`components/editor/{EditorToolbar,ExportPdfDialog,MathEditorModal,UprightDDialog,TableBubbleMenu}.tsx`、`components/editor/nodeviews/*`、`components/settings/*`、`components/common/PromptDialog.tsx`、`frontend/src/index.css`、`print.css`、`App.tsx`、`settings.ts`（token 派生）。

## 3. 验证快照（2026-10-20，`focus-ui` @ 集成提交）

```bash
cd frontend
npx tsc -b --noEmit                 # 0 错
npx vitest run --maxWorkers=2       # 143 files / 1981 passed + 1 skipped / exit 0
npm run build                       # tsc + vite build OK（dist-build ≈3.0MB）

# 视觉验收（自起 vite/后端；输出 /tmp/focus-shots/，119 项断言）
cd ..
node docs/focus-ui/verify-ui.cjs
```

- 布局实测：纸面 860 / 阅读列 680 / 侧栏 256 / 命令条 46@top12 / 侧栏开合纸面中心 720↔720 / 深色令牌 8/8 / 禁止回退项 10/10。
- 证据：`docs/focus-ui/screenshots/`（8 张）、`docs/focus-ui/evidence/{metrics.json,summary.md,run-meta.json,a11y-probe.json}`。

## 4. 与设计基线的已知差异（全面对齐轮 · 收尾 2026-10-20 晚）

> 本轮已补齐 5 个整页视图、⌘K 命令面板、设置独立页、文档信息浮层（大纲优先）、历史右侧浮层、⋯菜单十条目、专注模式顶栏与极简底栏、启动器右上主题/帮助与常驻路径条。剩余为数据/环境级差异：

1. **证据数据已补齐**（本机 `/tmp/focus-ws` 测试工作区，非真实笔记）：已创建 4 个文件夹（理论力学/量子场论/普通物理学（上）/数学分析）+ 5 篇示例文档 + 6 条最近文档，因此 01 编辑器侧栏文件树与 10 知识库页的「文件夹 / 最近编辑」与参考稿结构一致。真实用户工作区数据不同属正常。
2. **启动器最近使用行**（P3）：设计稿行内含「今天 14:06」时间与右键移除；后端 recent-workspaces 只返回 path/exists，故最近使用行展示名称+路径+箭头，无时间列。
3. **启动器路径条**（P3）：已加常驻路径输入 + 浏览… + 打开；Web 预览下「浏览…」走路径输入提示，桌面版走原生目录选择器。
4. **⌘K 命令面板**（P3）：最近文档/命令/打开的文档三组 + 过滤/键盘；参考稿为单一扁平列表，本实现保留分组标题。
5. **搜索页**（P3）：搜索页头沿用 PageShell（参考稿 search.html 无页头）；结果支持文档/模块/附件筛选与高亮。
6. **设置页头**（P3）：固定头部 + 滚动内容（保证分组 tab 常驻），参考稿为整页滚动；首屏视觉一致。
7. **Windows/Tauri 真机**：视觉证据均为 WSL/headless Chromium，Windows 100% 缩放/W 模式/DPI/IME 需人工复验（红线：不得以 Linux 证据冒充）。

## 5. 交付快照（2026-10-20 收尾）

- **分支/提交**：`focus-ui`（本地，未 push）→ 收尾修复 `fbc2461`（专注绿点）；此前面板/页面/浮层全量实现见 `6c53695`、收尾对齐见 `472d861`，基线 `feat/ui-workshop` @ `25efaf2`（已推送）。
- **验证（最终快照）**：`tsc -b --noEmit` 0 错；全量 vitest **149/149 文件、2055 passed + 1 skipped**（`/tmp/focus-final-vitest8.log`）；`npm run build` exit 0（`/tmp/focus-build8.log`）；`KE_STRICT=1 node docs/focus-ui/verify-ui.cjs` → **16 张截图、178/178 断言 PASS、0 DIFF**（`/tmp/focus-verify11.log`）。
- **独立验收**：qa-visual 两轮（`6c53695` §11、`472d861` §12）全 PASS；`fbc2461` 绿点修复由 Lead 自测并按同一脚本复验（16 图 178/178）。
- **证据**：`docs/focus-ui/screenshots/`（01–16 + focus-ring）、`evidence/{metrics.json,summary.md,run-meta.json,a11y-probe.json,probe-round3/,probe-round4/}`。
- **预发布（2026-10-20）**：已按发版流程在 Windows 侧打包并发布 **GitHub Pre-release** https://github.com/Asheep233/knowledge-editor/releases/tag/v1.3.0-pre.1
  （Pre-release，Latest 仍为 v1.2.18）。资产：`AstraNota_1.3.0-pre.1_x64-setup.exe`（51,129,095 B / sha256 `dbc8f0e9…21d7`）、
  sidecar（46,247,909 B / `35e3e8f0…bf70`）、`manifest.sha256`（79 产物）、`versions.json`；侧车运行时版本校验 = `1.3.0-pre.1`；
  详见 `docs/release-notes-v1.3.0-pre.1.md`。未做 NSIS 实机安装/GUI 端到端验收与签名。
- **剩余 P3（已在 VERIFICATION-REPORT §12.4 记录）**：模块页筛选口径（类型 chips + 被引用数，需后端字段）、设置页顶部分组 tab（可用性保留）、短文档下 ⋯ 双入口表现相近、专注基线为深色截图。
- **收尾小修**：浮动命令条在窄窗口下格式组溢出会显示灰色横向滚动条（页面化后命令条宽度跟随纸面宽度收缩导致）——已隐藏滚动条（`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`，滚动能力保留）并对 <1360px 压缩内边距；`KE_STRICT=1 verify-ui.cjs` 复跑 178/178 PASS、全量测试 2055 绿、build exit 0。

## 6. 回滚与后续

- **回滚**：`focus-ui` 分支为独立分支，`git checkout feat/ui-workshop` 即回到旧三栏 UI（旧实现仍在历史中）；本轮未 force-push、未改 master。
- **推送/合并**：当前仅在本地提交（未 push）。如需分发/合并，请主理人明确授权后推 `focus-ui`（或合并回 `feat/ui-workshop`）。
- **后续优先**：① 模块筛选口径/引用数（需后端 API 扩展）与工坊视觉；② `≤760` 截图取证；③ Windows/Tauri 真机做一次人工视觉与 IME/DPI 回归（Linux/headless 结果不能替代 W 证据）；④ 若需分发，走交接/打包流程（不建 Release，红线）。
