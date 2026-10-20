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
| `06-more-menu-1440x900.png` | 1440×900 | ⋯ 更多菜单（十条目；设置页独立截图见 `16-settings-page`，收尾轮已去重） |
| `07-editor-drawer-1024x800.png` | 1024×800 | 窄屏抽屉（256 浮层 + 遮罩，不挤压纸面） |
| `08-editor-narrow-800x900.png` | 800×900 | 800 档（纸面 min(860,100%)、命令条 100%-20px） |

### 4.2 关键实测值（metrics.json 摘录）

| 项 | 期望（HANDOFF） | 实测 | 判定 |
|---|---|---|---|
| 纸面宽 / 圆角 / 边框 | 860 / 18 / 1px | 860 / 18px / 1px | PASS |
| 纸面居中 | 中心 = 窗口中心 | 1440→720；1024→512；800→400 | PASS |
| 纸面左边缘（侧栏展开） | 280+10 = 290 | 290 | PASS |
| 阅读列宽 | 680 | **678**（验收快照时；Lead 随后把 padding clamp 上限 90→89px，复验 1440 档 = **680**，见 §9） | PASS |
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
| 5 | P3 | 阅读列实测 678px（基线 680px，-2px）：`.focus-paper` padding 的 `clamp(..., 90px)` 上限在 1440 档命中 | `metrics.json`「阅读列宽 680」actual=678 | **已由 Lead 修复（clamp 90→89px）并复验 PASS：1440 档 = 680**；800 档仍 678（padding 百分比基数是滚动容器宽，非纸面内容宽），视觉不可辨 |
| 6 | P3 | 壳层自定义过渡（`index.css`：侧栏 padding 220ms、收起/展开 140ms）未加 `@media (prefers-reduced-motion: reduce)` 覆盖（组件层 Tailwind `motion-reduce:` 已正确生效） | `a11y-probe.json`：reduce 下组件 `transition-property:none`；`index.css` 无该媒体查询 | **已由 Lead 补媒体查询并复验 PASS：reduce 下 `.focus-body-row` transitionDuration 0.22s→0s**（§9） |
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

## 9. 复验：对 Lead 两处修复的抽查（验收后追加）

> 说明：本报告 §1–§8 对应快照 `5ed8fa2`（工作树干净）。验收完成后 Lead 在本地修了
> `frontend/src/index.css` 两处（对应本报告 §5-5 / §5-6），QA 随即做了一次只读复验：
> `node docs/focus-ui/verify-ui.cjs` + a11y 探针（脚本自起全新 vite，避免陈旧模块）。
> 复验时 git 状态：`HEAD 5ed8fa2` + 未提交修改（`M frontend/src/index.css`，非 QA 所改）。

| 修复项 | 修复内容 | 复验结果 | 证据 |
|---|---|---|---|
| 阅读列 680 | `.focus-paper` 左右 padding `clamp(..., 90px)` → `clamp(..., 89px)` | **PASS**：1440×900 阅读列实测 **680.0**（修复前 678）；119 项断言仍全 PASS。800 档仍 678（padding 百分比基数为滚动容器宽 800 → 60px/侧；属预期，-2px 视觉不可辨） | `/tmp/focus-shots/metrics.json`（actual=680）、`docs/focus-ui/evidence/metrics.json` |
| reduced-motion 壳层降级 | 新增 `@media (prefers-reduced-motion: reduce)`：`.focus-body-row / .focus-sidebar-collapse / .focus-sidebar-reopen / 命令条 / inspector-sheet` `transition: none !important` | **PASS**：`reducedMotion=reduce` 下 `.focus-body-row transitionDuration` **0.22s → 0s**；命令条同步 0s；焦点环仍 PASS（Tab → 2px solid accent, offset 2px） | `/tmp/focus-shots/a11y-probe.json`、`docs/focus-ui/evidence/a11y-probe.json` |

复验命令与结果：

```
node docs/focus-ui/verify-ui.cjs
→ HEAD 5ed8fa2 + dirty 6；截图 8 张；断言 119/119 PASS；EXIT=0
```

