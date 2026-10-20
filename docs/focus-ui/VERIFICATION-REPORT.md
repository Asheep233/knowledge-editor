# AstraNota Focus · 集成验收报告（VERIFICATION-REPORT）

- 任务：task-5（Focus 集成验收：typecheck + 全量测试 + build + 视觉对照）
- 执行者：qa-visual（QA teammate，只读产品代码）
- 时间：2026-10-20 13:47–13:55（CST）
- 分支 / HEAD：`focus-ui` @ `5ed8fa2`（工作树干净：`git status --porcelain` 为空；验收过程中未修改 `frontend/src`，未 git commit/push/checkout）
- 被验对象：task-1/2/3（设置面板 / 编辑器浮层 / NodeView）集成后的最终快照 `5ed8fa2`
- 验收基线：`/mnt/f/Work/KE Project/AstraNota-Focus-Handoff/`（`HANDOFF.md`、`design-tokens.css/json`、`screenshots/`、`MIGRATION-CHECKLIST.md`「禁止回退项」）
- 验收清单：`docs/focus-ui/VISUAL-ACCEPTANCE.md`（112 项检查项 + 判定方式）；
  自动截图/断言：`docs/focus-ui/verify-ui.cjs` → 证据在 `/tmp/focus-shots/`

## 结论总览

| # | 验收项 | 结论 | 证据 |
|---|---|---|---|
| 1 | `npx tsc -b --noEmit` | **PASS**（0 错误，无输出） | 命令实测，`TSC_EXIT=0` |
| 2 | 全量 vitest（143 文件 / 1982 用例） | **PASS**：143/143 文件通过，1981 passed / 1 skipped，EXIT=0 | `/tmp/focus-final-vitest.log`（Lead 于 13:46:27 起跑，453.89s；本报告解析其完成结果，未另起重跑以避免双份负载） |
| 3 | `npm run build`（tsc + vite build → dist-build） | **PASS**：exit 0，`✓ built in 5.45s`，dist-build 3.0 MB | `/tmp/focus-final-build.log` |
| 4 | 视觉验收脚本 `verify-ui.cjs`（8 张截图 + 119 项断言） | **PASS**：8/8 截图产出，119/119 断言 PASS，EXIT=0 | `/tmp/focus-shots/summary.md`、`metrics.json`、`run-meta.json`、`/tmp/focus-final-verify-ui.log` |
| 5 | 「禁止回退项」逐条判定 | **PASS**（10/10） | `metrics.json` 断言 + 人工对照截图 |
| 6 | 可访问性：焦点环 / reduced-motion | **PASS**（焦点环实测通过；reduced-motion 组件层通过，壳层自定义过渡有 1 个观察项） | `/tmp/focus-shots/a11y-probe.json`、`evidence-focus-ring-1440x900.png` |
| 7 | 视觉对照设计基线 | **PASS（布局/令牌/字号/深色/响应式）**；存在 4 项**非阻断性差异**（见 §4，均为视觉/IA 层面，需 Lead 决策是否修） | 本文 §4 + `VISUAL-ACCEPTANCE.md` §8/§9 |

**总判定：集成验收 PASS，无阻塞问题（无 typecheck 错、无测试失败、无构建失败、无布局回退）。**
遗留差异均为「与设计基线截图的视觉/信息架构差距」和低风险可访问性细节，不影响功能与提交。

---

## 1. TypeScript 类型检查

```
cd frontend && npx tsc -b --noEmit
→ 无任何输出，退出码 0
```

- 结论：**PASS（0 error）**
- 说明：`tsc -b` 使用项目引用方式检查；`npm run build` 内也会再跑一次 `tsc -b`（见 §3），两者一致通过。

## 2. 全量测试（vitest）

Lead 已在最终快照（`5ed8fa2`，工作树干净）上执行全量测试，本报告解析其日志：

