# AstraNota Focus · 视觉验收清单（VISUAL-ACCEPTANCE）

> 用途：对照设计交接包建立**可复跑的视觉验收基线**。本文是"检查什么 + 怎么判 + 当前结论"的唯一清单；
> 自动截图/断言由 `docs/focus-ui/verify-ui.cjs` 执行，证据落 `/tmp/focus-shots/`。
> 设计基线：`/mnt/f/Work/KE Project/AstraNota-Focus-Handoff/`（`HANDOFF.md` §2/§4/§5/§8/§10、
> `design-tokens.css`、`design-tokens.json`、`screenshots/*.png`、`MIGRATION-CHECKLIST.md`「禁止回退项」）。

## 0. 如何复跑

```bash
# 从仓库根（脚本自动：确保后端 8000、起一个全新 vite 进程、自找空闲端口、跑完关闭）
node docs/focus-ui/verify-ui.cjs

# 断言出现 DIFF 也判红（最终验收用）
KE_STRICT=1 node docs/focus-ui/verify-ui.cjs

# 复用一个"你确认新鲜"的已有 dev server（快；WSL drvfs 下现有 server 可能服务陈旧模块）
KE_REUSE_VITE=1 node docs/focus-ui/verify-ui.cjs
```

产物（默认 `/tmp/focus-shots/`）：

| 文件 | 内容 |
|---|---|
| `01-editor-light-1440x900.png` | 浅色编辑器（侧栏展开 + 居中纸面 + 浮动命令条） |
| `02-editor-collapsed-sidebar-1440x900.png` | 侧栏收起（» 浮块，纸面中心不动） |
| `03-editor-inspector-sheet-1440x900.png` | 文档信息右侧浮层（380px sheet） |
| `04-editor-dark-1440x900.png` | 深色编辑器（同一布局，深色令牌） |
| `05-launcher-1440x900.png` | 启动器页（`/api/workspace/current` 拦截为未打开） |
| `06-more-menu-1440x900.png` | ⋯ 更多菜单（十条目；设置页见 `16-settings-page-1440x900.png`） |
| `07-editor-drawer-1024x800.png` | 1024 窄屏抽屉（遮罩 + 256px 浮层） |
| `08-editor-narrow-800x900.png` | 800 窄屏（纸面 = min(860,100%)，命令条 100%-20px） |
| `09-focus-mode-1440x900.png` | 专注模式（侧栏隐藏、顶栏含已保存/主题、**极简格式底栏**、命令条沉底 720@距底16、纸面去边框） |
| `10-library-page-1440x900.png` | 知识库整页（标题/统计/导入·新建/继续写作/最近编辑/标签/文件夹） |
| `11-search-page-1440x900.png` | 搜索整页（搜索框/重建索引/空态） |
| `12-modules-page-1440x900.png` | 模块整页（统计/新建/筛选/卡片） |
| `13-assets-page-1440x900.png` | 资料整页（统计/仅看未引用/上传/类型计数/空态） |
| `14-trash-page-1440x900.png` | 回收站整页（刷新/清空/空态/说明） |
| `15-command-palette-1440x900.png` | ⌘K 命令面板（最近文档/命令/打开的文档） |
| `16-settings-page-1440x900.png` | 设置独立页（← 知识库/标题 40px/分组卡片） |
| `metrics.json` | 全部断言 + 实测值（机器可读证据） |
| `summary.md` / `run-meta.json` | 本次运行 PASS/DIFF 摘要 + 环境（URL/端口/git/控制台错误/失败请求） |

脚本约束（红线）：只读产品代码；只写 `docs/focus-ui/` 与 `/tmp/focus-shots/`。

**环境注意（WSL `/mnt/f` / drvfs）**：实测已在跑的 vite dev server 会漏文件变更事件、继续返回**陈旧模块**
（改 `frontend/src` 后 `curl /src/App.tsx` 仍是旧代码；带 `?t=` 的请求才重新 transform）。
因此脚本默认另起全新 vite 进程截图，避免"截图与磁盘代码不一致"的假证据。后端/端口可用
`KE_BACKEND_URL`、`KE_VITE_PORT`、`KE_BASE_URL`、`KE_REUSE_VITE` 覆写。