复验结论：**两处 P3 修复均生效，无回归**；`docs/focus-ui/evidence/`、`docs/focus-ui/screenshots/`
已同步为修复后的最新证据（覆盖修复前副本）。§5 剩余待决项为 1（侧栏 IA，P2，需产品决策）、
2/3/4（浮层/设置/启动器与基线差异，待设计定稿）、7（≤760 断点截图覆盖）、8（环境：5273 dev server 陈旧）。

### 附：日志中的非失败噪声（供参考，不影响判定）

- `flushSync was called from inside a lifecycle method…`（React 开发态 warning，编辑器打开时高频出现，历史既有；非 error 级异常，未产生 pageerror）；
- `403 /api/workspace/recent-documents`（6 次，环境/后端该接口在浏览器调试态的既有行为；不影响页面功能与截图）；
- 1 次首轮 `404` 控制台提示（仅预热页面出现，后续页面未复现，疑为 favicon/临时资源，无页面错误）。

**最终结论：Focus 集成快照 `5ed8fa2` 通过集成验收（typecheck / 全量测试 / 构建 / 视觉验收 119/119 / 禁止回退项 10/10 / 焦点环实测）。**
无阻塞问题；§5 列出的 4 项 P2/P3 视觉与 IA 差异需 Lead 决策是否在本轮修，其余为低风险细节与后续专项建议。

---

## 10. 保真第二轮独立验收（快照 `focus-ui` @ `ffe3ffe`）

> 触发：Lead 完成「保真第二轮」（侧栏 IA / 命令条收敛 / 专注模式 / 正文元信息与引用块 / 启动器品牌标）后提交 `ffe3ffe`，
> 要求 QA 独立验收。执行者 qa-visual（只读产品代码，只写 `docs/focus-ui/`；未 commit/push/checkout）。
>
> **快照说明（重要）**：本次验收运行于 `2026-10-20 15:22–15:24`，当时 `git status` 干净、`HEAD=ffe3ffe`（见 `evidence/run-meta.json` 的 `git` 字段）。
> 验收过程中观察到大工作树随后被 Lead 的**下一轮未提交改动**占用（`M App.tsx / EditorArea.tsx / LeftSidebar.tsx / AppShell.tsx` +
> 新增未跟踪 `frontend/src/components/focus/`，共 +138 行，用途是补「知识库/搜索/模块/资料/回收站」整页路由）。
> 本 §10 的结论**只针对已提交的 `ffe3ffe`**；该未提交改动不在本次判定范围内（见 §10.5-1）。

### 10.1 命令与结果

| 项 | 命令 | 结果 | 证据 |
|---|---|---|---|
| TypeScript | `cd frontend && npx tsc -b --noEmit` | **PASS**（0 错，无输出） | 本次实测 |
| 全量测试 | Lead 在 `ffe3ffe` 工作树执行：`npx vitest run --maxWorkers=2` | **PASS**：`Test Files 143 passed (143)`；`Tests 1988 passed \| 1 skipped (1989)`；`EXIT=0`；Start 15:14:43，Duration 409.26s | `/tmp/focus-final-vitest2.log`（解析完成结果；未并行重跑，遵守“不双份负载”） |
| 生产构建 | `cd frontend && npm run build` | **PASS**：`BUILD_EXIT=0`，`✓ built in 5.33s`，`dist-build` 3.0 MB | `/tmp/focus-final-build2.log` |
| 视觉验收 | `KE_STRICT=1 node docs/focus-ui/verify-ui.cjs` | **PASS**：9 张截图，**135/135 断言 PASS，0 DIFF**，`EXIT=0` | `/tmp/focus-qa-round2-verify.log`、`docs/focus-ui/evidence/{metrics.json,summary.md,run-meta.json}` |

> 全量测试相对上一轮（1981 passed）新增 7 个用例（1988 passed），对应专注模式/侧栏视图等新增逻辑，无失败、无 flaky。
> 视觉脚本本轮由 Lead 更新：文档信息入口改走「⋯ 更多」菜单、新增 `09-focus-mode` 截图与 8 项专注模式断言、侧栏导航/footer 文案断言，
> QA 独立复跑结果与 Lead 实测一致（135/135，0 DIFF）。

