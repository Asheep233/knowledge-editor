# 独立验证报告：源码模式 MVP（task-41 / task-42）

- **验证者**：`verifier-attach`（独立对抗验证；不复述开发者自测）
- **验证时刻**：2026-09-20 00:34:04 → 00:35:14（+08:00），单批次完成
- **仓库**：`/mnt/f/Work/KE Project/knowledge-editor`（WSL），**git HEAD `b34a5af`**；`git status --porcelain`：` M EditorArea.tsx`（修复后未提交）+ 我的两个未跟踪 verify 文件
- **验证对象**：task-41 源码模式 MVP（切视图 + textarea 原文编辑 + 字符串直存 + 提示）

## 0. 所验证的 sha（跑前/跑后各复算一次，一致）

| 文件 | 冻结 sha（Lead 发） | 实测 sha | 说明 |
|---|---|---|---|
| `components/layout/EditorArea.tsx` | `ad2b68de…` | **`ddc9ed9f99353ccd9fa79de09b1044700592705763ae6b1a00e71e573d342ff5`** | **验证期间被修**（见 §4 FAIL 闭环）：WYSIWYG 保存路径新增 `lastSavedRawRef.current.set(docId, saved.content)`；当前为未提交状态 |
| `components/editor/EditorToolbar.tsx` | `183af4a0…` | `183af4a052c019d8a5f96f46e94f8ca4b0c8381d45148d7f63ecf87249fbdcd3` | 未变 |
| `state/viewMode.ts` | `4eeb200b…` | `4eeb200b0749ea5e0cb68567ab02f88b74e74546913f0450676550c707a92688` | 未变 |
| `components/editor/SourceModeView.tsx` | `0cd87d0d…` | `0cd87d0dd85490d5389dcb50d0bec39762b4d3b5448e7f7c4a770e0f5d2a7cf2` | 未变 |
| `state/viewMode.test.ts` | `806716b7…` | `806716b7b647714ddaec9710b7745496d821c01e5e462265d5c34dcfc3e9c8ba` | 未变 |
| `components/editor/SourceModeView.test.tsx` | `881507ab…` | `881507abbef7dc20524f72209751d8d2b3d7a3d834aa3d112dce2ec424029bad` | 未变 |
| **`state/viewMode.verify.test.ts`**（本套件，34 例） | — | `2af4a7c28416f38cfed58e0b293447f19fba9b8aa7ca2bfbe472e43413e65e16` | verifier 产物 |
| **`components/editor/SourceModeView.verify.test.tsx`**（本套件，15 例） | — | `75ed29f84275251e66508fbd652107689a7bf5337989bc4773e0645d33e0a60e` | verifier 产物 |

> **对应最终资产的提示**：本报告的 PASS/FAIL 结论对应 **`EditorArea.tsx = ddc9ed9f…`**（不是 Lead 初发的 `ad2b68de…`）。请在重新覆盖预发布资产前把该文件**提交并重新冻结 sha**；其余 5 个冻结文件 sha 未变。

## 1. 结论摘要

| 项 | 判定 | 依据 |
|---|---|---|
| 字符串直存保真（23 构造零编辑恒等） | **PASS** | 8 个高敏感 + 15 个「设计内规范化」构造，零编辑保存逐字节 = 原文 |
| U+200B / BOM / CRLF（含 D-4 边界） | **PASS** | 源码通道保留 U+200B；默认参数仍剥除（正文通道零变化）；纯 LF/纯 CRLF 逐字节保留；混合 EOL = D-4 已声明限制 |
| 正文通道 vs 源码通道对照实验 | **PASS** | 真实 PM 管线实测：12 个样本确实被改写（作证据）；11 个未被改写（**已剔除、不用作证据**）；源码通道对全部 23 构造恒等 |
| 单视图排他 / 切换顺序 / 取消 | **PASS** | flush 在切换之前（PUT 先于 textarea 出现）；超时 → 确认框；取消 → 留正文不丢；源码态正文 `setEditable(false)` |
| 未知/损坏 `ke-*` 提示语义 | **PASS** | 未改动不弹；改写/删除/新增必须弹；同文档内只弹一次（纯函数 7 例 + 集成 B4） |
| 外部重载 / 与所见自洽 | **PASS**（含已声明取舍） | 显式重载后 textarea = 磁盘内容（未保存源码输入丢弃，记录型断言）；后续保存载荷与当前所见一致 |
| `mark_internal` 依托链 | **PASS** | 源码保存复用既有 `PUT /api/articles/…`，无新端点（后端 `mark_internal` 语义沿用） |
| 回归底线 | **PASS** | `tsc` exit 0；全量 **56 files / 1095 passed + 1 skipped**；本套件 **49 passed** |

