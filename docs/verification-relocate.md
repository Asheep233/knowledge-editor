# 独立验证报告：附件迁左栏 + 右栏净身 + 对外图标白底复原（task-14）

- **验证者**：`verifier-attach`（独立对抗验证；不复述开发者自测结论）
- **验证时刻**：A/B 段 2026-09-15 20:49:31 → 20:51:23（+08:00）；C 段 20:47 → 20:51:49。同一批次内完成。
- **仓库**：`/mnt/f/Work/KE Project/knowledge-editor`（WSL），A/B 段验证时 **git HEAD `1355c076f8b9371d514f3e6bdd26f82330643463`（`1355c07`）**
- **HEAD 迁移说明**：验证期间 HEAD 前进到 **`44ae327`**（`fix(brand): plated 源圆角对齐旧白底版`）。`git diff --name-only 1355c07..44ae327` 仅含 `scripts/make-brand-assets.py` —— **本报告 6 个被验证文件在两次 HEAD 间字节未变**（末尾已再次复算 sha，与 §0 一致），结论不受影响。
- **验证时工作区状态**：验证过程中 `scripts/make-brand-assets.py` 曾为未提交修改（` M`），其后以 `44ae327` 提交，**提交后字节与我复现所用副本完全一致**（sha256 `a58c801d…`，见 §5.4）

## 0. 所验证的 6 个文件（跑前/跑后各复算一次，完全一致 → 验证期间源码未变动）

| 文件 | sha256（跑前 = 跑后） |
|---|---|
| `frontend/src/components/layout/LeftSidebar.tsx`（被验证） | `4941040ee81ec668374ea9f85add738d6a6700d0ecbfde36a65b0096f7cb9f40` |
| `frontend/src/components/layout/LeftSidebar.test.tsx`（开发者） | `54bafbb6f62d52458f0cd58588669c9354afdf02e0617ae43629b88b2cc4b841` |
| `frontend/src/components/layout/RightPanel.tsx`（被验证） | `6aac03f7fc85d3a69133c5cc994c7da88896ea8b6a3229faed839bc218128ffa` |
| `frontend/src/components/layout/RightPanel.test.tsx`（开发者） | `6cf3f929eb6eefe26481edfdaf0aa24705f8e37fc2a5e8ca19616532b78871df` |
| `frontend/src/components/layout/LeftSidebar.verify.test.tsx`（本验证套件） | `962be46eea1281b2f0c7ff88f6e280d67235cc3fa575c694f53fb812ffbbb695` |
| `frontend/src/components/layout/RightPanel.verify.test.tsx`（本验证套件，重写） | `6e2a6291b2e0b4dc23161806236a5fa96b6f34fa09d5ada4947464cf6b50d495` |

Lead 告知的冻结 sha 与我独立复算**逐字节一致**（不采信转述）。验证窗口内 HEAD `1355c07`。

## 1. 结论摘要

| 段 | 判定 | 依据 |
|---|---|---|
| **A 附件能力迁左栏**（task-12） | **PASS** | 25/25 用例；信息量不缩水、3 篇引用全列出、收起两态、零写请求、`<a>` 打开能力、数据源已脱离 `tree.attachments` |
| **B 右栏净身**（task-12） | **PASS** | 13/13 用例；运行时零附件痕迹 + **源码级**零附件函数 + 属性/大纲/历史/收起全保留 |
| **C 对外图标白底复原**（task-13, `e8af9d4`） | **PASS** | 图标集 52/52 文件与 `57d1e6a` 逐字节一致；脚本两模式 5/5 + 1/1 字节级可复现；白底几何/不透明度达标 |
| **回归底线** | **PASS** | `tsc` exit 0；全量 vitest **36 files / 473 passed + 1 skipped** exit 0；pytest **462 passed / 2 skipped** |

**未发现 FAIL。** 一处过程性数据不一致（plated 圆角口径）由我在 C 段发现并上报，Lead 修正脚本后我复验通过（§5.5）。

---

# 2. A 段：附件能力迁左栏