### 10.2 本轮改动逐项核验（对照 Lead 改动摘要）

| # | 改动点 | 核验方式 | 结论 |
|---|---|---|---|
| 1 | 侧栏 IA：5 导航（知识库/搜索/模块/资料/回收站）+ footer 三段（设置/专注模式/切换外观）+ footer 主题图标 | 干净快照 `01` 截图 + 脚本软断言 + `git show HEAD` 源码 | **PASS**：导航文案 5/5、footer 3/3 均命中（`metrics.json`）；footer「切换外观」图标随主题 moon/sun 切换（`LeftSidebar.tsx:1190-1199`）；搜索框已不在知识库默认视图 |
| 2 | 命令条：右侧仅 搜索 / ⋯更多 / 保存 / 导出；文档信息/源码模式/历史/微分 d 收进 ⋯ | `01` 截图 + `git show HEAD` 源码 | **PASS**：右侧动作组恰为 4 个（`搜索全部文档`/`更多`/`保存`/`导出`）；`EditorToolbar.tsx:804-845` 注释与实现一致，视图切换/历史/微分 d/文档信息均为菜单项 |
| 3 | 专注模式：侧栏隐藏、命令条沉底居中、纸面去边框/阴影、Esc 或「退出专注」返回 | 脚本 8 项断言 + `09` 截图 | **PASS**：`data-focus-mode=1`、侧栏 display:none、命令条 720×44 距底 16、纸面 border 0/shadow none、Esc 退出后 `data-focus-mode=null` |
| 4 | 正文：去面包屑与 KE 版本小字；元信息「今天 12:50 · 341 字 · 物理 / 习题」；引用块纯左竖线无底色；空态去小字 | 干净快照 `01` 截图目检 + `git show HEAD` 源码 | **PASS**：截图元信息为 `今天 12:50 · 341 字 · 物理 / 习题`（无 Articles 面包屑、无 KE v）；引用块 `background: transparent` + `border-left: 3px solid var(--line-2)`（`index.css:313-322`） |
| 5 | 启动器：官方品牌图标 84px + 46px 标题 + 720 列 | 脚本断言 05 + 截图 + `git show HEAD` 源码 | **PASS**：hero 品牌图 `size-[84px]`、标题 46px、内容列 720（断言 actual 46/720）；装饰性小字（顶部/底部声明、hero 副标题）已移除 |
| 6 | `verify-ui.cjs` 更新 + 09 专注模式截图 | 独立复跑 | **PASS**：脚本 9 张截图全产出，`KE_STRICT=1` 下 exit 0（135/135） |

### 10.3 对照设计基线截图（人工）

| 基线截图 | 对应本次截图 | 结论 | 说明 |
|---|---|---|---|
| `editor.png` | `01-editor-light-1440x900.png` | **PASS（重点项）** | 侧栏 5 导航 + footer 三段 + 主题图标对齐；命令条右侧四入口对齐；元信息格式对齐；引用块无底色对齐；纸面 860/阅读列 680/命令条 46 等既有断言全 PASS。仅剩数据驱动差异（文件树内容/最近列表条数） |
| `editor-dark.png` | `04-editor-dark-1440x900.png` | **PASS** | 深色令牌 8/8、纸面/侧栏 #0e0e10、标题 #f5f5f7、命令条与侧栏结构同浅色一致 |
| `focus.png` | `09-focus-mode-1440x900.png` | **PASS（布局）/ 有 3 处视觉差异** | 无侧栏、无顶栏、命令条沉底居中、纸面去边框阴影 ✓；差异见 §10.4-2/3/4 |
| `library.png` | 无对应整页截图（见 §10.4-1） | **DIFF（P2）** | `ffe3ffe` 未实现整页知识库：5 导航只切换**侧栏视图**，主画布仍是编辑器；距离基线 library.png（整页知识库：标题+统计+继续写作卡+最近编辑列表）仍有差距 |
| `launcher.png` | `05-launcher-1440x900.png` | **PASS（结构/品牌）** | 官方品牌标 84px、标题 46px、内容列 720、两操作卡+最近使用结构对齐；差异见 §10.4-5 |
| `settings.png` | `16-settings-page-1440x900.png` | 已对齐（收尾轮） | 设置独立页（← 知识库 / 40px 标题 / 分组卡），内容分组一致；顶部分段 tab 为可用性保留 |