```
cd frontend && npx vitest run --maxWorkers=2 > /tmp/focus-final-vitest.log
Start at  13:46:27
Test Files  143 passed (143)
     Tests  1981 passed | 1 skipped (1982)
  Duration  453.89s (transform 11.82s, setup 48.22s, import 50.35s, tests 45.64s, environment 616.97s)
EXIT=0
```

- 结论：**PASS**（143/143 文件；1981 passed / 1 skipped / 0 failed）
- 失败清单：**空**。因此「布局断言需更新 / 真实行为回归 / 环境 flaky」三类分类本次均无触发项。
- 备注：Lead 指令为避免双份负载，我未并行重跑全量；`tsc`、`build`、视觉脚本由我独立执行（三者均通过）。
- 日志中 stderr 噪声（不影响结果）：
  - `KaTeX doesn't work in quirks mode`（happy-dom 测试环境固有提示，历史存在）；
  - `You are calling ReactDOMClient.createRoot() on a container that has already been passed to createRoot()`（个别测试渲染方式提示，测试仍全绿）。

## 3. 生产构建

```
cd frontend && npm run build        # = tsc -b && node scripts/ke-vite.mjs build
BUILD_EXIT=0
✓ built in 5.45s
dist-build/index.html 存在；产物 3.0 MB
主要 chunk：index 422.07 kB（gzip 128.75）、editor 477.77 kB（gzip 143.13）、math 261.46 kB（gzip 77.81）、react 223.26 kB、vendor 115.55 kB、index.css 76.35 kB
```

- 结论：**PASS**。`dist-build/` 为构建输出（非源码，未纳入提交；工作树 `git status` 仅新增本报告/验收清单两个 `docs/focus-ui/` 文件）。
- 无 chunk 体积警告阻断、无 tsc 错误。

## 4. 视觉验收（verify-ui.cjs）

### 4.1 运行结果

```
node docs/focus-ui/verify-ui.cjs
HEAD 5ed8fa2（dirty 0）
后端 http://127.0.0.1:8000 复用（已就绪）
前端：脚本自起全新 vite http://127.0.0.1:5274（见 §7 环境说明）
截图 8 张 → /tmp/focus-shots/
断言 119/119 PASS，0 DIFF
退出码 0
```

| 截图文件 | 视口 | 覆盖点 |
|---|---|---|
| `01-editor-light-1440x900.png` | 1440×900 | 浅色编辑器、侧栏展开、居中纸面、浮动命令条 |
| `02-editor-collapsed-sidebar-1440x900.png` | 1440×900 | 侧栏收起 + `»` 浮块、纸面中心不动 |
| `03-editor-inspector-sheet-1440x900.png` | 1440×900 | 文档信息右侧浮层（380px sheet） |
| `04-editor-dark-1440x900.png` | 1440×900 | 深色令牌与深色布局 |
| `05-launcher-1440x900.png` | 1440×900 | 启动器页（拦截 workspace/current 为未打开） |
| `06-settings-1440x900.png` | 1440×900 | 设置页（居中卡片浮层、分组 tab） |
| `07-editor-drawer-1024x800.png` | 1024×800 | 窄屏抽屉（256 浮层 + 遮罩，不挤压纸面） |
| `08-editor-narrow-800x900.png` | 800×900 | 800 档（纸面 min(860,100%)、命令条 100%-20px） |

### 4.2 关键实测值（metrics.json 摘录）