**验证期间发现并已闭环的 FAIL**：见 §4（切到源码时 textarea 初值落后于刚 flush 的编辑 → 下一次源码保存会覆盖该编辑 = 内容丢失）。

## 2. 实际命令与实际输出

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx tsc -b --noEmit
npx vitest run src/state/viewMode.verify.test.ts src/components/editor/SourceModeView.verify.test.tsx
npx vitest run
```

| 命令 | 实际输出 |
|---|---|
| `npx tsc -b --noEmit` | `EXIT=0`（零输出） |
| 我的两套件 | `Test Files 2 passed (2)` / `Tests 49 passed (49)`（34 + 15），`EXIT=0` |
| `npx vitest run`（全量） | `Test Files 56 passed (56)` / `Tests 1095 passed | 1 skipped (1096)`，`EXIT=0` |

## 3. 用例清单与判定（49 例）

### 3.1 `state/viewMode.verify.test.ts`（34 例）

| 组 | 例数 | 覆盖要点 |
|---|---|---|
| V0-1 直存基底 | 4 | `frontmatterBlockOf + stripFrontmatter` 重组 = 原文（BOM/CRLF/注释/未知键）；正文 `---` 不误判；traits 往返幂等；`withFrontmatter` 只更新 `ke_version` |
| V0-2 恒等映射 | 4 | **零编辑保存 = 恒等映射**（8 个高敏感样本）；不凭空增删 frontmatter 键；无 frontmatter 原文正文原样追加；BOM/CRLF 按 traits 还原 |
| V0-2b 设计内规范化 | 2 | **15 个构造**（GFM 脚注 / ke-note / ke-attach / `1)` / 表格 / 引用式链接 / 角括号 / Setext / `~~~` / 缩进代码 / 松散列表 / 紧凑列表+尾空格 / 多空行+转义 / `:::note` / HTML 块+注释）零编辑恒等；样本集判别力自检 |
| V0-2c 对抗边界 | 2 | U+200B 保留（源码通道）+ 默认参数仍剥除（正文通道不回归）；D-4 记录型断言（纯 LF/纯 CRLF 逐字节保留、混合 EOL 统一为主导风格） |
| V1 视图态模块 | 7 | 读写往返 `ke.viewMode`；非法值降级；订阅/同值 no-op/退订；全局键不含文档 id；存储不可用不崩；`canEnterSourceMode` 三态；`__resetViewModeForTest` |
| V2 未知 ke-* diff 语义 | 7 | 未知 kind/损坏 JSON/未闭合 → unknown；合法 `ke-<hex>` 不误报；未改动不触发；改写/删除/新增触发；**仅改普通正文不误报**；顺序变化不算改动、数量变化算；干净文档 `hasUnknownKeMarkers=false` |
| V3 直存载荷组装 | 6 | 载荷 = 原 frontmatter + 用户正文 + `ke_version`（敏感方言不被规范化）；手写 `---` 不产生第二个版本头；**23 构造零编辑恒等**；BOM/CRLF 还原 + D-4；U+200B 保留 & 草稿恒 LF/无 BOM；≥256KB 纯字符串拼接（无 tiptap 依赖，静态断言） |
| V4 对照实验 | 1 | 真实 PM 管线逐样本实测（见 §3.2） |

### 3.2 对照实验实测结论（「先实测、后取证」）

用**真实应用管线** `useKeEditor`（与 App 同一套扩展）逐样本执行 `setContent(body, {contentType:'markdown'}) → getMarkdown()`，与输入按仓库同口径（行尾换行不计差）比较：

**正文通道确实改写（12，作为对照证据）**：CRLF 全文、GFM 脚注、`ke-note` 缺默认字段、`ke-attach` 缺字段、`1)` 有序列表、表格分隔行/表格开头、引用式链接、Setext 标题、`~~~` 围栏、缩进代码块、松散列表、`:::note` 容器。

**正文通道实测未改写（11，已剔除、不用作证据）**：`- [x]` 任务列表、`<span style>` 行内 HTML、`&copy;` 实体、BOM、未知/损坏 `ke-*`、正文 `---`、frontmatter 注释与未知键、角括号自动链接、紧凑列表+尾随空格、连续多空行+转义、HTML 块+注释。
> 其中 F-1/F-2/F-3（任务列表/行内 HTML/实体）在 pre.1 已修 → **不再被 PM 改写**，因此不再是源码模式的对照证据；本套件据实剔除，避免用失效样本充数。

**源码通道**：上述 23 个构造经 `buildSourceSavePayload(raw, sourceBodyOf(raw))` **全部逐字节等于原文**（V3 用例）。

### 3.3 `components/editor/SourceModeView.verify.test.tsx`（15 例）

| # | 用例 | 判定 |
|---|---|---|
| A1 | textarea 初值逐字节 = 传入原文；说明条声明 frontmatter 已隐藏；等宽字体 | PASS |
| A2 | 受控：输入触发 `onChange`（组件不自持状态） | PASS |
| A3 | 只读态：`disabled` + `readOnly` + 原因展示 | PASS |
| A4 | `notice` 提示条（未知语法改动提示位） | PASS |
| A5 | DOM 合法性 + 保存状态/标题展示 | PASS |
| B1 | **先 flush 后切换**：PUT 先于 textarea；初值 = 保存后的正文；frontmatter 隐藏；正文 `setEditable(false)` | PASS（修复后） |
| B1b | **数据丢失路径守卫**：刚 flush 的编辑必须仍在后续源码载荷里 | PASS（修复后） |
| B2 | flush 超时 → 确认框；取消 → 留正文、内容不丢、不渲染 textarea | PASS |
| B3 | 源码编辑 → 防抖保存：PUT 载荷逐字节 = 用户原文 + 原 frontmatter（含注释/未知键）+ `ke_version` 一次 | PASS |
| B4 | 未知 ke-* 改动 → 首次保存必提示；未改动不弹；已提示不重复 | PASS |
| B5 | 源码保存复用既有 `PUT /api/articles/…`，无源码专用端点（`mark_internal` 依托链） | PASS |
| B6 | 全局视图态：切文档后仍为源码 | PASS |
| B7 | 外部重载：textarea 刷为磁盘内容（未保存源码输入丢弃，记录型）；后续保存载荷与当前所见一致 | PASS |
| C1 | 源码保存函数静态断言：不调用 `getMarkdown()` / `setContent()`（不经 PM） | PASS |
| C2 | 回归面文件在位（docSwitch / saveQueue / draftDebounce / 保真面） | PASS |

## 4. 验证期间发现的 FAIL（已闭环）

### FAIL-1 切到源码时初值落后于刚 flush 的编辑 → 下次源码保存覆盖该编辑（内容丢失）

- **发现时的冻结 sha**：`EditorArea.tsx = ad2b68de…`
- **最小复现**（我的 B1/B1b，确定性）：
  1. 渲染 EditorArea（App 式宿主：`article` 为状态 + `onSaved` 回写）文档 `---\nke_version: 1\n---\n\n旧正文\n`；
  2. WYSIWYG 产生未决编辑 `'WYSIWYG 里刚写的正文\n'`（`onUpdate` → dirty）；
  3. 点「切到源码」→ **PUT 已发生**（磁盘已是新正文）；
  4. 断言 textarea 初值 → 实测 `'旧正文\n'`（**落后于已保存的编辑**）；
  5. 源码里再加一行保存 → 载荷 `'---\nke_version: 1\n---\n\n旧正文\n源码追加\n'` → **刚 flush 的编辑从磁盘上消失**。
- **根因**：`enterSourceMode` 用 `lastSavedRawRef.current.get(doc.id) ?? doc.content` 取初值；而该 ref 此前只在「载入 effect（随 `article` prop 变化）」与「**源码通道**保存成功后」写入，**WYSIWYG 保存路径不写** → 切换时读到旧盘面（React 的 article 回写尚未生效）。
- **修复（dev 落地，工作区未提交）**：WYSIWYG 保存成功分支也写 `lastSavedRawRef.current.set(docId, saved.content)`（`EditorArea.tsx:379`）。
- **我的复验**：同一 B1/B1b 现 **PASS**（初值 = 刚保存的编辑；后续载荷包含该编辑）；全量 56 files / 1095 passed。**关闸依赖该修复被提交并重新冻结 sha**。

## 5. 归因与已声明取舍

| 类别 | 项目 | 说明 |
|---|---|---|
| 本次修复（已复验） | FAIL-1 初值落后 → 内容丢失 | 我提 FAIL → dev 修 → 我复验；根因与修法见 §4 |
| 已声明限制 | **D-4 混合 EOL** | `DocTraits` 为文档级模型，混合 EOL 统一为主导风格；纯 LF/纯 CRLF 逐字节保留（用例已按记录型断言） |
| 已声明行为 | 显式外部重载会刷新 textarea | 未保存的**源码**输入在显式重载时被丢弃（与"重载以磁盘为准"一致）；后续保存与所见自洽 —— 建议在契约里显式写明 |
| pre.1 已修（历史缺陷） | F-1/F-2/F-3/F-4 等 | 任务列表/行内 HTML/实体/BOM 现已经 PM 通道保真 → 已从对照证据集中剔除 |
| U+200B | P3-16 vs 源码通道 | 修复为 `withFrontmatter(..., {stripCaretArtifacts:false})`；默认 `true` 保证正文通道零变化（已双向断言） |

## 6. 未验证项（如实列出，不含推测）

| 项 | 原因 |
|---|---|
| **真机 / 打包版 GUI**（切换按钮态、只读禁用、实际渲染、≥256KB 切换手感） | 我未启动 GUI（主理人处于暂停打包状态）；本报告为组件级 + 集成级（mock 事件循环）证据；dev 的真机自测**非我复现** |
| **≥256KB 切换不阻塞主线程的量化** | 只对纯函数 `buildSourceSavePayload` 断言 <500ms（实际为毫秒级字符串拼接）；**未测量**真实 textarea 挂载/切换耗时 |
| **后端 `mark_internal` 行为本身** | 前端只证明「复用既有 PUT 链、无新端点」；后端标记语义由 backend 测试覆盖，我未复跑 |
| **外部修改的完整 UI 流程** | 我用 `reloadToken` + article 回写模拟 R2 重载；App 侧弹窗/用户选择的完整链路未端到端跑 |
| **设置/快捷键等横向影响** | 已由全量 vitest（56 files / 1095 passed）覆盖，但未逐项独立复核 |

## 7. 复跑指引

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx tsc -b --noEmit
npx vitest run src/state/viewMode.verify.test.ts src/components/editor/SourceModeView.verify.test.tsx   # 期望 49 passed
npx vitest run                                                                                          # 期望 56 files / 1095 passed + 1 skipped
sha256sum src/components/layout/EditorArea.tsx   # 期望 ddc9ed9f…（修复版）
```

**验证产物**：本报告 + `frontend/src/state/viewMode.verify.test.ts`（34 例）+ `frontend/src/components/editor/SourceModeView.verify.test.tsx`（15 例）。
验证者全程**未修改任何源码**（仅上述两个测试文件与本报告）。