---

## 1. 壳层与布局（对照 HANDOFF §2）

| # | 检查项 | 期望（设计基线） | 判定方式（verify-ui 断言 / 人工） | 当前结果 |
|---|---|---|---|---|
| L1 | 无全局顶栏 | 无 topbar；侧栏卡片从 `top:10px` 开始 | 断言「侧栏上间距 10（无顶栏）」 | PASS（y=10） |
| L2 | 浮动侧栏位置/尺寸 | `left:10 top:10 bottom:10`、宽 256、圆角 18、`--shadow-sm` | 断言「侧栏宽 256 / 左 10 / 上 10 / 下 10 / 圆角 18」 | PASS |
| L3 | 桌面左右对称留白 | 侧栏展开时 `padding-left/right = 280px` | 断言「左右对称留白 280」「右侧留白 280」 | PASS（280/280） |
| L4 | 纸面卡片 | 最大宽 860、圆角 18、1px 边框、轻阴影、居中 | 断言「纸面宽 860 / 圆角 18 / 1px 边框 / 中心=720 / 左边缘 290」 | PASS |
| L5 | 阅读列 | 固定 680px，标题/正文/公式同列 | 断言「阅读列宽 680 ±3」「阅读列居中」 | PASS（实测 678，见 §8 备注） |
| L6 | 浮动命令条 | 宽=纸面宽 860、高 46、`top:12`、圆角 13、`--shadow-md`、浮在纸面上方 | 断言「命令条高 46 / 顶部 12 / 圆角 13 / 与纸面等宽 / x 对齐」 | PASS（y=12、底 58 与纸面 68 间距 10） |
| L7 | 侧栏开合纸面中心不动 | 开合只改左右灰边，正文中心不移动（关键禁止回退项） | 断言「开合侧栏纸面中心不动」 | PASS（720↔720） |
| L8 | 侧栏收起后的 » 浮块 | 桌面 `left:10 top:10`，34×38，可重新展开 | 断言「展开浮块 34×38 / left:10 / top:10」 | PASS |
| L9 | 右侧信息栏不常驻 | 默认不渲染 inspector；按需浮层 380px | 断言「无常驻右侧信息栏」「浮层宽 380 / 右 10 / 上 10 / 圆角 18」 | PASS |
| L10 | 标签栏不常驻 / 状态条不常驻 | `tab-strip`、status 均隐藏（DOM 保留给逻辑/测试） | 断言「tab-strip display:none」「status display:none」 | PASS |
| L11 | 抽屉不挤压布局 | 1024 抽屉覆盖画布，纸面中心仍 512 | 断言「1024 纸面居中 512」「抽屉开合纸面中心不动」「主体区无留白」 | PASS |
| L12 | 窄屏纸面 | ≤760 全宽去边框圆角；760–1280 取 `min(860,100%)` | 断言「800 纸面 = 800 / 居中 400 / >760 保留 18 圆角」「命令条 780」 | PASS |
| L13 | 专注模式（保真第二轮） | 侧栏隐藏；命令条沉底居中（720 上限、距底 16）；纸面去边框/圆角/阴影；`Esc` 或「退出专注」返回 | 断言 `09-focus` 8 项（`data-focus-mode=1` / 侧栏 none / 命令条 720×44@底16 / border 0 / shadow none / Esc 退出） | PASS（与基线 `focus.png` 的顶部/底栏细节差异见 §9-8） |
| L14 | 二级页面整页（全面对齐轮） | 知识库/搜索/模块/资料/回收站为主画布整页：`.focus-page-layer[data-page]`、页面标题 40px、页激活时隐藏命令条、侧栏保留文件树 | 断言 `10-pages` 20 项 + `10–14` 截图 | PASS（上轮 §9-9 已解决） |
| L15 | ⌘K 命令面板 | 最近文档（前 5）/命令/打开的三组；输入框自动聚焦；替代常驻标签栏 | 断言 `15-palette` 5 项 + `15` 截图 + 补充探针 | PASS（三组齐全，17 项） |
| L16 | 历史右侧浮层 | 右侧 420px sheet（标题历史版本、刷新/关闭、当前版本） | 探针 + `evidence/probe-round3/18-history-sheet` | PASS（420×880 @右侧10） |
| L17 | 专注模式顶栏 + 极简底栏 | 「← 文档标题」+「● 已保存」（含绿点）+ 主题切换；底栏仅格式组；进入专注自动切回编辑器页 | 断言 `09-focus` 11 项 + 探针（`.focus-toolbar-actions display:none`、可见按钮仅格式组） | PASS（收尾轮已解决；绿点亦于 `fbc2461` 补齐） |