## 2.1 命令与实际输出

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx tsc -b --noEmit
npx vitest run src/components/layout/LeftSidebar.verify.test.tsx src/components/layout/RightPanel.verify.test.tsx --reporter=verbose
npx vitest run
```

`tsc` 实际输出（全文）：

```
EXIT=0
```

定向套件实际输出（38 条，A 段 25 条 + B 段 13 条，节选 A 段）：

```
 ✓ LeftSidebar.verify.test.tsx > L-1 数据源迁移与默认态 > tree.attachments 全空但 /api/attachments/list 有数据 → 附件仍渲染（不依赖文件树） 57ms
 ✓ LeftSidebar.verify.test.tsx > L-1 > 默认展开：无需任何点击即可看到附件行与计数 21ms
 ✓ LeftSidebar.verify.test.tsx > L-1 > 表头带刷新/添加按钮（action 位保留） 19ms
 ✓ LeftSidebar.verify.test.tsx > L-1 > 0 附件：展开态显示「暂无附件」空态 16ms
 ✓ LeftSidebar.verify.test.tsx > L-2 > 迁移信息量不缩水：名称 / 大小 / 已引用徽章 / 全路径 / 修改时间 逐项可见 42ms
 ✓ LeftSidebar.verify.test.tsx > L-2 > 3 篇文档引用同一附件 → 详情必须列出全部 3 条（不是只列 [0]） 30ms
 ✓ LeftSidebar.verify.test.tsx > L-2 > 详情内每条引用可跳转（onOpenArticle 收到正确 docRel，恰好 3 次） 24ms
 ✓ LeftSidebar.verify.test.tsx > L-2 > 点附件行本身 = 就地展开，不得直接把用户跳走 18ms
 ✓ LeftSidebar.verify.test.tsx > L-2 > 未引用附件：显示「未被…引用」+ 全路径 + 大小 + 修改时间 18ms
 ✓ LeftSidebar.verify.test.tsx > L-2 > 同行两击 = 展开再收起（详情消失，列表不塌） 26ms
 ✓ LeftSidebar.verify.test.tsx > L-2 > 点不同行 = 切换详情，上一个展开态不残留 27ms
 ✓ LeftSidebar.verify.test.tsx > L-2 > 50 条引用不得被截断（防隐性上限） 34ms
 ✓ LeftSidebar.verify.test.tsx > L-3 > 收起态：零行 / 零详情 / 零孤儿 DOM，但计数与孤儿徽章可见 19ms
 ✓ LeftSidebar.verify.test.tsx > L-3 > 展开态：行 / 孤儿区块 / 删除按钮 / 底部说明 全部回来 21ms
 ✓ LeftSidebar.verify.test.tsx > L-3 > 无孤儿时收起态表头不出现孤儿噪声 16ms
 ✓ LeftSidebar.verify.test.tsx > L-4 > 每个附件保留独立 <a href={attachmentUrl(rel)}> 且 target=_blank / rel=noreferrer 22ms
 ✓ LeftSidebar.verify.test.tsx > L-4 > DOM 合法性：无 button 嵌套 button/a、无 a 嵌套 button 18ms
 ✓ LeftSidebar.verify.test.tsx > L-5 > 确认删除 → deleteAttachment(路径) 被调用且列表刷新 17ms
 ✓ LeftSidebar.verify.test.tsx > L-5 > 取消删除 → 不得发起 deleteAttachment，且全程零写请求 15ms
 ✓ LeftSidebar.verify.test.tsx > L-6 > 只读流程零写请求 + 零裸 fetch + 无 alert 38ms
 ✓ LeftSidebar.verify.test.tsx > L-6 > 展开/收起/点行详情不重复拉取列表（纯前端状态） 39ms
 ✓ LeftSidebar.verify.test.tsx > L-7 > referenced_by 为空数组：按未引用处理（显示未引用 + 不跳转） 19ms
 ✓ LeftSidebar.verify.test.tsx > L-7 > 超长文件名/路径不破版（可渲染 + 行内保留截断样式） 13ms
 ✓ LeftSidebar.verify.test.tsx > L-7 > refreshKey 变化 → 重新加载附件列表 21ms
 ✓ LeftSidebar.verify.test.tsx > L-7 > 树里存在附件名但 API 无数据 → 不得从 tree 推断渲染附件（等价性反证） 11ms
 Test Files  2 passed (2)
      Tests  38 passed (38)