### 10.4 本轮新增差异清单（只记录，未改产品代码）

| # | 优先级 | 差异 | 证据 | 建议 |
|---|---|---|---|---|
| 1 | **P2** | **知识库/搜索/模块/资料/回收站「整页」视图未在 `ffe3ffe` 实现**：导航点击只切换侧栏视图（`setView`），主画布始终是编辑器；`App.tsx` 在 `ffe3ffe` 无 page 路由/`focus-page-layer`/`LibraryPage`，`LeftSidebar` 也无 `onNavigate`/`activePage` 接线。基线 `library.png` 是完整知识库页（标题/统计/导入/新建/继续写作/最近编辑）。 | `git show HEAD:frontend/src/App.tsx \| grep -c "LibraryPage\|focus-page-layer"` → 0；`git show HEAD:...LeftSidebar.tsx:741` 仅 `setView(item.id)`；干净快照 `01` 截图即知识库默认视图（主画布仍是编辑器） | **已在进行中**：验收时工作树出现 Lead 未提交的 `components/focus/{LibraryPage,SearchPage,ModulesPage,AssetsPage,TrashPage,PageShell,CommandPalette}.tsx` + App/LeftSidebar 路由改动（不在本快照判定内）。建议下一轮提交后补 `10-library-1440x900` 等整页截图并对照 `library.png`/`search.png` |
| 2 | P3 | 专注模式底部工具条仍是**完整命令条**：含 搜索/⋯/保存/导出 与全部格式项；基线 `focus.png` 的底部是**极简格式条**（无保存/导出/搜索/⋯），且顶部为「← + 文档标题面包屑」，当前是左上「← 退出专注」胶囊。 | `09` 截图 vs `focus.png`；脚本 `09-focus` 断言通过（未约束此差异） | 若产品要求与基线像素级一致：专注模式隐藏动作组（或仅保留格式组）；顶栏改面包屑 + 右上保存状态。当前实现仍满足「隐藏侧栏/命令条沉底」的功能目标 |
| 3 | P3 | 专注模式无「已保存 / 锁」状态指示（基线右上角有绿色已保存圆点 + 锁图标） | `09` 截图 vs `focus.png` | 可后续在专注模式补保存状态浮标 |
| 4 | P3 | `focus.png` 基线为深色截图，本次 `09` 为浅色（专注模式与主题正交，功能已验证；深浅色截图的专注模式未单独取证） | `09` 截图 vs `focus.png` | 可选：脚本增加深色专注模式一张（低优先） |
| 5 | P3 | 启动器仍有基线差异：无**常驻**路径输入+浏览按钮（按交互展开）；「最近使用」条数依真实数据（本次 1 条，基线示意多条含失效态）；右上无主题/信息图标 | `05` 截图 vs `launcher.png` + `git show HEAD` 源码 | 期望与设计逐像素一致时再补；当前符合「去装饰小字」的本轮方向 |
| 6 | P3 | 侧栏知识库视图的「最近更新/标签」为紧凑文本入口（符合 Lead 本轮设计），基线 editor.png 中为文件树+计数；数据驱动差异（测试工作区仅 1 文档/1 模块），非回归 | `01` 截图 vs `editor.png` | 无需修；真实工作区数据下自然对齐 |
| 7 | P2（承上轮） | 上轮 §5-1 侧栏 IA 差异**已解决**（本轮 5 导航 + footer 三段对齐）；§5-2 文档信息浮层顺序、§5-3 设置形态、§5-4 启动器细节、§5-7 ≤760 截图取证仍维持原状态 | 见 §5 | 维持上轮建议 |
| 8 | 环境 | 已确认 WSL `/mnt/f` 下复用旧 vite dev server 会服务陈旧模块；本次脚本自起全新实例（端口 5273 空闲→自起，跑完关闭），`run-meta.json` 记录 `head=ffe3ffe dirty=0` | `evidence/run-meta.json` | 维持：视觉自查不要复用长跑 dev server |