## 2. 设计令牌（对照 `design-tokens.css` / HANDOFF §4）

| # | 检查项 | 期望 | 判定方式 | 当前结果 |
|---|---|---|---|---|
| T1 | 浅色语义色 | bg `#f5f5f7`、card `#ffffff`、text `#1d1d1f`、text-2 `#6e6e73`、text-3 `#8e8e93`、line `#e8e8ed`、line-2 `#d2d2d7`、accent(primary) `#0071e3` | 断言「浅色 令牌 --*」8 项 | PASS |
| T2 | 深色语义色 | bg `#000000`、card `#0e0e10`、text `#f5f5f7`、text-2 `#a1a1a6`、text-3 `#6e6e73`、line `#232325`、line-2 `#333336`、accent `#0a84ff` | 断言「深色 令牌 --*」8 项 + 计算样式（body/纸面/侧栏/标题） | PASS |
| T3 | 圆角阶梯 | panel 18 / bar 13 / menu 12 / control 8 / dialog 24 | 断言 `--radius-*` 5 项 | PASS |
| T4 | 布局令牌 | `--focus-sidebar-w:256`、`--focus-side-reserve:280`、`--focus-paper-w:860`、`--focus-read-w:680`、`--focus-bar-h:46`、`--focus-bar-top:12`、`--focus-paper-top:68`、`--focus-paper-pad-top:100` | 断言 8 项令牌 | PASS |
| T5 | 字体栈 | sans=Inter/Noto Sans SC…；display=Inter Tight…；mono=IBM Plex Mono…；本地加载（无 CDN） | 断言「字体栈含 Inter / Inter Tight / IBM Plex Mono」；人工确认无远程 `@import` | PASS（本地字体，字形回退需人工目检） |
| T6 | 阴影三级、深色独立 | 浅色轻（sm/md/lg）；深色沉、独立定义；不用渐变/发光 | 断言「深色阴影 rgba(0,0,0,…) 且与浅色不同」；视觉目检 | PASS |
| T7 | 单一强调色 | 仅一个蓝色强调色，其余中性灰阶；无第二强调色/渐变 | 视觉目检（命令条/新建/选中/导出按钮） | PASS（未见第二强调色/渐变） |

## 3. 字号与排版（对照 HANDOFF §4/§5）

| # | 检查项 | 期望 | 判定方式 | 当前结果 |
|---|---|---|---|---|
| P1 | 文档标题 | 42px / 行高 1.1 / 字距 -0.045em / 字重 650 / Inter Tight | 断言「标题 42px / 行高 46.2 / 字距 -1.89 / 字重 650」 | PASS（实测 -1.9px） |
| P2 | 正文 | 17px / 行高 1.8（30.6px） | 断言「正文 17px / 行高 30.6」 | PASS |
| P3 | H2 / H3 | H2 28px、H3 22px，粗体，不靠颜色区分层级 | 断言「H2 28px」+ 视觉目检 | PASS |
| P4 | 界面字号 | UI 13px 为主；元信息 12.5px；mono 元信息 11px 级 | 断言 12.5px 元信息（`data-ke-doc-header` 首行）+ 视觉目检 | PASS |
| P5 | 正文排版 | 段距约 1em；引用/信息块/公式/脚注/表格/代码块按 §5 样式 | 人工对照 `screenshots/editor.png`（本批截图覆盖常规段落+信息块+行内/块级公式） | 大体 PASS；节点视觉细节建议节点专项复核（task-3 已做） |