EXIT=0
```

## 2.2 重点攻击面与判定（A）

| # | 攻击面 | 断言要点 | 判定 |
|---|---|---|---|
| L1 | **数据源真迁移** | `tree.attachments` 全空 + API 有 2 条 → 2 行仍渲染（旧实现此处必挂） | PASS |
| L2 | 默认态 | 默认展开、表头「附件 2」计数 | PASS |
| L3 | 表头 action | 刷新按钮存在（从折叠按钮向外逐层定位） | PASS |
| L4 | 空态 | 0 附件 → 「暂无附件」 | PASS |
| L5 | **迁移信息量不缩水** | 名称 / 大小(4.0 KB) / 已引用徽章 / 全路径 rel_path / 修改时间(2026) 逐项 | PASS |
| L6 | **全部引用** | 3 篇引用同一附件 → 3 条全在 | PASS |
| L7 | 逐条跳转 | `onOpenArticle` 收到 3 个正确 docRel 且**恰好 3 次** | PASS |
| L8 | 误跳防护 | 点行本身不得触发跳转 | PASS |
| L9 | 未引用 | 「未被(任何文档)引用」+ 全路径 + 大小 + 时间 | PASS |
| L10-11 | 交互 | 同行两击=收放（列表不塌）；异行切换不残留 | PASS |
| L12 | 隐性上限 | 50 条引用全部渲染（末条在 DOM） | PASS |
| L13 | **收起两态** | 收起态：零行 / 零详情 / 零孤儿 DOM / 无删除入口；**计数与孤儿徽章可见** | PASS |
| L14 | 展开两态 | 行 + 孤儿区块 + 删除按钮 + 底部说明回来 | PASS |
| L15 | 假信号 | 无孤儿时收起态表头**不得**出现孤儿噪声 | PASS |
| L16 | **打开能力** | `<a href="/api/attachments/Attachments/...">` 数量=行数、逐个 `target=_blank` + `rel=noreferrer` | PASS |
| L17 | DOM 合法性 | 无 `button button` / `button a` / `a button` | PASS |
| L18 | 删除 + 刷新 | 确认 → `deleteAttachment(路径)` 被调且 `listAttachments` 再次调用 | PASS |
| L19 | 取消不写 | 取消 → 零 `deleteAttachment` + 27 写函数全零 | PASS |
| L20 | **只读不变量** | 展开/详情/跳转/收起全流程：27 个写函数替身零调用 + **裸 fetch 零** + 无 alert | PASS |
| L21 | 无谓请求 | 展开/收起/详情不额外拉取 `listAttachments` | PASS |
| L22-24 | 边界 | 空 `referenced_by`、超长名 truncate、`refreshKey` 重载 | PASS |
| L25 | **反向等价性** | tree 里有附件名但 API 为空 → **不得**从 tree 渲染（迁移未完成的反证） | PASS |

**源级佐证**（`grep`）：
- `LeftSidebar.tsx` 头部注释与实现均标注数据源 = `listAttachments()`/`listOrphans()`，`tree.attachments` 不再参与本区渲染。
- 打开文件能力为行右侧**独立** `<a>`（`data-attachment-open`），未嵌套在行按钮内 → L17 通过。

## 2.3 A 段过程留痕：3 条**脚手架**缺陷（非产品缺陷）

初跑 2 红、复跑 1 红，全部定位为我的套件缺陷并修复（产品侧零改动）：

1. 表头刷新按钮位于折叠按钮的**上一层容器**，我最初只查直接父节点 → 改为逐层向上（≤3 层）命中即返回。
2. 孤儿区块判据原用「文本含孤儿附件」，会命中表头徽章文案「孤儿附件 N」（**徽章是折叠按钮的兄弟节点**，不在按钮内）→ 改为「`data-testid` 或含删除按钮的容器」。
3. 收起态信号判据原只查折叠按钮子树 → 改为覆盖**整行**（toggle + 徽章）。

> 记录目的：证明红/绿切换来自被验证对象而非脚手架噪声；产品侧在最终 sha 上未出现任何真实 FAIL。

---

# 3. B 段：右栏净身（硬判据）

## 3.1 命令与前序

同 §2.1（定向套件含 `RightPanel.verify.test.tsx` 13 条）。设计决定：上一轮 26 例「右栏附件区」套件**重写**而非删除 —— 保留**负向独立证据**（右栏零附件痕迹 + 零附件数据请求），与 A 段正向用例构成迁移双向闭环。

## 3.2 判定（B）

| # | 断言 | 判定 |
|---|---|---|
| R1 | 渲染文本**不含**「附件」「孤儿」 | PASS |
| R2 | 6 个 DOM 钩子全 0：`[data-attachment-row]` / `[data-attachment-detail]` / `[data-attachment]` / `attachments-toggle` / `orphan-badge` / `orphans-block` | PASS |
| R3 | 无 `a[href*="attachments"]`；无孤儿删除入口 | PASS |
| R4 | **运行时零附件数据请求**：渲染 + 切换文档后 `listAttachments/listOrphans/deleteAttachment/uploadAttachment` 均零调用 | PASS |
| R5 | **源码级净身**：`RightPanel.tsx` 去注释正文不含 `listAttachments`/`listOrphans`/`deleteAttachment`/`uploadAttachment`；反向断言 `updateArticleMeta`、`extractOutline` 仍在（防「清空文件式通过」） | PASS |
| R6 | 属性完整：标题输入 + 标签/类型/字数/创建/修改/大小/保存位置/KE 版本/frontmatter 十字段与值 | PASS |
| R7 | 大纲仍在且条目可点不抛错 | PASS |
| R8 | 历史快照卡片 + `onOpenHistory` | PASS |
| R9 | 收起右栏按钮 + `onCollapse` | PASS |
| R10 | `article=null` 空态不崩 | PASS |
| R11 | 只读不变量：渲染/大纲/历史/收起全程零写请求 + 零附件访问 + 零裸 fetch | PASS |
| R12 | 非空证明：显式点「保存属性」→ `updateArticleMeta` 被调 1 次、参数为当前文档 id | PASS |
| R13 | 未编辑时**不得**出现「保存属性」入口（无意义写入入口） | PASS |

源码级断言实现（不依赖 mock）：`import rightPanelSource from './RightPanel.tsx?raw'` + 去注释正则（`vite/client` 类型已启用，`tsc` exit 0）。

---

# 4. 回归底线（实际输出）

| 命令 | 实际输出 | 判定 |
|---|---|---|
| `npx tsc -b --noEmit` | `EXIT=0`（零输出） | PASS |
| `npx vitest run src/components/layout/LeftSidebar.verify.test.tsx src/components/layout/RightPanel.verify.test.tsx` | `Test Files 2 passed (2)` / `Tests 38 passed (38)` / `EXIT=0` | PASS |
| `npx vitest run src/components/layout/LeftSidebar.test.tsx src/components/layout/RightPanel.test.tsx`（开发者文件，对照） | `Test Files 2 passed (2)` / `Tests 29 passed (29)` / `EXIT=0`（与 dev 自测口径 22+7 一致） | PASS |
| `npx vitest run`（全量） | `Test Files 36 passed (36)` / `Tests 473 passed | 1 skipped (474)` / `EXIT=0` | PASS |
| `cd backend && python3 -m pytest` | `462 passed, 2 skipped, 1 warning in 18.38s` / `EXIT=0` | PASS |

计数关系（从全量输出按文件解析，逐项可核）：全量 **36 files / 474 用例** = 其它 **32** 个文件 **407**（其中 406 passed + 1 skipped，skip 在 `src/editor/perf-bench.test.ts`，既有） + 开发者两个文件 **29**（`LeftSidebar.test.tsx` 22 / `RightPanel.test.tsx` 7） + 本验证套件 **38**（`LeftSidebar.verify.test.tsx` 25 / `RightPanel.verify.test.tsx` 13） → **473 passed + 1 skipped**。skip 恒为 1，非本次引入。

---

# 5. C 段：对外图标白底复原（task-13 / `e8af9d4`）

## 5.1 逐字节一致（全量，非抽样）

命令与输出：

```
$ git diff --stat 57d1e6a -- desktop/src-tauri/icons
（空输出）