| 项 | 期望（HANDOFF） | 实测 | 判定 |
|---|---|---|---|
| 纸面宽 / 圆角 / 边框 | 860 / 18 / 1px | 860 / 18px / 1px | PASS |
| 纸面居中 | 中心 = 窗口中心 | 1440→720；1024→512；800→400 | PASS |
| 纸面左边缘（侧栏展开） | 280+10 = 290 | 290 | PASS |
| 阅读列宽 | 680 | **678**（-2px，见 §4.4） | PASS（±3 容差） |
| 正文 | 17px / 行高 1.8 | 17px / 30.6px | PASS |
| 标题 | 42px / 1.1 / -0.045em / 650 | 42px / 46.2px / -1.9px / 650 | PASS |
| 命令条 | 高 46 / top 12 / 圆角 13 / 与纸面同宽 | 46 / 12 / 13px / 860（x 对齐 290） | PASS |
| 侧栏 | 256 / left 10 / top 10 / bottom 10 / 圆角 18 | 全部一致（1440、1024 抽屉同） | PASS |
| 侧栏收起浮块 | 34×38 @(10,10) | 34×38 @(10,10) | PASS |
| 侧栏开合纸面中心 | 不动 | 720 → 720（抽屉 512 → 512） | PASS |
| 浅色令牌 | bg #f5f5f7 / card #fff / text #1d1d1f / accent #0071e3 … | 全部一致（8/8） | PASS |
| 深色令牌 | bg #000 / card #0e0e10 / line #232325 / accent #0a84ff … | 全部一致（8/8）+ 计算样式 | PASS |
| 圆角令牌 | panel 18 / bar 13 / control 8 / menu 12 / dialog 24 | 一致 | PASS |
| 字体栈 | Inter / Inter Tight / IBM Plex Mono（本地加载） | 令牌一致；`@font-face` 本地 woff2，无 CDN | PASS |
| 文件名不省略 | 无 ellipsis | `text-overflow: clip`，DOM 含完整文件名 | PASS |
| 无顶栏/标签栏/常驻右栏 | 全部不可见 | 侧栏 top=10、tab-strip display:none、inspector 默认不渲染 | PASS |

### 4.3 「禁止回退项」逐条（对照 `MIGRATION-CHECKLIST.md` / `HANDOFF.md` §10）

| 禁止回退项 | 判定 | 证据 |
|---|---|---|
| 恢复全宽顶栏 | **PASS** | 侧栏 y=10、命令条 y=12，页面从窗口顶部开始（`metrics.json`） |
| 恢复常驻标签栏 | **PASS** | `[data-testid=tab-strip] display:none` |
| 恢复常驻右侧信息栏 | **PASS** | inspector 默认不渲染；开合不改变纸面中心 |
| 纸面改通栏/贴边 | **PASS** | 纸面 860 + 左右 280 留白 + 圆角 18（1440）/ 居中（1024、800） |
| 侧栏开合移动纸面中心 | **PASS** | 720→720（±1px）；抽屉 512→512 |
| 文件名省略号截断 | **PASS** | `text-overflow: clip` + 完整文件名在 DOM + `overflow-x` 可滚动 |
| 再引入小字/渐变/发光装饰 | **PASS** | 视觉目检无渐变/发光；界面字号 12.5–13px |
| 正文阴影/纸张纹理 | **PASS** | 纸面仅 `--shadow-sm`；正文无阴影/纹理 |
| 多强调色/装饰性统计卡 | **PASS** | 视觉目检：单一蓝色强调色，无装饰卡 |
| 深色简单反色 | **PASS** | 深色独立令牌（#000/#0e0e10/#232325/#0a84ff）+ 独立深色阴影 |

### 4.4 视觉对照设计基线（人工）

| 基线截图 | 结论 | 差异摘要 |
|---|---|---|
| `editor.png` | **PASS（布局/令牌/字号/纸面/命令条一致）** | 侧栏信息架构不同（§5-1）；命令条保留更多旧能力图标（功能保留，可接受） |
| `editor-dark.png` | **PASS** | 同 §5-1 |
| `overlays.png`（文档信息部分） | **差异** | 基线「文档信息」= 大纲优先 + 折叠至一级；当前「文档属性」= 属性在前、大纲在下（折叠至一级存在）→ §5-2 |
| `settings.png` | **差异（按 Lead 指令形态）** | 基线为独立设置页；当前为居中卡片浮层 + 分组 tab（符合 task-1 指令「全屏覆盖层 → 居中卡片式设置浮层」）→ §5-3 |
| `launcher.png` | **差异（非阻断）** | hero 品牌标 → 蓝色方块 "A"；路径输入不常驻；最近使用按真实数据（本次 1 条）→ §5-4 |
| `library.png` / `focus.png` | 未覆盖 | 不在本轮截图清单；建议专项验收（知识库页 / 专注模式） |