## 4. 深浅色（对照 HANDOFF §4 + `screenshots/editor-dark.png`）

| # | 检查项 | 期望 | 判定方式 | 当前结果 |
|---|---|---|---|---|
| D1 | 深色不是简单反色 | `data-theme=dark`；bg 纯黑、卡片 #0e0e10、边框 #232325、强调 #0a84ff | 断言 8 令牌 + 计算样式 | PASS |
| D2 | 深色纸面/侧栏/标题 | 纸面 & 侧栏 = `--card`；标题 = `--foreground` #f5f5f7 | 断言计算样式 3 项 | PASS |
| D3 | 深色阴影 | 与浅色不同的沉阴影（rgba(0,0,0,.5) 级） | 断言 `--elev-sm` 值 | PASS |
| D4 | 主题持久化 | 设置主题 = localStorage `ke.settings.v1.ui.theme`，加载即应用 | 脚本用 `addInitScript` seed 深色后实测 `data-theme=dark` | PASS |
| D5 | 品牌 Logo 双版本 | 浅/深色切换 `an-logo-light/dark` | 视觉目检（启动器截图） | PASS（浅色版可见；深色版由 CSS 切换） |

## 5. 响应式断点（对照 HANDOFF §8）

| 断点 | 期望行为 | 本清单覆盖方式 | 当前结果 |
|---|---|---|---|
| ≥1280 | 浮动侧栏 + 居中纸面；左右 280 对称留白 | `01/02/03/04` 截图 1440 | PASS |
| 1024–1279 | 侧栏改抽屉；命令条出现「文件与导航」按钮；不显示左侧 » 浮块 | `07` 截图 1024（抽屉开/关两态断言） | PASS |
| ≤960 | 命令条动作按钮只留图标 | `08` 800 档（`width = 100%-20`）断言 | PASS（按钮文字精简由组件 Tailwind 断点负责，视觉目检） |
| ≤820 | 继续抽屉；文件/导航由命令条按钮打开 | 同 800 档断言「文件抽屉按钮 display:grid」 | PASS |
| ≤760 | 纸面全宽、去边框圆角；命令条左右 12px | 800 档为 760–1280 区间（保留圆角）；**≤760 档未拍**，建议后续加 700×900 一张专测 | 部分覆盖（超范围说明） |
| 全宽度 | 纸面中心 = 窗口中心 | 1440（720）、1024（512）、800（400）三档断言 | PASS |

## 6. 禁止回退项（MIGRATION-CHECKLIST / HANDOFF §10）

| # | 禁止回退项 | 判定方式 | 当前结果 |
|---|---|---|---|
| R1 | 恢复全宽顶栏 | 侧栏 `top=10`、命令条 `top=12`、无 topbar 层 | PASS |
| R2 | 恢复常驻标签栏 | `tab-strip display:none` 断言 | PASS |
| R3 | 恢复常驻右侧栏 | inspector 默认不渲染断言 + 截图 | PASS |
| R4 | 纸面改成通栏/贴边 | 纸面宽 860、左右留白 280、圆角 18 断言 | PASS |
| R5 | 侧栏开合导致纸面中心移动 | 中心 720↔720 断言（±1px） | PASS |
| R6 | 文件名省略号截断 | 侧栏文件名 `text-overflow: clip`（非 ellipsis）、完整文本在 DOM | PASS |
| R7 | 再引入小字/渐变/发光装饰 | 视觉目检：无渐变/发光；界面字号 12.5–13px | PASS |
| R8 | 正文加阴影/纸张纹理 | 纸面仅 `--shadow-sm`；正文无阴影/纹理 | PASS |
| R9 | 多强调色/装饰性统计卡 | 视觉目检命令条/侧栏/纸面 | PASS（未见） |
| R10 | 深色直接反色 | 深色独立令牌 + 独立阴影断言 | PASS |

## 7. 可访问性与动效（对照 HANDOFF §9）