$ python3 …（全清单逐文件 sha256 比对）
57d1e6a=52 文件 / 当前=52 文件 / 差异=无
```

抽样 sha256（与 Lead 期望全部吻合）：

```
ec01435f15a467d7e5e6f00386950cc4faffb945e14ee6b30c6a9103eb51663e  desktop/src-tauri/icons/128x128@2x.png
767e1bbb661b4efd2b56801f0948444252273e7cb6ea4233098340d08e623358  desktop/src-tauri/icons/icon.ico
55447792353ceca382e49552897a173808d5957e4be0aa999a256a47c9ed401a  desktop/src-tauri/icons/32x32.png
```

`git status --porcelain desktop/src-tauri/icons` → 空（干净，已随 `e8af9d4` 提交）。

## 5.2 `include_bytes!` 任务栏链

```
$ grep -n include_bytes desktop/src-tauri/src/lib.rs
42:                if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) {
```

目标文件 sha256 = `ec01435f…`（回到 v1.1.8 白底版），256×256 RGBA。

## 5.3 `128x128@2x.png` 白底不透明（多口径，避免阈值歧义）

```
(256, 256) alpha_bbox=(0, 0, 256, 256) = 100.00%
  alpha==255 = 95.09%
  alpha>=128 = 95.84%
  alpha>0    = 96.44%
  四角: [(0,0,0,0),(0,0,0,0),(0,0,0,0),(0,0,0,0)]   中心: (255,255,255,255)
```

结论：**白底圆角方形版成立**（bbox 100%、四角透明=圆角、中心纯白）；「不透明像素 ≈96.1%」的具体数值取决于 alpha 阈值（本文件三口径为 95.09/95.84/96.44；`32x32.png` 的 `alpha>=128` 恰为 96.09%）。

## 5.4 脚本可重复执行（当前工作区脚本 = `a58c801d6b9f52e83921266f03cf94b7c8c86b30d9793dad0530b2ff234f7bf2`）

> 说明：`scripts/make-brand-assets.py` 我验证时是**未提交的工作区改动**（` M`），随后由 Lead 以 `44ae327` 提交；**提交后的文件字节与我复现所用副本完全一致**（sha256 `a58c801d6b9f52e83921266f03cf94b7c8c86b30d9793dad0530b2ff234f7bf2`，已复算）。复现一律在 `/tmp` 副本内进行，**未触碰仓库**。

| 模式 | 产物 | 结果 |
|---|---|---|
| 默认 | 4 个前端素材 + `astra-icon-1024.png` | **5/5 字节级 IDENTICAL**（`6d9ecf99…` / `5efe1319…` / `75312c56…` / `e3ee1a95…` / `371b8a68…`）→ 默认模式产物与 `50e44df` 后状态一致、未被本轮改动影响 |
| `--plated-icon` | `Logo/unified/astra-icon-plated-1024.png` | **IDENTICAL**，sha256 `43811992550fa2619d234d1a73871c31c5eb35008fdf8902b99d9f60239cd1fe` |

脚本行为核实：`--plated-icon` 仅额外写 out_dir 的 plated 文件，**不覆盖** OS 图标集（其输出文案亦声明当前 OS 图标集刻意使用 v1.1.8 白底版）。

## 5.5 plated 产物几何（含一处过程性数据不一致的修正）

| 指标 | 当前产物（`43811992…`） | 旧白底源 `astra-icon-v3-1024-rounded.png`（对照） | 判定 |
|---|---|---|---|
| 尺寸 / alpha bbox | 1024×1024 / `(0,0,1024,1024)` 100% | 1024×1024 / bbox 100% | PASS |
| 首行可测内缩（圆角） | **189px（0.1846×边长）** | **188px（0.1836×边长）** | PASS（差 1px） |
| 不透明像素（`alpha>0`） | **96.60%** | 96.04% | 数据 |
| 角像素 / 中心 | `(0,0,0,0)` / 纯白 | 同 | PASS |

**过程性发现（我上报 → Lead 修正 → 我复验）**：
- 修正前脚本 `radius_ratio=0.208`（PIL 参数 213），光栅化后首行内缩 = **199px**，与旧白底源 188px 相差 +11px（+5.9%）；我在 C 段把「参数口径 213 / 可测内缩 199 / 旧源 188」三个数字一并上报。
- Lead 将 `radius_ratio` 改为 `0.198`（PIL 参数 203 → 可测内缩 ≈188）并重生成产物；我复验：内缩 **189 vs 188（1px）**，两模式仍字节级可复现。**该修正属本次品牌工作内部一致性调整，已闭环。**

**目视项（归 Lead）**：任务栏/桌面实际观感、白底与深色任务栏的对比度 —— **我不下结论、不读图代替**，仅提供上述程序化数据。

---

# 6. 归因汇总（本次引入 vs 既有）

| 类别 | 项目 | 说明 |
|---|---|---|
| 需求变更（非缺陷） | 右栏附件小节整体移除、我的上一轮 26 例套件作废 | 主理人裁决「附件在左栏；文档属性就是文档属性」；已重写为 13 例净身套件留证 |
| 本次引入（已闭环） | plated 圆角口径与旧白底源不一致（199 vs 188） | 我发现并上报 C 段数据；Lead 修 `radius_ratio` 0.208→0.198；复验 189 vs 188 通过 |
| 本次引入（无缺陷） | 左栏附件迁移 + 右栏净身 | 38/38 PASS；零写请求不变量、数据源脱离 tree、收起两态成立 |
| 既有（非本次） | 全量 1 个 skipped | `editor/perf-bench.test.ts` 既有 skip |
| 既有（非本次） | pytest 1 个 warning | starlette/httpx `TestClient` 弃用提示，既有 |
| 既有（本次已提交） | `scripts/make-brand-assets.py` 曾为未提交状态 | 验证时 ` M`，我按其当时字节复现已留痕；Lead 随后以 `44ae327` 提交，提交字节与我复现副本 `a58c801d…` 一致 → 不影响 A/B/C 结论 |

# 7. 未验证项声明（如实列出，不含推测）

| 项 | 原因 |
|---|---|
| **左栏附件交互的 GUI 目视验收**（展开动画/观感/真机布局） | 归 Lead（其自述将做 GUI 目视）；本报告为组件级 + 程序化证据 |
| **任务栏/桌面图标实际观感** | 归 Lead；我只给 sha/几何/不透明度数据 |
| **Rust 编译、`tauri icon` 由我重跑、打包产物** | 会写入 `desktop/**`（超出写入边界）且环境未跑 cargo；替代证据：图标集 52/52 与 `57d1e6a` 逐字节一致 + `include_bytes!` 目标 sha 复算 + 脚本两模式可复现 |
| **真实后端跨层端到端**（左栏附件在真实工作区上的行为） | A 段为组件级替身测试；已被 mock 的 `listAttachments/listOrphans` 契约由 `backend/tests`（pytest 462+2 全绿）间接覆盖，但未做 UI↔后端联调 |
| **真实浏览器像素布局**（超长文件名是否真的溢出、徽章是否被裁） | happy-dom **无布局引擎**；L24 只能校验 `truncate` 样式类存在 |
| **绕过 `api/client` 的 XHR/WebSocket 写请求** | 已覆盖 27 个写函数替身 + 裸 `fetch` 绊线；未对 WebSocket/`sendBeacon` 做运行时拦截 |
| **上一轮 `RightPanel.verify.test.tsx` 的旧 26 例归档对照** | 其验证对象已按需求删除，归档对照无意义；新 13 例为净身判据 |

# 8. 复跑指引

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
sha256sum src/components/layout/{LeftSidebar.tsx,LeftSidebar.test.tsx,RightPanel.tsx,RightPanel.test.tsx,LeftSidebar.verify.test.tsx,RightPanel.verify.test.tsx}
npx tsc -b --noEmit
npx vitest run src/components/layout/LeftSidebar.verify.test.tsx src/components/layout/RightPanel.verify.test.tsx   # 期望 38 passed
npx vitest run                                                                                                     # 期望 36 files / 473 passed + 1 skipped

cd ../backend && python3 -m pytest                                                                                 # 期望 462 passed / 2 skipped

cd .. && git diff --stat 57d1e6a -- desktop/src-tauri/icons                                                        # 期望空
python3 - <<'EOF'
import subprocess, hashlib, glob, os
old = subprocess.run(['git','ls-tree','-r','--name-only','57d1e6a','--','desktop/src-tauri/icons'],capture_output=True,text=True).stdout.split()
now = [p for p in glob.glob('desktop/src-tauri/icons/**/*',recursive=True) if os.path.isfile(p)]
print(len(old), len(now), sum(1 for f in now if hashlib.sha256(open(f,'rb').read()).hexdigest()!=hashlib.sha256(subprocess.run(['git','show',f'57d1e6a:{f}'],capture_output=True).stdout).hexdigest()))
EOF
```

**验证产物**：本报告 + `LeftSidebar.verify.test.tsx`（25 例）+ `RightPanel.verify.test.tsx`（13 例，重写）。
验证者全程**未修改任何源码**（`frontend/src/**` 其它文件、`backend/**`、`desktop/**`、`scripts/**` 均未触碰；脚本复现一律在 `/tmp` 副本内进行）。