### 10.5 结论

- **`ffe3ffe` 通过保真第二轮独立验收**：TypeScript 0 错、全量测试 143/143 文件（1988 passed + 1 skipped，EXIT=0）、构建成功、视觉脚本 9 图 **135/135 断言 PASS（KE_STRICT=1，0 DIFF）**。
- 本轮重点项（侧栏 IA、命令条右侧四入口、专注模式、引用块无底色、元信息格式、启动器品牌标）**全部验证通过**。
- 剩余差异集中在 **整页二级视图（P2，验收时 Lead 已在未提交改动中实施，待下轮提交后补证）** 与 **专注模式/启动器与基线的视觉细节（P3）**，均不阻断当前提交。
- 证据刷新：`docs/focus-ui/screenshots/`（9 张，含 `09-focus-mode-1440x900.png`）、`docs/focus-ui/evidence/`（`metrics.json` 135 项断言 / `summary.md` / `run-meta.json`）。

---

## 11. 全面对齐轮独立验收（快照 `focus-ui` @ `6c53695`）

> 触发：Lead 完成「全面对齐参考稿」轮（5 个整页视图 / ⌘K 命令面板 / 设置独立页 / 文档信息大纲优先 / 历史右侧浮层 /
> ⋯ 十条目 / 专注模式顶栏 / 回收站恢复刷新侧栏）后提交 `6c53695`，要求 QA 独立复核。
> 执行者 qa-visual（只读产品代码，只写 `docs/focus-ui/`；未 commit/push/checkout）。
>
> **证据隔离方法（重要）**：独立验收开始时 `HEAD=6c53695` 且主工作树干净；验收过程中 Lead 的**下一轮并行改动**开始写入
> 主工作树（`M App.tsx / EditorToolbar.tsx / icons.tsx / WorkspacePicker.tsx / index.css`，非 QA 所改）。
> 为保证证据 = 已提交快照，最终证据由 **`git archive HEAD`（=6c53695）解出的独立副本**提供：独立副本起全新 vite
> （`http://127.0.0.1:5285`，产品代码逐字节等于提交），后端共享 `:8000`；验收完成后临时副本已删除。
> 另：共享测试工作区 `/tmp/focus-ws` 在验收期间被其它会话扩充（1 文档/0 文件夹 → 21 文档/4 文件夹），首轮截图出现数据量
> 前后不一致，故在数据稳定后**重跑一次**作为最终证据（两次运行均 168/168 PASS；证据以干净 HEAD 副本那次为准）。

### 11.1 命令与结果

| 项 | 命令 | 结果 | 证据 |
|---|---|---|---|
| TypeScript | `cd frontend && npx tsc -b --noEmit` | **PASS**（0 错，无输出） | 本次独立实测 |
| 全量测试 | 解析 Lead 在 `6c53695` 工作树执行的全量日志（未并行重跑，避免双份负载） | **PASS**：`Test Files 149 passed (149)`；`Tests 2055 passed \| 1 skipped (2056)`；`EXIT=0`；Start 15:54:09，Duration 431.15s | `/tmp/focus-final-vitest4.log` |
| 生产构建 | `cd frontend && npm run build` | **PASS**：`BUILD_EXIT=0`，`✓ built in 5.95s`，`dist-build` 3.1 MB | `/tmp/focus-final-build3.log` |
| 视觉验收 | `KE_STRICT=1 node docs/focus-ui/verify-ui.cjs`（对干净 HEAD 副本） | **PASS**：**16 张截图、168/168 断言 PASS、0 DIFF**、`EXIT=0` | `/tmp/focus-qa-round3-clean.log`、`docs/focus-ui/evidence/` |

