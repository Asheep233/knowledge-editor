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
| 7 二级页面 | 启动器（居中 hero + 主/次操作卡 + 最近使用卡片）+ 设置（居中卡片浮层 + 分组 tab + 分组卡） | ✅（知识库/搜索/模块/资料仍走侧栏而非独立页；专注模式未实现） |
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

## 4. 与设计基线的已知差异（非阻断，P2/P3，待主理人裁决）

1. **侧栏信息架构**（P2）：设计基线导航为「知识库/搜索/模块/资料/回收站 + 底部 设置/专注模式/切换外观」；当前沿用现有功能结构「全部文档/最近更新/标签/回收站 + 模块/文章/附件 + 底部仅设置」。涉及新页面入口与 IA 决策，未擅自改功能语义。
2. **文档信息浮层**（P3）：基线「文档信息」大纲优先；当前右侧浮层沿用原「文档属性」顺序（属性在前、大纲在下，含折叠至一级）。
3. **设置页形态**（P3）：基线为独立设置页；当前为居中卡片浮层（按本轮 Lead 指令形态）。「切换工作区」按钮文字在窄卡片下疑似截断。
4. **启动器**（P3）：品牌标用蓝色方块「A」而非完整品牌组合；手动路径输入非常驻（按原有交互展开）；最近使用条数以真实数据为准。
5. **命令面板 / 专注模式未实现**（P2）：`⌘K` 仍聚焦侧栏全局搜索（既有行为），未做设计稿中的命令面板；专注模式（隐藏全部 chrome）未实现。知识库/搜索/模块/资料页仍为侧栏内视图，不是独立页面。
6. 历史版本仍为原全屏模态（未改造成右侧浮层）；工坊（`VITE_KE_WORKSHOP=1` 默认关闭的实验 UI）未重排视觉。
7. 底部状态条内容（保存状态/后端版本/字数）不再常驻：保存状态在命令条；其余信息在文档信息浮层/提示层。若需要「可发现性」，建议后续在命令条 ⋯ 菜单补系统状态入口。
8. 阅读列曾实测 678px（-2px，边框计算），已修正为 680；`≤760` 断点行为由 CSS 覆盖但未单独截图取证（建议下轮补 700×900 验收图）。

## 5. 回滚与后续

- **回滚**：`focus-ui` 分支为独立分支，`git checkout feat/ui-workshop` 即回到旧三栏 UI（旧实现仍在历史中）；本轮未 force-push、未改 master。
- **推送/合并**：当前仅在本地提交（未 push）。如需分发/合并，请主理人明确授权后推 `focus-ui`（或合并回 `feat/ui-workshop`）。
- **后续优先**：① 侧栏 IA + 命令面板（⌘K）+ 专注模式（P2）；② 知识库/搜索/模块/资料独立页（P2）；③ 历史浮层化、工坊视觉、≤760 截图取证（P3）；④ Windows/Tauri 真机做一次人工视觉与 IME/DPI 回归（Linux/headless 结果不能替代 W 证据）。