| # | 检查项 | 期望 | 判定方式 | 当前结果 |
|---|---|---|---|---|
| A1 | 图标按钮有 aria-label/title | 关键按钮（收起/展开/文件抽屉/文档信息/保存/导出/设置）均有 aria-label 或 title | 脚本选择器均靠 aria-label/testid 命中（反证存在）+ 人工抽检 | PASS |
| A2 | `:focus-visible` 2px accent 外圈 | 全局 `:is(button,a,input,select,textarea):focus-visible{outline:2px solid var(--ring)}` | 静态规则核对 `frontend/src/index.css:214` + Playwright 键盘 Tab 实测（`/tmp/focus-shots/a11y-probe.json`、`evidence-focus-ring-1440x900.png`） | PASS（实测 3 个按钮：`outline: 2px solid rgb(0,113,227)`、offset 2px） |
| A3 | 动效 140–220ms、`prefers-reduced-motion` 支持 | 过渡 140/150/180/220ms；Tailwind `motion-reduce:` 变体 23 处 | 静态核对 + Playwright `reducedMotion=reduce` 实测（a11y-probe.json） | PASS（组件过渡在 reduce 下 `transition-property:none`）；**观察项**：`index.css` 壳层自定义过渡（侧栏 padding 220ms、收起/展开 140ms）无 `@media (prefers-reduced-motion: reduce)` 覆盖 → §9-7 |
| A4 | 菜单 Esc 关闭 / 焦点返回 | 关键菜单支持 Esc | 行为测试覆盖（vitest）+ 人工抽检设置/浮层 | PASS（以单测为准，未单独截图） |

## 8. 视觉对照基线截图（人工核对表）

基线截图目录：`/mnt/f/Work/KE Project/AstraNota-Focus-Handoff/screenshots/`。

| 基线截图 | 对应本次截图 | 对照结论 | 差异/备注 |
|---|---|---|---|
| `editor.png`（浅色 1440） | `01-editor-light-1440x900.png` | **保真第二轮后：侧栏 5 导航 + footer 三段 + 主题图标、命令条右侧 搜索/⋯/保存/导出、元信息格式、引用块无底色均与基线对齐；布局/令牌/字号一致** | ~~§9-1 侧栏 IA~~ 已解决；仅剩数据驱动差异（测试工作区 1 文档/1 模块）与命令条图标集合差异（功能保留） |
| `editor-dark.png`（深色 1440） | `04-editor-dark-1440x900.png` | 深色令牌、纸面、命令条、侧栏均一致 | 侧栏 IA 已在保真第二轮对齐（同 editor.png） |
| `overlays.png`（23 组状态目录） | `03-editor-inspector-sheet-1440x900.png` | 文档信息浮层形态（右侧 sheet、380、圆角 18）一致；入口已按第二轮设计移入命令条「⋯ 更多」菜单 | 结构顺序差异：基线「文档信息」= 大纲优先；当前「文档属性」= 属性优先、大纲在后（含「折叠至一级」）→ 见 §9-2 |
| `settings.png` | `16-settings-page-1440x900.png` | **PASS**：独立设置页（← 知识库 + 设置 40px + 分组卡片），内容分组一致 | 保留顶部分组 tab（基线为单列分组标题）→ §9-11 |
| `launcher.png` | `05-launcher-1440x900.png` | **PASS**：品牌标 84px + 46px 标题 + 720 列 + 两操作卡 + **常驻路径条（hard-drive 图标 + 输入 + 浏览…/打开）** + 右上主题/帮助；主题切换即时生效 | 仅「最近使用」条数依真实数据（数据驱动）→ §9-4 已解决 |
| `focus.png` | `09-focus-mode-1440x900.png` | **PASS**：无侧栏、顶栏 ←+文档标题+「● 已保存」（绿点已补齐 `fbc2461`）+主题、**底栏仅格式组（动作组 display:none）**、命令条沉底 720@距底16、纸面去边框阴影、Esc 退出 | 仅剩基线为深色截图（P3 说明） |
| `library.png` | `10-library-page-1440x900.png` | **PASS**：完整知识库页（标题/统计/导入+新建/继续写作/最近编辑/标签/文件夹） | 数据量差异属测试工作区数据；**§9-9 已解决** |
| `overlays.png`（补充） | `03`/`15`/`17`/`18`（`17–19` 见 `evidence/probe-round3/`） | **PASS**：文档信息大纲优先 + 折叠至一级、⌘K 三组、⋯ 十条目、历史 420 右侧 sheet | 细节差异：⋯ 同时有「大纲与信息」「文档信息」两相近入口 → §9-13 |