> 测试规模相对上一轮（143 文件 / 1988 passed）新增 **6 个测试文件 / +67 用例**（CommandPalette、LibraryPage、SearchPage、
> ModulesPage、AssetsPage、TrashPage），全绿无 flaky。视觉脚本本轮新增 7 张截图（10–16）+ 页面/面板/设置页断言，
> QA 独立复跑结果与 Lead 实测一致（16 图 168/168）。

### 11.2 本轮改动逐项核验

| # | 改动点 | 核验方式 | 结论 |
|---|---|---|---|
| 1 | 知识库/搜索/模块/资料/回收站 → 主画布整页（AppPage 路由 + `.focus-page-layer` + PageShell） | 脚本断言 20 项（页面层出现、标题 40px、页激活隐藏命令条）+ `10–14` 截图 + 补充探针 | **PASS**：5 页均渲染 `.focus-page-layer[data-page]`、标题 40px、激活时命令条隐藏；导航只做 `onNavigate`（旧侧栏内视图已移除，页面激活时侧栏仍是文件树） |
| 2 | ⌘K 命令面板（最近文档 / 命令 / 打开的文档，替代标签栏） | 脚本 5 项断言 + `15` 截图 + 探针 | **PASS**：`role=dialog[aria-label=命令面板]` 打开、输入框自动聚焦、三组齐全（最近文档 5 / 命令 7 / 打开的文档含当前文档，共 17 项） |
| 3 | 设置页独立页形态 | 脚本 5 项 + `16` 截图 + `06` 截图 + 探针 | **PASS**：全屏 1440×900、标题 40px、含「← 知识库」返回与常规/外观/快捷键/维护分组 |
| 4 | 文档信息浮层：标题「文档信息」+ 大纲优先 | `03` 截图 + 探针（标题/顺序） | **PASS**：sheet 380×880 @右侧10、标题「文档信息」、内容顺序 大纲(折叠至一级) → 属性 → 标签/历史；**（上轮 §9-2 已解决）** |
| 5 | 历史改右侧 420 sheet | 探针 + `18-history-sheet` 补充截图 | **PASS**：右侧 sheet 420×880 @右侧10，标题「历史版本」、刷新/关闭、当前版本、快照说明与空态提示 |
| 6 | ⋯ 菜单十条目（含打印预览/导入/专注/外观/设置） | 探针（条目清单）+ `17-more-menu` 补充截图 | **PASS**：恰 10 项：大纲与信息 / 文档信息 / 历史快照 / 源码模式 / 微分 d 转正体… / 打印预览 / 导入… / 专注模式⌘. / 切换外观 / 设置⌘, |
| 7 | 专注模式顶栏（← 文档标题 \| 保存态+主题）+ 进入专注先切回编辑器 | 脚本 11 项断言 + `09` 截图 + 探针 | **PASS**：顶栏 44px、含「← 碰撞动力学：质心系与动量」+ 主题切换按钮；从知识库页点「专注模式」会自动切回编辑器（`pageLayer: true→false`）；命令条 720 沉底距 16；Esc 退出。保存态：`saveState=idle`（刚打开未编辑）时为空 → 见 §11.4-1 |
| 8 | 回收站恢复刷新侧栏 | 源码核对 + 单测（149 文件全绿） | **PASS（源码级）**：`TrashPage.onFsChanged?.()` → App `setTreeRefresh(n+1)`，`refreshToken` 驱动页面重取；未在共享工作区做真实删除/恢复 E2E（避免污染测试数据），行为由 `TrashPage`/`App` 现有测试覆盖 |

### 11.3 对照设计基线（人工）

