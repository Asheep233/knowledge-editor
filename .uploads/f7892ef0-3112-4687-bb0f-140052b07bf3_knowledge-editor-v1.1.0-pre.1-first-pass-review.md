# Knowledge Editor v1.1.0-pre.1 第一轮审查报告（Diff-first / 高召回 / 证据驱动）

- **审查对：** v1.0.2a（`4732c5c`）→ v1.1.0-pre.1（`ab4ca1d`）
- **审查方式：** 只读审查。以 `git diff 4732c5c..ab4ca1d` 建立变更地图，再据此深入；本次在 Linux 沙箱执行（无 GUI/CDP/WebView），视觉项基于**代码 + 构建产物**证据。
- **审查定位：** 第一轮（低成本的 Diff-first + baseline-aware + evidence-driven 审查器），输出供第二阶段高级 Agent（K3）做对抗式/架构审查。

---

## 1. Executive Summary（机器可读）

```
P0: 0
P1: 0
P2: 2
P3: 1
New / Regression findings: 3（Introduced 3 / Regression 0 / Expanded 0）
Baseline findings: 1
Unverified findings: 6
Hard constraints: PASS（全部 6 项，逐条见第 2 节）
Overall: 可发布（无 P0 / P1；存在 2 项 P2 视觉/一致性缺陷 + 1 项 P3 展示不一致，建议下次迭代修复；另有 1 项基线 flaky 测试需关注）
```

说明：本轮为纯 UI/模块化重构 + 版本升级，后端逻辑改动极小（indexer 标题防御、documents 默认正文去 `# title`、modules 加 version 字段）。未发现 P0 / P1。

---

## 2. 未改动确认（硬约束逐条 PASS / FAIL / UNVERIFIED）