## 9. 已知差异 / 观察项（最终集成验收时确认）

1. ~~**侧栏信息架构与设计基线不一致**~~ **已于保真第二轮解决并复验**：侧栏现为 5 导航（知识库/搜索/模块/资料/回收站）+ footer 三段（设置/专注模式/切换外观，图标随主题 moon/sun）+ 「文件」label + 新建按钮；搜索框移入「搜索」视图；「最近更新/标签」保留为紧凑入口。见 `VERIFICATION-REPORT.md` §10。
2. ~~**文档信息浮层结构顺序**~~ **已于全面对齐轮解决并复验**：浮层标题为「文档信息」，内容顺序 大纲（含折叠至一级）→ 属性 → 标签/历史，sheet 380×880 @右侧10；入口在命令条「⋯ 更多」菜单。见 `VERIFICATION-REPORT.md` §11.2-4。
3. ~~**设置页形态**~~ **已于全面对齐轮解决**：设置改为**独立页**（← 知识库 + 标题 40px + 分组卡片），与基线 `settings.png` 的形态对齐；保留顶部分组 tab（基线为单列分组标题）→ 见 §9-11。
4. ~~**启动器与基线差距**~~ **已基本解决**：全面对齐轮补上常驻路径输入（浏览…/打开）与右上主题/信息图标；品牌标 84px、标题 46px、内容列 720 均与基线一致。剩余仅「最近使用条数依真实数据」（数据驱动，非缺陷）。见 `VERIFICATION-REPORT.md` §11.3。
5. ~~**阅读列 678 vs 680（-2px）**~~ **已修复并复验**：Lead 把 `.focus-paper` padding 的 clamp 上限 90→89px，1440 档复验实测 **680.0**（修复前 678）。800 档实测仍 678（clamp 百分比基数为滚动容器宽而非纸面内容宽，-2px 视觉不可辨，不再追）。
6. **设置页「切换工作区」按钮文字可能被截断**（截图中显示「切换...」）：建议设置专项目检确认按钮宽度/文案。
7. ~~**壳层自定义过渡未适配 `prefers-reduced-motion`**~~ **已修复并复验**：Lead 补充了 `@media (prefers-reduced-motion: reduce)`（`.focus-body-row / .focus-sidebar-collapse / .focus-sidebar-reopen / 命令条 / inspector-sheet` 过渡置 none）；实测 reduce 下 `.focus-body-row transitionDuration 0.22s → 0s`。

8. ~~**专注模式与基线 `focus.png` 的细节差异**~~ **已于收尾轮解决并复验**：顶栏补「已保存」+主题；底栏动作组（搜索/⋯/保存/导出）`display:none`，只剩格式组（对齐基线极简底栏）；纸面去边框阴影、命令条 720@距底16 不变。仅剩「绿点」细节 → §9-14。
9. ~~**二级页面「整页」形态未实现**~~ **已于全面对齐轮解决并复验**：知识库/搜索/模块/资料/回收站均为主画布整页（`.focus-page-layer[data-page]`、标题 40px、激活时隐藏命令条），截图 `10–14`；旧侧栏内视图已移除（导航只 `onNavigate`）。见 `VERIFICATION-REPORT.md` §11.2-1。