| 基线 | 对应截图 | 结论 | 说明 |
|---|---|---|---|
| `editor.png` | `01-editor-light-1440x900.png` | **PASS** | 侧栏 5 导航 + footer 三段 + 主题图标、命令条右侧四入口、元信息格式、引用块无底色均对齐；纸面 860/阅读列 680/命令条 46 断言全 PASS |
| `editor-dark.png` | `04-editor-dark-1440x900.png` | **PASS** | 深色令牌 8/8、纸面/侧栏 #0e0e10、命令条与侧栏结构一致 |
| `focus.png` | `09-focus-mode-1440x900.png` | **PASS（布局）** | 无侧栏、命令条沉底居中、纸面去边框阴影、顶栏 ←+文档标题+主题 ✓；残差见 §11.4-1/2 |
| `settings.png` | `16-settings-page-1440x900.png` | **PASS** | 已改为独立设置页（← 知识库 + 设置 40px + 分组卡片）；保留顶部分组 tab（基线为单列分组标题）→ §11.4-5 |
| `launcher.png` | `05-launcher-1440x900.png` | **PASS** | 官方品牌标 84px + 46px 标题 + 720 列；本轮补上**常驻路径输入**（「输入工作区路径，或点击「浏览…」选择文件夹」+ 浏览…/打开）与右上主题/信息图标，与基线结构一致 |
| `library.png` | `10-library-page-1440x900.png` | **PASS** | 整页知识库：标题/统计（10 篇文档 · 4 个文件夹 · 1 个模块）/导入+新建文档/继续写作卡/最近编辑（按修改时间/清空）/标签/文件夹（全部文档）；数据量差异属测试工作区数据 |
| `overlays.png` | `03`/`15`/`17`/`18` | **PASS** | 文档信息（大纲优先 + 折叠至一级）、⌘K 面板三组、⋯ 十条目、历史 420 右侧 sheet 均已对齐 |
| `prototype/screens/{search,modules,assets,trash}.html` | `11–14` | **大部分 PASS / 2 处 P3 信息结构差异** | 搜索页：标题/副标题/搜索框/重建索引/空态 ✓（类型筛选 chips 仅在**有结果时**出现，空态不显示 → §11.4-3）；模块页：标题/统计/新建/搜索/标签 chips/卡片 ✓，但原型 chips 为**模块类型**（定义/公式/定理/模板）且卡片带「被 N 篇引用」，当前为**标签** chips、卡片带 v1/大小/路径（引用数未展示）→ §11.4-4；资料页：标题/统计/仅看未引用/上传/chips 计数/空态/说明 均对齐；回收站页：标题/刷新/清空/空态/说明 均对齐 |

### 11.4 差异清单（只记录，未改产品代码）