## 5. 需要 Lead 决策/修复的问题清单（只记录，未改产品代码）

> 优先级：P2 = 视觉/信息架构与设计基线不一致（不阻断提交）；P3 = 低风险细节。均无功能性问题。

| # | 优先级 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| 1 | **P2** | **侧栏信息架构与设计基线不一致**：基线导航为 `知识库 / 搜索 / 模块 / 资料 / 回收站` + 底部 `设置 / 专注模式 / 切换外观`；当前为 `全部文档 / 最近更新 / 标签 / 回收站` + `模块 / 文章 / 附件` 分组 + 底部仅「设置」 | `01/04` 截图 vs `screenshots/editor.png`、`overlays.png` | Lead 决定：补一档左侧栏 IA 重排（或确认以现结构为准并更新设计基线）。涉及「知识库/搜索/资料页入口」「专注模式/切换外观入口」的可见性 |
| 2 | P3 | 文档信息浮层信息优先级不同：基线标题「文档信息」且大纲优先；当前标题「文档属性」且属性优先 | `03` 截图 vs `overlays.png` 02 区 | 若设计定稿要求大纲优先，调整 RightPanel 分区顺序与标题 |
| 3 | P3 | 设置页形态与基线截图不同（居中卡片浮层 vs 独立页）；「切换工作区」按钮文字疑似被截断为「切换...」 | `06` 截图 | 按 Lead task-1 指令本形态属预期；截断问题建议设置专项目检 |
| 4 | P3 | 启动器视觉细节：品牌标被蓝色方块 "A" 替代；路径输入/浏览按钮不常驻；「最近使用」条目数取决于真实数据 | `05` 截图 vs `launcher.png` | 若要求与基线像素级一致，需补品牌资产与常驻路径行 |
| 5 | P3 | 阅读列实测 678px（基线 680px，-2px）：`.focus-paper` padding 的 `clamp(..., 90px)` 上限在 1440 档命中 | `metrics.json`「阅读列宽 680」actual=678 | 视觉不可辨；若要求像素级一致，把 clamp 上限提到 ≥91px 即可 |
| 6 | P3 | 壳层自定义过渡（`index.css`：侧栏 padding 220ms、收起/展开 140ms）未加 `@media (prefers-reduced-motion: reduce)` 覆盖（组件层 Tailwind `motion-reduce:` 已正确生效） | `a11y-probe.json`：reduce 下组件 `transition-property:none`；`index.css` 无该媒体查询 | 低风险，建议补一条壳层过渡的 reduced-motion 降级 |
| 7 | P3 | ≤760 断点未截图覆盖（800 档属于 760–1280 区间）：纸面全宽去边框圆角行为未取证 | `VISUAL-ACCEPTANCE.md` §5 | 建议后续加 700×900 一张（脚本扩展一小段即可） |
| 8 | 环境 | 已在跑的 vite dev server `127.0.0.1:5273` **服务陈旧模块**（WSL drvfs watcher 漏事件）：`curl /src/App.tsx` 缺新标识符，`?t=` 才重新 transform | 本次实测（见 `VISUAL-ACCEPTANCE.md` §0） | 用 5273 做视觉自查前先重启该 server，或直接用 `verify-ui.cjs`（默认自起全新实例） |

## 6. 可访问性证据（HANDOFF §9）

- **焦点环（PASS）**：Playwright 键盘 Tab 实测 3 个按钮，计算样式均为 `outline: 2px solid rgb(0,113,227)`（`--ring`/accent）、`outline-offset: 2px`：
  证据 `/tmp/focus-shots/a11y-probe.json` + `evidence-focus-ring-1440x900.png`。