| 硬约束 | 判定 | 验证依据 |
|---|---|---|
| ① 三种导出 diff = 0 | **PASS** | `git diff 4732c5c ab4ca1d -- frontend/src/editor/plain-export.ts frontend/src/editor/export-actions.ts` 输出 **0 行**；`npx vitest run src/editor/plain-export.test.ts src/editor/export-actions.test.ts` = **14 passed**（注：与 prompt 所述「74 项专项」不一致，实际 14 项）。EditorArea 三处导出接线完整：`runExport(keExportPayload)` / `plainExportPayload` / `packageExportAndSave`（见 [EditorArea.tsx:238-255](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L238-L255)），且 `plainExportPayload` 注释显式引用设计文档。 |
| ② ke-module display:none 无边界 | **PASS** | [ModuleNodeView.tsx:11-21](file:///workspace/frontend/src/components/editor/nodeviews/ModuleNodeView.tsx#L11-L21)：`style={{display:'none'}}` + `contentEditable={false}` + `aria-hidden="true"`；**无**管理/删除入口、**未**改 pointer-events。该文件本轮 **0 改动**（不在 diff 列表），行为与基线一致；phase5-module.test.ts 往返 **14 passed**。 |
| ③ 可编辑标题链路（handleTitleBlur + slug.ts） | **PASS**（附测试缺口） | [EditorArea.tsx:86-106](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L86-L106)：`handleTitleBlur` → `updateArticleMeta(id,{title})`（frontmatter/meta）→ `slugify(next)` → `renameDoc` 文件名同步，链路完整。`utils/slug.ts` 为新增（A）。**缺口**：`slugify` 无独立单元测试（仅 import-export.test 测了 `slugForDownload`，非 `slugify`）；标题→文件名同步无直接测试覆盖（见第 5 节 O2）。 |
| ④ 构建产物 dist-build | **PASS** | [vite.config.ts:33](file:///workspace/frontend/vite.config.ts#L33) `outDir: 'dist-build'`；[tauri.conf.json:10](file:///workspace/desktop/src-tauri/tauri.conf.json#L10) `frontendDist: ../../frontend/dist-build`；实际 `npm run build` 成功输出 **`dist-build/**`**，未生成 dist。 |
| ⑤ sidecar /api/health 版本 | **PASS** | [backend/app/__init__.py](file:///workspace/backend/app/__init__.py) `__version__ = "1.1.0-pre.1"`；[health.py](file:///workspace/backend/app/routers/health.py) 返回 `version: __version__`；sidecar.rs 仅校验 `status=ok` 且 `version` 存在（P3-13），不做硬比对。 |
| ⑥ APP_VERSION 一致性 | **PASS** | 前端 [version.ts](file:///workspace/frontend/src/version.ts) `APP_VERSION = '1.1.0-pre.1'`；[App.tsx:123](file:///workspace/frontend/src/App.tsx#L123) `setVersionMismatch(h.version !== APP_VERSION)` → 后端 '1.1.0-pre.1' === 前端 '1.1.0-pre.1' → **不触发不一致告警**。Cargo.toml / tauri.conf.json / package.json 均 '1.1.0-pre.1'，全链一致。 |

### 变更地图摘要（38 文件，+2868 / -1564）

UI 层核心重写（AppShell/StatusBar 新增、EditorToolbar ~628 行、LeftSidebar/RightPanel/SettingsPanel/EditorArea/WorkspacePicker、NoteNodeView、icons.tsx 新增、index.css 令牌层、main.tsx 主题注入、settings.ts），外加 desktop settings.rs/menu.rs（强调色、菜单项），backend 3 处最小改动。

---

## 3. 本轮问题清单（Introduced / Regression / Expanded）

### F1（P2，Introduced，Confidence: High）
- **ID:** F1
- **Severity:** P2
- **Category:** UI/UX 视觉回归
- **Introduced-by:** 本轮 UI 重构（EditorToolbar 重写，基线不含此工具栏）
- **File:** [frontend/src/components/editor/EditorToolbar.tsx:152](file:///workspace/frontend/src/components/editor/EditorToolbar.tsx#L145-L155)
- **Line:** 152
- **Evidence:**
  - 源码：`hover && r <= hover.r && c <= hover.c ? 'bg-primary-soft0' : 'bg-gray-200 hover:bg-gray-300'`
  - 构建产物验证：`grep primary-soft0 dist-build/assets/*.css` → **NOT FOUND**；`grep primary-soft` → 命中 3 处（`--color-primary-soft`，正确类 `bg-primary-soft`）。`--color-primary-soft0` 未定义，故 `bg-primary-soft0` 是无义类，不生成任何背景色。
  - 基线对比：`git grep "primary-soft" 4732c5c -- EditorToolbar.tsx` → 空。基线的 TableSizePicker 无此类。
- **Baseline comparison:** Introduced（本轮新引入）
- **Impact:** 表格尺寸选择网格的「鼠标滑动选中区」高亮失效——悬停时选中单元格变成透明「洞」，非选中区仍为灰色，用户无法直观看到 1~8 行 × 1~8 列的选择范围。
- **Reproduction / Verification:** 打开编辑器 → 工具栏「更多」→ 插入表格 → 在 8×8 网格内滑动，观察高亮选中区无填充色。（亦可直接核对构建 CSS 缺失 `primary-soft0`。）
- **Fix direction:** 将 152 行 class 改为 `bg-primary-soft`（与 MenuItem/StyleCard 一致），或改用 `style={{ backgroundColor: 'var(--primary-soft)' }}`。
- **Confidence:** High

### F2（P2，Introduced，Confidence: Medium）
- **ID:** F2
- **Severity:** P2
- **Category:** 可访问性 / 视觉一致性（违反硬性规则「focus-visible 2px --ring」）
- **Introduced-by:** 本轮 UI 重构（大量新/重写组件）
- **File:** 多处：LeftSidebar.tsx:79/503/721、RightPanel.tsx:160/324/344/405、EditorArea.tsx:357、SettingsPanel.tsx:183、EditorToolbar.tsx:448（Dropdown 触发）/493/550、NoteNodeView.tsx:103
- **Line:** 见上
- **Evidence:**
  - 这些控件用 `focus-visible:ring-2` 但 **未** 附加 `focus-visible:ring-ring`（对照正确样例 EditorToolbar.tsx:41 `focus-visible:ring-2 focus-visible:ring-ring`）。
  - 构建 CSS 验证：`.ring-2{... var(--tw-ring-color,currentcolor) ...}`，且默认 `--tw-ring-color:currentcolor`。故无 `ring-ring` 时 focus 环颜色 = 元素 **currentColor**（图标按钮多为 `text-muted-foreground` 灰 / `text-foreground` 深），**非** --ring（主色蓝）。
- **Baseline comparison:** Introduced（这些控件本轮重写；基线条目多为标题易位，无此类统一 ring 约定——Medium 置信，因基线细节未逐一审计）
- **Impact:** 键盘导航焦点环颜色与设计规范（单主色 focus 环）不一致，且不同控件环色各不相同；部分灰底灰环对比度偏低，弱化可访问性。
- **Reproduction / Verification:** Tab 键遍历工具栏/侧栏/右栏图标按钮，观察焦点环颜色为灰/深色而非主色蓝。（代码 + 构建 CSS 证据已足。）
- **Fix direction:** 统一补全 `focus-visible:ring-ring`，或全局在 CSS 定义默认 ring 颜色为 `--ring`。
- **Confidence:** Medium

### F3（P3，Introduced，Confidence: High）
- **ID:** F3
- **Severity:** P3
- **Category:** 版本显示一致性
- **Introduced-by:** 本轮
- **File:** [frontend/src/components/layout/WorkspacePicker.tsx:28](file:///workspace/frontend/src/components/layout/WorkspacePicker.tsx#L28)
- **Line:** 28, 290
- **Evidence:** `const APP_VERSION = 'v1.1.0-pre.1'`（带前导 **v**）；而 [version.ts](file:///workspace/frontend/src/version.ts) `APP_VERSION = '1.1.0-pre.1'`（无 v）。两处分别用于启动器页脚与状态栏版本比对。显示型不一致。
- **Baseline comparison:** Introduced
- **Impact:** 启动器页脚显示 `v1.1.0-pre.1`，状态栏显示 `后端 v1.1.0-pre.1`（亦有 v），与 `version.ts` 无 v 不一致；纯展示，不影响版本一致性判定（判定用 version.ts）。
- **Reproduction / Verification:** 打开工作区选择页，页脚显示带 v 前缀版本。
- **Fix direction:** 统一版本常量来源（`import { APP_VERSION } from '../../version'`）以避免漂移。
- **Confidence:** High

---

## 4. Baseline 问题（单独列出，不计入本轮缺陷数）

### B1（Baseline，flaky 测试 + 潜在过期索引边界，Confidence: Medium）
- **ID:** B1
- **Severity:** 视作基线缺陷（不计入本轮）
- **Category:** 后端索引一致性 / 测试稳定性
- **File:** [backend/tests/test_v101_regressions.py:673-686](file:///workspace/backend/tests/test_v101_regressions.py#L673-L686) + [indexer.py:141-152](file:///workspace/backend/app/services/indexer.py#L141-L152)（reconcile）
- **Evidence:**
  - 实测：`test_p33_reconcile_skips_when_unchanged` 在**全量后端套件中偶发失败**（1/3 次）：`AssertionError: assert '内容2' in '# A\n\n内容1'`（索引残留 content1）。单跑该用例 **通过**。两次干净全量运行 exit=0（日志仅进度条、无失败行）。
  - 上述两次全量运行最初用 `| tail` 接收，**管道掩盖了 pytest 真实退出码**——以 `-p no:warnings` 直跑曾抓到一次 F。故「全 PASS」结论需修正为「全量偶发 1 失败」。
  - 根因：reconcile 跳过判据 = 磁盘签名 `{rel:(size,mtime_ns)}`；`"# A\n\n内容1"` 与 `"# A\n\n内容2"` **字节长度相同**，若两次写入落在同一 mtime 刻度内 → 签名不变 → reconcile 跳过 → 索引残留旧内容（search 命中过期文本）。该判据本轮未改动（_title_of 防御性修改不影响）。
- **Baseline comparison:** Baseline（reconcile 逻辑与测试本轮均未改动）
- **Impact:** 极端情况下（内容长度不变 + 同一 mtime tick 内变更）reconcile 漏更索引 → 搜索结果过期；同时测试存在 flakiness。
- **Fix direction（供 K3/后端处理，非本轮）:** reconcile 若已 skip 但文件 size 相等，建议对 mtime 相等 / size 相等但内容可能变化的文件做内容哈希核对，或将 hash 纳入签名。
- **Confidence:** Medium（flaky 确凿，根因推断合理）

---

## 5. 待人工验证 / Unverified（不得混入正式缺陷）

- **U1 — cargo test（Rust 单测）：UNVERIFIED（环境限制）**
  沙箱为 Linux，`cargo test` 因 **`glib-sys` 构建脚本找不到系统库 `glib-2.0`（GTK/glib）而失败**，非代码缺陷。实际发布/CI 目标为 Windows（NSIS + WebView2），settings.rs 已含 `defaults_match_schema_v1 / roundtrip / sanitize_accent_color / merge_*` 等单测。真机可跑通，此处无法核验。
- **U2 — GUI/CDP 视觉验证：不可执行**
  沙箱无显示器/WebView2/CDP 9222（prompt 第八部分的 `run-gui-cdp.bat`、`/mnt/d/KE Project` 均为 Windows 环境）。故所有视觉结论基于 **代码 + 构建产物 CSS** 证据，未经截图核验。建议第二阶段在真机用 CDP 复核 F1/F2。

### 观察项（告知 K3 权衡，非缺陷，不计入正式清单）
- **O1（阴影，按防误报要求不计缺陷）：** 令牌层注释声明「阴影透明度 0（层级靠边框）」，但组件在浮动层/下拉/弹窗/图片灯箱实际使用 Tailwind 真实投影：`shadow-xl`（EditorToolbar Dropdown/TableBubbleMenu/图片灯箱/弹窗）、`shadow-lg`（NoteNodeView 菜单/LeftSidebar 上下文/TableBubbleMenu）、`shadow-md`（EditorArea 下拉）、`shadow-sm`（Video/Attachment 删除按钮）、`shadow-2xl`（ImageLightbox 图片）。**未发现全局投影归零规则**（index.css 仅 3 处 box-shadow，均为 focus/数学输入框，非归零）。与防误报清单「当前 opacity 0」表述存在**代码层不一致**，按指示不列为缺陷，留给 K3 裁定是否为设计取舍的残余。
- **O2（slugify 测试缺口）：** `utils/slug.ts` 本轮新增，`slugify` 无直接单测；标题→文件名同步仅靠 `handleTitleBlur` + `renameDoc`，链路完整但无回归测试护住。建议补 `slug.test.ts`。
- **O3（rounded-full 边界）：** 除搜索框/徽章/分段控件外，尚有圆形图标按钮（LeftSidebar:503）、状态点（App:694/EditorArea:408,410）、开关（SettingsPanel:390/396）、色板圆点（NoteNodeView:133）、灯箱关闭（ImageLightbox:47）使用 `rounded-full`。多为圆形元素而非「胶囊」，是否违反「999px 仅限搜索/徽章/分段」存疑，低优先级。
- **O4（自定义强调色覆盖侧栏主色）：** [settings.ts:174-176](file:///workspace/frontend/src/settings.ts#L174-L176) `applyTheme` 在设置自定义强调色时同时覆写 `--primary / --sidebar-primary / --ring`；而防误报清单「深色侧栏主色 #0065fd 独立于主 CTA」。自定义色路径下侧栏主色会跟随主 CTA，失去「独立于主 CTA」的分层。仅当用户设自定义色时出现，是否属预期由 K3 判定。
- **O5（桌面设置前端 localStorage 与 Rust 并存）：** 已核对 schema camelCase 一致、深色页底 #161616 / 文字 #eff1f4 / 卡片边框无投影均满足（index.css:498-527）；无独立问题。

---

## 6. 附：验证命令真实结果

- `npx vitest run`：**23 files passed / 197 passed / 1 skipped (198)**（含 roundtrip 19、fidelity 46、phase3 15、phase5-module 14、export-actions 6、plain-export 8、perf-bench 3 等）。注：prompt 所述「74 项专项」与实际 **14 项**不符，已按实测记录。
- `npx tsc -b --noEmit`：**exit 0**。
- `npm run build`：**成功，产物在 dist-build/**（tsc + esbuild 均过）。
- `python3 -m pytest`（backend）：**累计通过，但存在 1 项偶发 flaky**（B1，test_p33_reconcile_skips_when_unchanged）；干净全量运行 exit=0。pip 依赖已装（fastapi 等）。
- `cargo test`：**未能构建**（Linux 缺 glib-2.0 系统库）——环境限制，非代码缺陷。

---

## 7. 给第二阶段（K3）的交接要点

1. **重点复核**：F1（表尺寸选择高亮，逻辑确凿）、F2（focus ring 未用 --ring，属规范级偏差）、B1（reconcile 签名判据下的过期索引边界 + flaky 测试）。
2. **判争议项**：O1（真实 shadow 与「opacity 0」令牌决策的代码层冲突）、O4（自定义强调色覆盖侧栏主色 #0065fd）、O3（rounded-full 边界）。
3. **环境局限**：U1 cargo、U2 GUI/CDP 需在 Windows 真机补验；视觉结论为代码/构建产物证据，非截图。
4. 未发现任何 P0（导出零改动、ke-module 无边界、标题链路、dist-build、版本一致均 PASS），本轮不阻塞发布。