| # | 优先级 | 差异 | 证据 | 建议 |
|---|---|---|---|---|
| 1 | P3 | 专注模式顶栏**默认不显示保存态**：`focusSaveStatus` 在 `saveState=idle`（打开文档后尚未编辑）时为空；基线 `focus.png` 右上恒显「已保存」圆点。有编辑/保存动作后会显示（dirty/saving/saved/error 四态已实现）。 | 探针 `focusMode.top.text` 仅「← 标题」+ 主题按钮；`App.tsx:696-706` 逻辑 | 若要求与基线一致：idle 也显示「已保存」（需定义初始 saveState 语义），或确认以动态状态为准 |
| 2 | P3 | 专注模式底部工具条仍是**完整命令条**（含 搜索/⋯/保存/导出 与全部格式项）；基线 `focus.png` 为**极简格式条**（仅格式 + 撤销/重做，无保存/导出/搜索/⋯） | `09` 截图 vs `focus.png`；脚本 09 断言未约束此项 | 产品定稿时确认「极简」程度；如需一致：专注模式隐藏右侧动作组 |
| 3 | P3 | 搜索页**空态不显示类型筛选 chips**（全部/文档/模块/附件），仅在有关键词与结果时出现；原型展示的是有结果态（chips + 计数）。 | `11-search-page` 截图（空态）；`SearchPage.tsx` 有 chips 实现 | 数据依赖差异，非功能缺失；若要求空态也展示可后续调整 |
| 4 | P3 | 模块页筛选维度与原型不同：原型为**类型** chips（定义/公式/定理/模板）且卡片显示「被 N 篇引用」；当前为**标签** chips，卡片显示 v1/大小/路径，未展示引用数。 | `12-modules-page` 截图 vs `prototype/screens/modules.html`；`ModulesPage.tsx:344-365` | 需产品确认模块筛选口径（类型 vs 标签）与是否补引用数 |
| 5 | P3 | 设置独立页保留顶部分组 tab（常规/外观/快捷键/维护），基线 `settings.png` 为单列「分组标题 + 卡片」堆叠（无 tab 行）。 | `16` 截图 vs `settings.png` | 形态已对齐独立页；tab 行是否保留待设计定稿 |
| 6 | P3 | ⋯ 菜单同时存在「大纲与信息」与「文档信息」两个相近入口（前者派发 `ke:outline-open` 聚焦大纲，后者打开信息浮层；当前浮层本身已大纲优先，二者视觉结果接近）。 | 探针菜单清单；`EditorToolbar.tsx:542/872` | 建议产品确认是否合并为一条目，减少冗余 |
| 7 | P3 | 脚本在设置页流程中截了两次同一页面（`06-settings-1440x900` 与 `16-settings-page-1440x900` 内容相同） | 两张截图 sha 相近/内容一致 | **已修复**（收尾轮：06 改为 `06-more-menu-1440x900` 并加十条目断言） |
| 8 | 环境 | 共享测试工作区 `/tmp/focus-ws` 在验收期间被其它会话写入（1→21 文档、0→4 文件夹），导致同一轮首跑截图中不同截图的数据量不一致 | 首跑 `10-library-page` 显示 1 篇文档，其它截图显示 4 文件夹；`find /tmp/focus-ws -name "*.md"` = 21 | 最终演示/截图前请固定测试工作区数据；本轮已在数据稳定后重跑作为证据 |
| 9 | 环境 | 验收期间 Lead 的下一轮改动并行写入主工作树（product code dirty）；已用独立 HEAD 副本隔离取证 | `git status` vs `run-meta.json` | 无需处理；说明本轮证据 = `6c53695` 提交本身 |

### 11.5 旧遗留项状态更新

- **§9-2「文档信息浮层大纲优先/标题」→ 已解决**：现标题「文档信息」，大纲（含折叠至一级）位于属性之前。
- **§9-9「知识库/搜索/模块/资料/回收站整页视图未实现」→ 已解决**：5 个整页视图 + `.focus-page-layer` 路由 + 页面截图 10–14。
- **§9-8「专注模式与基线细节差异」→ 部分解决**：顶栏（← 文档标题 + 主题）已补齐、进入专注自动切回编辑器已实现；残差仅剩「保存态 idle 显示」「底栏完整 vs 极简」两项（§11.4-1/2）。
- 其余旧 P3（设置页形态、启动器细节、浮层顺序等）均在本轮得到进一步对齐或维持可接受状态。

### 11.6 结论

- **`6c53695` 通过全面对齐轮独立验收**：TypeScript 0 错、全量测试 149/149 文件（2055 passed + 1 skipped，EXIT=0）、
  生产构建成功、视觉脚本 **16 图 168/168 断言 PASS（KE_STRICT=1，0 DIFF）**。
- 本轮 8 项重点改动（整页路由 ×5 / ⌘K 面板 / 设置独立页 / 文档信息大纲优先 / 历史 420 浮层 / ⋯ 十条目 /
  专注模式顶栏+自动切回编辑器 / 回收站恢复刷新）**全部验证通过**。
- 剩余差异均为 **P3 视觉/信息结构细节**（专注模式保存态与底栏、搜索空态 chips、模块页筛选维度、设置 tab、
  ⋯ 菜单两条相近入口），无功能性问题、无阻塞项、无测试回归。
- 证据已刷新：`docs/focus-ui/screenshots/`（16 张，含 10–16 页面/面板/设置页）、`docs/focus-ui/evidence/`
  （`metrics.json` 168 项断言 / `summary.md` / `run-meta.json`）、`docs/focus-ui/evidence/probe-round3/`（补充探针 JSON + 17/18/19 截图）。