10. ~~**专注模式默认不显示保存态**~~ **已于收尾轮解决**：idle 恒显「已保存」（dirty/saving/saved/error 四态均实现）。仅绿点显示细节见 §9-14。
11. **设置独立页保留顶部分组 tab（P3）**：基线 `settings.png` 为单列「分组标题 + 卡片」；当前为「顶部分组 tab + 卡片」。形态已对齐独立页，tab 行是否保留待设计定稿。见 `VERIFICATION-REPORT.md` §11.4-5。
12. **模块页筛选维度/引用数（P3）**：原型 `modules.html` 的 chips 为模块**类型**（定义/公式/定理/模板）且卡片显示「被 N 篇引用」；当前为**标签** chips、卡片显示 v1/大小/路径（未展示引用数）。~~搜索页空态不显示类型 chips~~ **收尾轮已解决**：空态常显 全部/文档/模块/附件，有结果时显示计数。见 `VERIFICATION-REPORT.md` §12.4-3。
13. ~~**⋯ 菜单两条相近入口**~~ **已于收尾轮解决**：入口二文案改为「**文档属性**」（App inspectorButton），两个入口分派不同事件：「大纲与信息」→ `ke:outline-open`（展开大纲）、「文档属性」→ `ke:attributes-open`（滚动到属性卡）；短文档下运行时表现相近属预期（§12.4-2）。见 `VERIFICATION-REPORT.md` §12.2-3。
14. ~~**专注模式「已保存」绿点（P3，收尾轮新观察）**~~ **已修复**（`fbc2461`）：idle 态顶栏显示「● 已保存」（`showFocusSavedDot` 兼容 `idle`），与基线 `focus.png` 一致。见 `VERIFICATION-REPORT.md` §12.4-1。
15. **短文档下 ⋯ 双入口表现相近（P3/预期）**：两入口打开同一信息浮层，短文档内容一屏内、scrollTop 均 0，视觉差异不显著；差异体现在事件分派与长文档滚动路径。见 `VERIFICATION-REPORT.md` §12.4-2。


### 11. 证据隔离说明（全面对齐轮）
独立验收期间主工作树出现 Lead 下一轮并行改动，为保证证据 = 已提交快照，最终截图/断言来自 `git archive HEAD`（`6c53695`）独立副本 + 独立 vite（`:5285`）；共享测试工作区数据在此期间被扩充（1→21 文档），已在数据稳定后重跑取证。详见 `VERIFICATION-REPORT.md` §11 开头说明。

## 10. 运行记录

| 轮次 | 时间 | HEAD | 结果 | 备注 |
|---|---|---|---|---|
| 首轮（task-4） | 2026-10-20 13:4x | `c7fc11b`（WIP 壳层，dev 尚未收口） | 8 张截图，119/119 断言 PASS | 用于校验 harness 本身；当时设置/浮层/节点视觉仍在重排，截图仅作流水线自检 |
| 最终（task-5） | 2026-10-20 13:47 | `5ed8fa2`（1–3 任务已集成，工作树干净） | 8 张截图，119/119 断言 PASS | 证据：`/tmp/focus-shots/summary.md`、`metrics.json`、`run-meta.json` |
| 保真第二轮（task-8） | 2026-10-20 15:22 | `ffe3ffe`（工作树干净） | 9 张截图（含 09 专注模式），**135/135 断言 PASS（KE_STRICT=1）** | 证据：`docs/focus-ui/evidence/`、`screenshots/`；详见 `VERIFICATION-REPORT.md` §10 |
| 全面对齐轮（task-15） | 2026-10-20 16:04 | `6c53695`（独立 HEAD 副本；主工作树并行编辑已隔离） | **16 张截图，168/168 断言 PASS（KE_STRICT=1，0 DIFF）** | 证据：`docs/focus-ui/evidence/`、`screenshots/`、`evidence/probe-round3/`；详见 `VERIFICATION-REPORT.md` §11 |
| 收尾对齐轮（增量复验） | 2026-10-20 17:0x | `472d861`（工作树干净，dirty=0） | **16 张截图，178/178 断言 PASS（KE_STRICT=1，0 DIFF）** | 证据：`docs/focus-ui/evidence/`、`screenshots/`、`evidence/probe-round4/`；详见 `VERIFICATION-REPORT.md` §12 |

> 注：`verify-ui.cjs` 默认自行拉起**全新 vite 进程**截图（见 §0 环境注意）；`05-launcher` 通过拦截
> `GET /api/workspace/current` 返回 `{open:false}` 到达启动器页，其余页面均为真实后端数据（测试工作区 `/tmp/focus-ws`）。