- **reduced-motion（PASS / 观察项）**：`reducedMotion=reduce` 语境下带 `motion-reduce:` 类的组件 `transition-property: none`（过渡被禁用）；壳层自定义过渡无媒体查询覆盖（§5-6）。
- **aria-label**：关键图标按钮均以 `aria-label`/`title` 命中（脚本选择器依赖：收起/展开侧栏、文件与导航、文档信息、保存、导出、打开设置、关闭浮层），未见无标签图标按钮（抽检截图）。
- **KaTeX/字体本地加载**：`@font-face` 指向 `./assets/fonts/*.woff2`，`index.html`/`index.css` 无 CDN 字体链接（静态检查）。

## 7. 环境说明与复跑

- **HEAD / 工作树**：`focus-ui` @ `5ed8fa2`，验收期间 `git status --porcelain` 为空（唯一变化：本报告与 `VISUAL-ACCEPTANCE.md` 为 docs-only 新增，未跟踪）。
- **运行时**：后端复用 `http://127.0.0.1:8000`（工作区 `/tmp/focus-ws`，1 篇文章）；前端由验收脚本自起**全新 vite 进程** `http://127.0.0.1:5274`（原因：5273 上的既有 dev server 在 WSL drvfs 下会服务陈旧模块；脚本自起实例跑完即关闭，不影响他人进程）。
- **复跑（从仓库根）**：

```bash
# 类型检查 / 构建
cd frontend && npx tsc -b --noEmit && npm run build

# 全量测试（机器负载高，建议一次只跑一份）
cd frontend && npx vitest run --maxWorkers=2

# 视觉验收（自动确保后端/vite；8 张截图 + 119 断言；KE_STRICT=1 可让 DIFF 判红）
cd ..
node docs/focus-ui/verify-ui.cjs
KE_STRICT=1 node docs/focus-ui/verify-ui.cjs
```

- **失败分类口径**（本次全部无触发）：① 布局断言需更新（视觉重排导致旧断言过期）→ 只更新断言不删行为测试；② 真实行为回归 → 记录文件/用例/复现步骤，Lead 修；③ 环境 flaky（load/timeout/端口）→ 重跑确认并标注环境因素。

## 8. 证据索引

| 证据 | 路径 |
|---|---|
| 全量测试日志 | `/tmp/focus-final-vitest.log` |
| 构建日志 | `/tmp/focus-final-build.log` |
| 视觉脚本运行日志 | `/tmp/focus-final-verify-ui.log` |
| 截图（8 张） | `/tmp/focus-shots/01…08-*.png` |
| 布局/令牌断言明细（119 项） | `/tmp/focus-shots/metrics.json` |
| 运行环境（URL/端口/git/控制台/请求失败） | `/tmp/focus-shots/run-meta.json` |
| 运行摘要（人读） | `/tmp/focus-shots/summary.md` |
| 焦点环/reduced-motion 探针 | `/tmp/focus-shots/a11y-probe.json`、`/tmp/focus-shots/evidence-focus-ring-1440x900.png` |
| 验收清单（112 检查项） | `docs/focus-ui/VISUAL-ACCEPTANCE.md` |
| 截图脚本 | `docs/focus-ui/verify-ui.cjs` |

### 附：日志中的非失败噪声（供参考，不影响判定）

- `flushSync was called from inside a lifecycle method…`（React 开发态 warning，编辑器打开时高频出现，历史既有；非 error 级异常，未产生 pageerror）；
- `403 /api/workspace/recent-documents`（6 次，环境/后端该接口在浏览器调试态的既有行为；不影响页面功能与截图）；
- 1 次首轮 `404` 控制台提示（仅预热页面出现，后续页面未复现，疑为 favicon/临时资源，无页面错误）。

**最终结论：Focus 集成快照 `5ed8fa2` 通过集成验收（typecheck / 全量测试 / 构建 / 视觉验收 119/119 / 禁止回退项 10/10 / 焦点环实测）。**
无阻塞问题；§5 列出的 4 项 P2/P3 视觉与 IA 差异需 Lead 决策是否在本轮修，其余为低风险细节与后续专项建议。
