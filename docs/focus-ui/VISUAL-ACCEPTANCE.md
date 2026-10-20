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
| `06-settings-1440x900.png` | 设置页（居中卡片浮层） |
| `07-editor-drawer-1024x800.png` | 1024 窄屏抽屉（遮罩 + 256px 浮层） |
| `08-editor-narrow-800x900.png` | 800 窄屏（纸面 = min(860,100%)，命令条 100%-20px） |
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
| `settings.png` | `06-settings-1440x900.png` | 设置内容分组（通用/外观/快捷键/维护）一致 | 形态差异：基线为独立页面；当前为**居中卡片浮层 + 分组 tab**（符合 Lead 指令形态）→ 见 §9-3 |
| `launcher.png` | `05-launcher-1440x900.png` | **保真第二轮后：官方品牌标 84px + 46px 标题 + 720 内容列、两操作卡/最近使用结构与基线对齐** | 剩余差异：无常驻路径输入+浏览、最近使用条数依真实数据、右上无主题/信息图标；基线的装饰性声明小字已按本轮方向移除 → 见 §9-4 |
| `focus.png` | `09-focus-mode-1440x900.png`（保真第二轮新增） | **专注模式已实现**：无侧栏、命令条沉底居中 720@距底16、纸面去边框/圆角/阴影、Esc 退出；布局断言全 PASS | 与基线细节差异：底部工具条仍含 搜索/⋯/保存/导出（基线为极简格式条）；顶部为「← 退出专注」胶囊（基线为 ← + 文档标题面包屑 + 右上已保存状态）；基线为深色截图 → 见 §9-8 |
| `library.png` | **无整页截图（DIFF）** | **`ffe3ffe` 未实现整页知识库**：5 导航仅切换侧栏视图、主画布仍为编辑器；距基线整页知识库（标题/统计/继续写作/最近编辑）有差距 | 验收时 Lead 已在未提交改动中实施整页路由（`components/focus/*`），待下轮提交后补 `10-library` 等截图对照 → 见 §9-9 |

## 9. 已知差异 / 观察项（最终集成验收时确认）

1. ~~**侧栏信息架构与设计基线不一致**~~ **已于保真第二轮解决并复验**：侧栏现为 5 导航（知识库/搜索/模块/资料/回收站）+ footer 三段（设置/专注模式/切换外观，图标随主题 moon/sun）+ 「文件」label + 新建按钮；搜索框移入「搜索」视图；「最近更新/标签」保留为紧凑入口。见 `VERIFICATION-REPORT.md` §10。
2. **文档信息浮层结构顺序**：基线以「大纲」为主体（含「折叠至一级」），属性/标签/历史随后；当前以「文档属性」为主体、属性在前、大纲在后。功能都在，视觉/信息优先级与设计基线不同。
3. **设置页形态**：当前为居中卡片浮层（含顶部返回、分组 tab、内部滚动），基线为独立设置页；按 Lead task-1 指令属预期，待产品定稿。
4. **启动器（部分解决）**：保真第二轮已换官方品牌图标（84px）+ 46px 标题 + 720 内容列，并移除装饰性小字；剩余差异为「无常驻路径输入+浏览」「最近使用条数依真实数据」「右上无主题/信息图标」。见 `VERIFICATION-REPORT.md` §10.4-5。
5. ~~**阅读列 678 vs 680（-2px）**~~ **已修复并复验**：Lead 把 `.focus-paper` padding 的 clamp 上限 90→89px，1440 档复验实测 **680.0**（修复前 678）。800 档实测仍 678（clamp 百分比基数为滚动容器宽而非纸面内容宽，-2px 视觉不可辨，不再追）。
6. **设置页「切换工作区」按钮文字可能被截断**（截图中显示「切换...」）：建议设置专项目检确认按钮宽度/文案。
7. ~~**壳层自定义过渡未适配 `prefers-reduced-motion`**~~ **已修复并复验**：Lead 补充了 `@media (prefers-reduced-motion: reduce)`（`.focus-body-row / .focus-sidebar-collapse / .focus-sidebar-reopen / 命令条 / inspector-sheet` 过渡置 none）；实测 reduce 下 `.focus-body-row transitionDuration 0.22s → 0s`。

8. **专注模式与基线 `focus.png` 的细节差异（P3，保真第二轮新增功能）**：功能已实现且断言全 PASS（无侧栏、命令条沉底居中 720@距底16、纸面去边框阴影、Esc/退出按钮返回）；但与基线相比：底部工具条仍是**完整命令条**（含 搜索/⋯/保存/导出），基线为**极简格式条**；顶部为「← 退出专注」胶囊 + 无「已保存/锁」状态，基线为 ← + 文档标题面包屑 + 右上已保存状态；基线截图是深色（本次验证浅色）。见 `VERIFICATION-REPORT.md` §10.4-2/3/4。
9. **二级页面「整页」形态未在 `ffe3ffe` 实现（P2，待下轮）**：知识库/搜索/模块/资料/回收站导航在 `ffe3ffe` 只切换**侧栏视图**，主画布仍是编辑器；基线 `library.png` 为整页知识库（标题/统计/导入/新建/继续写作/最近编辑）。验收时 Lead 已有未提交的 `components/focus/*` + App/LeftSidebar 路由改动，预期下一轮提交后补齐；届时补 `10-library-1440x900` 等整页截图对照 `library/search/modules/assets/trash` 基线。

## 10. 运行记录

| 轮次 | 时间 | HEAD | 结果 | 备注 |
|---|---|---|---|---|
| 首轮（task-4） | 2026-10-20 13:4x | `c7fc11b`（WIP 壳层，dev 尚未收口） | 8 张截图，119/119 断言 PASS | 用于校验 harness 本身；当时设置/浮层/节点视觉仍在重排，截图仅作流水线自检 |
| 最终（task-5） | 2026-10-20 13:47 | `5ed8fa2`（1–3 任务已集成，工作树干净） | 8 张截图，119/119 断言 PASS | 证据：`/tmp/focus-shots/summary.md`、`metrics.json`、`run-meta.json` |
| 保真第二轮（task-8） | 2026-10-20 15:22 | `ffe3ffe`（工作树干净） | 9 张截图（含 09 专注模式），**135/135 断言 PASS（KE_STRICT=1）** | 证据：`docs/focus-ui/evidence/`、`screenshots/`；详见 `VERIFICATION-REPORT.md` §10 |

> 注：`verify-ui.cjs` 默认自行拉起**全新 vite 进程**截图（见 §0 环境注意）；`05-launcher` 通过拦截
> `GET /api/workspace/current` 返回 `{open:false}` 到达启动器页，其余页面均为真实后端数据（测试工作区 `/tmp/focus-ws`）。
